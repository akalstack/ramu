import type { TranscriptItem } from './types'

/** "35s", "12m 48s", "1h 5m": the desktop's duration format. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

const settled = (item: TranscriptItem) =>
  item.kind === 'text' ||
  (item.kind === 'tool' && item.status === 'completed') ||
  (item.kind === 'permission' && item.decision === 'allow') ||
  (item.kind === 'elicitation' && item.outcome !== undefined) ||
  (item.kind === 'question' && item.answers !== undefined)

/**
 * Mirrors the desktop's per-turn layout. The running turn gets a live "Working for …" rule above its steps.
 * Once a turn is done its routine steps fold into one "Worked for …" row; the answer, failed or open
 * steps, and unanswered prompts stay visible.
 */
export function foldTurns(items: TranscriptItem[], live: boolean, waiting: boolean): TranscriptItem[] {
  const turns: TranscriptItem[][] = []
  for (const item of items) {
    if (item.kind === 'user' || !turns.length) turns.push([])
    turns.at(-1)!.push(item)
  }
  return turns.flatMap((turn, index) => {
    const user = turn[0]?.kind === 'user' ? turn[0] : undefined
    const notes = turn.filter((item) => item.kind === 'note')
    const body = turn.filter((item) => item !== user && item.kind !== 'end' && item.kind !== 'note')
    const ends = turn.filter((item): item is Extract<TranscriptItem, { kind: 'end' }> => item.kind === 'end')
    const result = ends.find((item) => item.ended)
    const isLast = index === turns.length - 1
    const finished = Boolean(result) || !isLast || (!live && !waiting)
    const startedAt = user?.at ?? body.find((item) => item.at !== undefined)?.at
    if (!finished)
      return [
        ...(user ? [user] : []),
        { kind: 'working' as const, id: `working-${user?.id ?? index}`, since: startedAt },
        ...body,
        ...notes,
      ]
    let start = body.length
    while (start > 0 && body[start - 1]!.kind === 'text') start--
    const work = body.slice(0, start)
    const folded = work.filter(settled)
    const kept = work.filter((item) => !settled(item))
    const endedAt = (result ?? ends[0])?.at ?? body.findLast((item) => item.at !== undefined)?.at
    const done = Boolean(result) && !result!.interrupted
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
  })
}
