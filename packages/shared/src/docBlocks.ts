// A doc's Markdown as the blocks a person reads (headings, paragraphs, list items, tasks, quotes), so the phone can
// show each one formatted and edit its words, while the Markdown around them (markers, tables, code) stays as written.

export type DocBlockKind = 'heading' | 'paragraph' | 'item' | 'task' | 'quote'

export interface DocBlock {
  kind: DocBlockKind
  /** 1 to 6 for headings, the nesting depth for items; 0 otherwise. */
  level: number
  /** For a task: whether it is ticked. */
  done?: boolean
  text: string
}

interface Located extends DocBlock {
  line: number
  /** The line's Markdown before the text: `## `, `- [ ] `, `> `. */
  prefix: string
}

const FENCE = /^\s*(```|~~~)/
const PATTERNS: { kind: DocBlockKind; pattern: RegExp }[] = [
  { kind: 'heading', pattern: /^(#{1,6} +)(.*\S.*)$/ },
  { kind: 'task', pattern: /^(\s*[-*+] +\[([ xX])\] +)(.*\S.*)$/ },
  { kind: 'item', pattern: /^(\s*(?:[-*+]|\d+[.)]) +)(.*\S.*)$/ },
  { kind: 'quote', pattern: /^(> ?)(.*\S.*)$/ },
]

function locate(markdown: string): Located[] {
  const blocks: Located[] = []
  let fenced = false
  markdown.split('\n').forEach((raw, line) => {
    const text = raw.replace(/\r$/, '')
    if (FENCE.test(text)) fenced = !fenced
    if (fenced || FENCE.test(text) || !text.trim() || /^\s*\|/.test(text) || /^\s*(<|\[\^|---|\*\*\*|___)/.test(text))
      return
    for (const { kind, pattern } of PATTERNS) {
      const match = pattern.exec(text)
      if (!match) continue
      const prefix = match[1]!
      const body = kind === 'task' ? match[3]! : match[2]!
      blocks.push({
        kind,
        line,
        prefix,
        text: body,
        level:
          kind === 'heading'
            ? prefix.trim().length
            : kind === 'item' || kind === 'task'
              ? Math.floor((prefix.length - prefix.trimStart().length) / 2)
              : 0,
        ...(kind === 'task' ? { done: match[2] !== ' ' } : {}),
      })
      return
    }
    blocks.push({ kind: 'paragraph', line, prefix: '', text, level: 0 })
  })
  return blocks
}

/** The doc's blocks in reading order. */
export function docBlocks(markdown: string): DocBlock[] {
  return locate(markdown).map(({ line: _line, prefix: _prefix, ...block }) => block)
}

/**
 * The Markdown with each block's words (and a task's tick) replaced in its own line; refused if the blocks no longer
 * line up. An emptied block keeps its words, so nothing is deleted by accident.
 */
export function withDocBlocks(markdown: string, blocks: Pick<DocBlock, 'text' | 'done'>[]): string {
  const found = locate(markdown)
  if (found.length !== blocks.length)
    throw new Error('The doc changed while you were editing. Reopen it and edit again.')
  const lines = markdown.split('\n')
  found.forEach((block, index) => {
    const next = blocks[index]!
    // An untouched block keeps its line exactly, with its spacing and hard line break.
    if (next.text === block.text && (next.done === undefined || next.done === block.done)) return
    const text = next.text.replace(/\s*\n\s*/g, ' ').trim() || block.text
    const prefix =
      block.kind === 'task' && next.done !== undefined
        ? block.prefix.replace(/\[[ xX]\]/, next.done ? '[x]' : '[ ]')
        : block.prefix
    const ending = lines[block.line]!.endsWith('\r') ? '\r' : ''
    lines[block.line] = `${prefix}${text}${ending}`
  })
  return lines.join('\n')
}
