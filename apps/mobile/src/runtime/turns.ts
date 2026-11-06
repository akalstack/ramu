import type { TranscriptItem } from './types'

/** "35s", "12m 48s", "1h 5m": the desktop's duration format. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** The thread stopped on this error: only end markers and notes came after it, so continuing from it makes sense. */
export function endedOnError(items: TranscriptItem[], id: string): boolean {
  const index = items.findIndex((item) => item.id === id)
  return index >= 0 && items.slice(index + 1).every((item) => item.kind === 'end' || item.kind === 'note')
}

const settled = (item: TranscriptItem) =>
  item.kind === 'text' ||
  (item.kind === 'tool' && item.status === 'completed') ||
  item.kind === 'thinking' ||
  (item.kind === 'plan' && item.entries.every((entry) => entry.status === 'completed')) ||
  (item.kind === 'permission' && item.decision === 'allow') ||
  (item.kind === 'elicitation' && item.outcome !== undefined) ||
  (item.kind === 'secret' && !!item.outcome?.startsWith('saved')) ||
  (item.kind === 'question' && item.answers !== undefined)

/**
 * Mirrors the desktop's per-turn layout. The running turn gets a live "Working for …" rule above its steps.
 * Once a turn is done its routine steps fold into one "Worked for …" row; the answer, failed or open
 * steps, and unanswered prompts stay visible.
 */
export function foldTurns(items: TranscriptItem[], live: boolean, waiting: boolean): TranscriptItem[] {
  const turns: TranscriptItem[][] = []
  // A message to a teammate opens a turn too, so the lead's answer above it is not folded into the work before it.
  for (const item of items) {
    if (item.kind === 'user' || item.kind === 'teammate-message' || !turns.length) turns.push([])
    turns.at(-1)!.push(item)
  }
  return groupTools(
    turns.flatMap((turn, index) => {
      const user = turn[0]?.kind === 'user' || turn[0]?.kind === 'teammate-message' ? turn[0] : undefined
      const notes = turn.filter((item) => item.kind === 'note')
      const body = turn.filter((item) => item !== user && item.kind !== 'end' && item.kind !== 'note')
      const ends = turn.filter((item): item is Extract<TranscriptItem, { kind: 'end' }> => item.kind === 'end')
      const result = ends.find((item) => item.ended)
      const isLast = index === turns.length - 1
      const finished = Boolean(result) || !isLast || (!live && !waiting)
      const startedAt = user?.at ?? body.find((item) => item.at !== undefined)?.at
      // A running turn shows its steps as they come; the status line above the composer says it is working.
      if (!finished) return [...(user ? [user] : []), ...body, ...notes]
      let start = body.length
      while (start > 0 && body[start - 1]!.kind === 'text') start--
      const work = body.slice(0, start)
      const folded = work.filter(settled)
      const kept = work.filter((item) => !settled(item))
      const endedAt = (result ?? ends[0])?.at ?? body.findLast((item) => item.at !== undefined)?.at
      // A message steered into a running turn starts the next turn before the result; with no stop, failure or idle
      // in between, the agent carried on rather than stopped.
      const done = result ? !result.interrupted : !isLast && !ends.length
      const duration = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined
      const label = done
        ? duration !== undefined
          ? `Worked for ${formatDuration(duration)}`
          : 'Worked'
        : duration !== undefined
          ? `Stopped after ${formatDuration(duration)}`
          : 'Stopped'
      return [
        ...(user ? [user] : []),
        ...(folded.length
          ? [{ kind: 'summary' as const, id: `summary-${user?.id ?? index}`, label, items: folded }]
          : []),
        ...kept,
        ...body.slice(start),
        ...notes,
      ]
    }),
  )
}

type Step = Extract<TranscriptItem, { kind: 'tool' | 'thinking' }>

/**
 * Consecutive tools share one disclosure with the reasoning between them, in arrival order, as on the desktop.
 * A lone tool keeps its own row. Reasoning at the very end of the thread stays out, since it may still be streaming.
 */
export function groupTools(items: TranscriptItem[], liveTail = true): TranscriptItem[] {
  const grouped: TranscriptItem[] = []
  let run: Step[] = []
  const flush = (atEnd: boolean) => {
    let end = run.length
    if (atEnd && liveTail) while (end > 0 && run[end - 1]!.kind === 'thinking') end--
    const entries = run.slice(0, end)
    const tools = entries.filter((step) => step.kind === 'tool')
    if (tools.length && entries.length > 1) {
      const first = entries[0]!
      grouped.push({ kind: 'tools', id: first.id, at: first.at, tools, entries })
    } else grouped.push(...entries)
    grouped.push(...run.slice(end))
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'thinking') {
      run.push(item)
      continue
    }
    flush(false)
    grouped.push(item.kind === 'summary' ? { ...item, items: groupTools(item.items, false) } : item)
  }
  flush(true)
  return grouped
}
