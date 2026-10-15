import { chatReferences } from './chatReferences'

export interface DraftChip {
  kind: 'skill' | 'file' | 'command' | 'quote'
  start: number
  end: number
  source: string
  label: string
  target?: string
}
export type DraftSegment = { kind: 'text'; source: string } | DraftChip

/** Completed references become inline atoms; their source text is preserved for the agent. */
export function composerDraft(value: string) {
  const chips: DraftChip[] = []
  const code = [...value.matchAll(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g)].map((match) => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }))
  for (const match of value.matchAll(/^(?:>[^\n]*\n)+(?:\n)?/gm)) {
    if (code.some((block) => match.index! >= block.start && match.index! < block.end)) continue
    const source = match[0].trimEnd()
    chips.push({
      kind: 'quote',
      start: match.index!,
      end: match.index! + source.length,
      source,
      label: source.replace(/^> ?/gm, '').trim(),
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
  const command = value.match(/^\/(?:goal|aside|new|schedule|schedules|changes|recap|settings|clear)(?=\s)/)
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
export function deleteDraftAtom(value: string, caret: number, key: 'Backspace' | 'Delete') {
  const chip = composerDraft(value).chips.find((entry) =>
    key === 'Backspace' ? entry.end === caret : entry.start === caret,
  )
  return chip ? { value: value.slice(0, chip.start) + value.slice(chip.end), caret: chip.start } : null
}
