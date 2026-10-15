// "Next edit" prediction, the idea behind Cursor's Tab: after the user changes something, predict the follow-up edit
// (the same rename elsewhere, the caller that needs updating, the third copy of a pattern) and offer it as a diff.
// A local instruct model gets the user's recent edits and the code around the cursor, and replies with one edit.
import { z } from 'zod'

export interface EditRecord {
  line: number
  before: string[]
  after: string[]
}
export interface NextEditInput {
  path: string
  lines: string[]
  cursorLine: number
  edits: EditRecord[]
}
export interface NextEdit {
  startLine: number
  endLine: number
  text: string
}

const MAX_WINDOW_LINES = 120,
  MAX_LINE_CHARS = 240,
  MAX_EDITS = 4,
  MAX_EDIT_LINES = 12

/** Numbered lines around the cursor and the recent edits, so the model can see both what changed and what remains. */
export function windowOf(lines: string[], cursorLine: number, edits: EditRecord[]): { start: number; end: number } {
  if (lines.length <= MAX_WINDOW_LINES) return { start: 1, end: lines.length }
  const anchors = [cursorLine, ...edits.map((edit) => edit.line)]
  const low = Math.max(1, Math.min(...anchors) - 20),
    high = Math.min(lines.length, Math.max(...anchors) + 40)
  const start = Math.min(low, Math.max(1, cursorLine - 40)),
    end = Math.min(lines.length, Math.max(high, start + 60))
  return end - start + 1 > MAX_WINDOW_LINES ? { start, end: start + MAX_WINDOW_LINES - 1 } : { start, end }
}

const clip = (line: string) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line)

export function buildPrompt(input: NextEditInput): { system: string; user: string; start: number; end: number } {
  const edits = input.edits.slice(-MAX_EDITS)
  const { start, end } = windowOf(input.lines, input.cursorLine, edits)
  const history = edits
    .map(
      (edit, i) =>
        `Edit ${i + 1} (near line ${edit.line}):\n${edit.before
          .slice(0, MAX_EDIT_LINES)
          .map((l) => `- ${clip(l)}`)
          .join('\n')}${edit.before.length ? '\n' : ''}${edit.after
          .slice(0, MAX_EDIT_LINES)
          .map((l) => `+ ${clip(l)}`)
          .join('\n')}`,
    )
    .join('\n\n')
  const numbered = input.lines
    .slice(start - 1, end)
    .map((line, i) => `${String(start + i).padStart(4)} | ${clip(line)}`)
    .join('\n')
  return {
    start,
    end,
    system: `You predict the next edit a programmer will make, like an autocomplete for edits. You reply with JSON only.

How to decide:
- Look at what the user changed. If other places in the file still have the OLD form of that change, the next edit is to change them the same way: a rename not yet applied to every use, a pattern (quotes, var to const, a trailing comma, a logging call, an async call) not yet applied to the next similar line.
- Propose exactly one edit: the nearest place that still needs the change. Prefer a place below the cursor.
- Copy the file's own style exactly: its quote marks, semicolons and indentation. Change only what the pattern requires.
- If every place is already consistent, or the change does not imply anything else, reply {"edit": false}. Do not invent new features or unrelated changes.

Examples of the format:
User changed: "- width: 10px" to "+ width: 1rem", then "- height: 20px" to "+ height: 2rem". Line 5 is "  margin: 8px". Reply: {"edit": true, "startLine": 5, "endLine": 5, "replacement": "  margin: 0.5rem"}
User changed: "- name: string" to "+ readonly name: string", then "- age: number" to "+ readonly age: number". Line 4 is "  email: string". Reply: {"edit": true, "startLine": 4, "endLine": 4, "replacement": "  readonly email: string"}
User changed a comment and nothing else refers to it. Reply: {"edit": false}`,
    user: `File: ${input.path}\n\nThe user just made these edits, oldest first (- removed, + added):\n\n${history}\n\nThe file now (the cursor is on line ${input.cursorLine}):\n\n${numbered}\n\nWhat is the next edit? Reply with {"edit": true, "startLine": N, "endLine": M, "replacement": "..."} where "replacement" is the complete new text for lines N to M with the file's indentation, or {"edit": false}.`,
  }
}

export const NEXT_EDIT_SCHEMA = {
  type: 'object',
  properties: {
    edit: { type: 'boolean' },
    startLine: { type: 'integer' },
    endLine: { type: 'integer' },
    replacement: { type: 'string' },
  },
  required: ['edit'],
} as const
const reply = z.object({
  edit: z.boolean(),
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
  replacement: z.string().optional(),
})

/** Accepts only an edit that fits the window and actually changes something; anything else means "no suggestion". */
export function parseEdit(text: string, input: NextEditInput, window: { start: number; end: number }): NextEdit | null {
  let parsed: z.infer<typeof reply>
  try {
    parsed = reply.parse(JSON.parse(text))
  } catch {
    return null
  }
  if (
    !parsed.edit ||
    parsed.startLine === undefined ||
    parsed.endLine === undefined ||
    parsed.replacement === undefined
  )
    return null
  const { startLine, endLine } = parsed
  if (startLine < window.start || endLine > window.end || endLine < startLine || endLine - startLine > 30) return null
  // Models often wrap the text in a code fence or add a trailing newline; neither is part of the edit.
  let replacement = parsed.replacement
    .replace(/^```[a-z]*\n/, '')
    .replace(/\n```\s*$/, '')
    .replace(/\n$/, '')
  // The code was shown with line numbers ("  3 | code"); a model that copies them gets them stripped.
  if (replacement.split('\n').every((line) => /^\s*\d+ \| ?/.test(line)))
    replacement = replacement
      .split('\n')
      .map((line) => line.replace(/^\s*\d+ \| ?/, ''))
      .join('\n')
  const current = input.lines.slice(startLine - 1, endLine).join('\n')
  if (replacement === current || replacement.trim() === '') return null
  return { startLine, endLine, text: reindent(replacement, input.lines[startLine - 1] ?? '') }
}

const indentOf = (line: string) => /^[ \t]*/.exec(line)![0]

/** Models often get the indentation slightly wrong. The edit replaces existing lines, so it keeps their indentation. */
export function reindent(replacement: string, original: string): string {
  const lines = replacement.split('\n'),
    want = indentOf(original),
    have = indentOf(lines[0]!)
  if (!original.trim() || want === have) return replacement
  return lines
    .map((line, i) =>
      i === 0 ? want + line.slice(have.length) : line.startsWith(have) ? want + line.slice(have.length) : line,
    )
    .join('\n')
}

export interface NextEditDeps {
  chat(system: string, user: string, signal: AbortSignal): Promise<string>
}

export async function predictNextEdit(
  deps: NextEditDeps,
  input: NextEditInput,
  signal: AbortSignal,
): Promise<NextEdit | null> {
  if (!input.edits.length) return null
  const prompt = buildPrompt(input)
  return parseEdit(await deps.chat(prompt.system, prompt.user, signal), input, prompt)
}
