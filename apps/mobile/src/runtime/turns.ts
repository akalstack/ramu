import type { TranslationValues } from '@ramu/shared/i18n'

/** Translates English catalog copy; the caller passes the app's translator. */
type Say = (text: string, values?: TranslationValues) => string
// Node tests import this file directly, which cannot load the shared translator, so English is filled here.
const english: Say = (text: string, values: TranslationValues = {}) =>
  text.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(values, name) ? String(values[name]) : placeholder,
  )
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
export function foldTurns(
  items: TranscriptItem[],
  live: boolean,
  waiting: boolean,
  say: Say = english,
): TranscriptItem[] {
  const turns: TranscriptItem[][] = []
  // Work after a turn's end opens a turn too: a goal continuing on its own must not fold into the turn that finished.
  let ended = false
  for (const item of items) {
    const output = item.kind === 'text' || item.kind === 'thinking' || item.kind === 'tool'
    if (item.kind === 'user' || !turns.length || (ended && output)) {
      turns.push([])
      ended = false
    }
    turns.at(-1)!.push(item)
    if (item.kind === 'end') ended = true
  }
  return groupTools(
    turns.flatMap((turn, index) => {
      const user = turn[0]?.kind === 'user' ? turn[0] : undefined
      // Notes stay where they happened, as on the desktop: a goal set between tools sits between them, not trailing every
      // new step. Only the notes after the turn's last step (a stop, a settings change) close it.
      const steps = turn.filter((item) => item !== user && item.kind !== 'end')
      let tail = steps.length
      while (tail > 0 && steps[tail - 1]!.kind === 'note') tail--
      const notes = steps.slice(tail)
      const body = steps.slice(0, tail)
      const ends = turn.filter((item): item is Extract<TranscriptItem, { kind: 'end' }> => item.kind === 'end')
      const result = ends.find((item) => item.ended)
      const isLast = index === turns.length - 1
      const finished = Boolean(result) || !isLast || (!live && !waiting)
      const startedAt = user?.at ?? body.find((item) => item.kind !== 'note' && item.at !== undefined)?.at
      // A running turn shows its steps as they come; the status line above the composer says it is working.
      if (!finished) return [...(user ? [user] : []), ...body, ...notes]
      let start = body.length
      while (start > 0 && body[start - 1]!.kind === 'text') start--
      const work = body.slice(0, start)
      const folded = work.filter(settled)
      const kept = work.filter((item) => !settled(item))
      const endedAt =
        (result ?? ends[0])?.at ?? body.findLast((item) => item.kind !== 'note' && item.at !== undefined)?.at
      // A message steered into a running turn starts the next turn before the result; with no stop, failure or idle
      // in between, the agent carried on rather than stopped.
      const done = result ? !result.interrupted : !isLast && !ends.length
      const duration = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined
      const label = done
        ? duration !== undefined
          ? say('Worked for {0}', { 0: formatDuration(duration) })
          : say('Worked')
        : duration !== undefined
          ? say('Stopped after {0}', { 0: formatDuration(duration) })
          : say('Stopped')
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
 * Consecutive tools share one disclosure with all the reasoning around them, in arrival order. Unlike the desktop, the
 * phone keeps a thought that is still streaming inside its group too, whose headline says Thinking meanwhile, so the
 * small screen holds one compact row of work rather than reasoning spread between tools. A lone tool keeps its own
 * row, and reasoning with no tool beside it stands alone.
 */
export function groupTools(items: TranscriptItem[]): TranscriptItem[] {
  const grouped: TranscriptItem[] = []
  let run: Step[] = []
  const flush = () => {
    const tools = run.filter((step) => step.kind === 'tool')
    if (tools.length && run.length > 1) {
      const first = run[0]!
      grouped.push({ kind: 'tools', id: first.id, at: first.at, tools, entries: run })
    } else grouped.push(...run)
    run = []
  }
  for (const item of items) {
    if (item.kind === 'tool' || item.kind === 'thinking') {
      run.push(item)
      continue
    }
    flush()
    grouped.push(item.kind === 'summary' ? { ...item, items: groupTools(item.items) } : item)
  }
  flush()
  return grouped
}
