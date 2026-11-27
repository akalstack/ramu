import type { AgentProvider } from '../types'
import { chatReferences } from './chatReferences'

export interface DraftChip {
  kind: 'skill' | 'file' | 'command' | 'quote' | 'mention'
  start: number
  end: number
  source: string
  label: string
  target?: string
  /** A mention of a model: whose icon it wears. A custom agent without a model has none. */
  provider?: AgentProvider
}
export type DraftSegment = { kind: 'text'; source: string } | DraftChip

/** A helper a message can start with: a model, a custom agent or an ability. */
export interface DraftMention {
  /** As typed after `@`, lower case (`sonnet-5.5`). */
  handle: string
  /** As people read it (`Sonnet 5.5`). */
  label: string
  provider?: AgentProvider
}

/**
 * Completed references become inline atoms; their source text is preserved for the agent. A message that starts with
 * `@handle` naming one of `mentions` shows who it goes to, not a file of that name.
 */
export function composerDraft(value: string, mentions: readonly DraftMention[] = []) {
  const chips: DraftChip[] = []
  const lead = mentions.length ? /^@(\S+)(?=\s)/.exec(value) : null
  const mention = lead && mentions.find((entry) => entry.handle === lead[1]!.toLowerCase())
  if (lead && mention)
    chips.push({
      kind: 'mention',
      start: 0,
      end: lead[0].length,
      source: lead[0],
      label: mention.label,
      target: mention.handle,
      ...(mention.provider ? { provider: mention.provider } : {}),
    })
  const code = [...value.matchAll(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g)].map((match) => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }))
  for (const match of value.matchAll(/^(?:>[^\n]*\n)+(?:\n)?/gm)) {
    if (code.some((block) => match.index! >= block.start && match.index! < block.end)) continue
    // The blank line that ends a quote belongs to it, so what is typed next sits beside the quote, not lines below it,
    // while the message keeps the line break Markdown needs to end the quote.
    chips.push({
      kind: 'quote',
      start: match.index!,
      end: match.index! + match[0].length,
      source: match[0],
      label: match[0].replace(/^> ?/gm, '').trim(),
    })
  }
  let offset = 0
  for (const part of chatReferences(value)) {
    const start = offset,
      end = start + part.text.length
    offset = end
    if (
      part.kind === 'text' ||
      !/\s/.test(value[end] ?? '') ||
      chips.some((chip) => start >= chip.start && start < chip.end)
    )
      continue
    chips.push({
      kind: part.kind,
      start,
      end,
      source: part.text,
      label: part.kind === 'skill' ? part.target : part.target.split('/').at(-1)!,
      target: part.target,
    })
  }
  const command = value.match(/^\/(?:goal|aside|new|schedule|schedules|changes|settings|clear)(?=\s)/)
  if (command)
    chips.push({ kind: 'command', start: 0, end: command[0].length, source: command[0], label: command[0].slice(1) })
  chips.sort((a, b) => a.start - b.start)
  const segments: DraftSegment[] = []
  let cursor = 0
  for (const chip of chips) {
    if (cursor < chip.start) segments.push({ kind: 'text', source: value.slice(cursor, chip.start) })
    segments.push(chip)
    cursor = chip.end
  }
  if (cursor < value.length) segments.push({ kind: 'text', source: value.slice(cursor) })
  return { chips, segments }
}

/** Backspace/Delete remove an adjacent atom as one unit. */
export function deleteDraftAtom(
  value: string,
  caret: number,
  key: 'Backspace' | 'Delete',
  mentions: readonly DraftMention[] = [],
) {
  const chip = composerDraft(value, mentions).chips.find((entry) =>
    key === 'Backspace' ? entry.end === caret : entry.start === caret,
  )
  return chip ? { value: value.slice(0, chip.start) + value.slice(chip.end), caret: chip.start } : null
}
