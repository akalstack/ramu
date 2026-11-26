import type { TranslationValues } from '@ramu/shared/i18n'
import type { AgentTask } from '@ramu/shared/types'
import { holdsTurn, turnWorkEnd } from '@ramu/shared/chat/helperPresentation'

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
 * Mirrors the desktop's per-turn layout. The running turn shows its steps as they come. Once a turn is done its routine
 * steps fold into one "Worked for …" row; the answer, failed or open steps, and unanswered prompts stay visible. That
 * row keeps counting as "Working for …" while the thread is still at work under it, and work the agent picks up by
 * itself after a clean result reads "Continued for …", as more of the turn above.
 */
export function foldTurns(
  items: TranscriptItem[],
  live: boolean,
  waiting: boolean,
  say: Say = english,
  /** Background commands the agent said it was waiting on; they are not transcript items. */
  awaited: readonly AgentTask[] = [],
): TranscriptItem[] {
  const turns: TranscriptItem[][] = []
  // Work after a turn's end opens a turn too: a goal continuing on its own must not fold into the turn that finished.
  let ended = false
  for (const item of items) {
    const output = item.kind === 'text' || item.kind === 'thinking' || item.kind === 'tool'
    // A message steered into a running turn continues it: one start, one timer, one "Worked for".
    const opens = item.kind === 'user' && !(item.steered && turns.length)
    if (opens || !turns.length || (ended && output)) {
      // A message steered in while the answer was already being written: no step followed it, so the provider ran it as
      // this next turn. It heads that turn, as on the desktop, instead of sitting above an answer that never saw it.
      const before = !opens && turns.length ? turns.at(-1)! : []
      const at = before.findLastIndex((entry) => entry.kind === 'user' && entry.steered)
      const late = at > 0 && !before.slice(at + 1).some((entry) => entry.kind === 'tool') ? before.splice(at, 1) : []
      turns.push(late)
      ended = false
    }
    turns.at(-1)!.push(item)
    if (item.kind === 'end') ended = true
  }
  const helpersOf = (turn: TranscriptItem[]) =>
    turn.flatMap((item) => (item.kind === 'agents' && !item.advisor ? item.agents : []))
  const cleanEnd = (turn: TranscriptItem[] | undefined) =>
    !!turn?.some((item) => item.kind === 'end' && item.ended && !item.interrupted)
  const startOf = (turn: TranscriptItem[] | undefined) => turn?.find((item) => item.at !== undefined)?.at
  // Sub-agents and awaited commands still running keep the thread working after the main agent's result.
  const helpersWorking =
    awaited.some(holdsTurn) || items.some((item) => item.kind === 'agents' && item.agents.some(holdsTurn))
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
      const clean = !!result && !result.interrupted
      // A clean result's turn lasted until the sub-agents it started and the commands it waited on were done, since the
      // person watched them under it.
      const endedAt = clean
        ? turnWorkEnd(result.at, [...helpersOf(turn), ...awaited], startOf(turns[index + 1]))
        : ((result ?? ends[0])?.at ?? body.findLast((item) => item.kind !== 'note' && item.at !== undefined)?.at)
      // The result is in, yet the thread is still at work under this turn: its clock keeps running until the thread stops.
      const resumed = isLast && clean && !waiting && (live || helpersWorking)
      const continues = !user && cleanEnd(turns[index - 1])
      // A message steered into a running turn starts the next turn before the result; with no stop, failure or idle
      // in between, the agent carried on rather than stopped.
      const done = result ? !result.interrupted : !isLast && !ends.length
      const duration = startedAt !== undefined && endedAt !== undefined ? Math.max(0, endedAt - startedAt) : undefined
      const total = done
        ? duration !== undefined
          ? say(continues ? 'Continued for {0}' : 'Worked for {0}', { 0: formatDuration(duration) })
          : say(continues ? 'Continued' : 'Worked')
        : duration !== undefined
          ? say('Stopped after {0}', { 0: formatDuration(duration) })
          : say('Stopped')
      // Each steered message starts a part. Only the last part ends in the answer; earlier ones fold whole, since what the
      // agent said there was overtaken by the steer. The first fold carries the turn's whole time, later ones how long
      // the work went on after their steer.
      const parts: { steer?: TranscriptItem; items: TranscriptItem[] }[] = [{ items: [] }]
      for (const item of body)
        if (item.kind === 'user' && item.steered) parts.push({ steer: item, items: [] })
        else parts.at(-1)!.items.push(item)
      let first = true
      const shown = parts.flatMap((part, p) => {
        const last = p === parts.length - 1
        let start = part.items.length
        if (last) while (start > 0 && part.items[start - 1]!.kind === 'text') start--
        const work = part.items.slice(0, start)
        const folded = work.filter(settled)
        const kept = work.filter((item) => !settled(item))
        const from = part.steer && 'at' in part.steer ? part.steer.at : startedAt
        const to = last ? endedAt : part.items.findLast((item) => item.kind !== 'note' && item.at !== undefined)?.at
        const span = from !== undefined && to !== undefined ? Math.max(0, to - from) : undefined
        const label = first
          ? total
          : span !== undefined
            ? say('Continued for {0}', { 0: formatDuration(span) })
            : say('Continued')
        const since = first ? startedAt : from
        const running =
          resumed && since !== undefined && (first || last)
            ? { since, text: first && !continues ? ('Working for {0}' as const) : ('Continuing for {0}' as const) }
            : undefined
        if (folded.length) first = false
        return [
          ...(part.steer ? [part.steer] : []),
          ...(folded.length
            ? [
                {
                  kind: 'summary' as const,
                  id: `summary-${part.steer?.id ?? user?.id ?? index}`,
                  label,
                  ...(running ? { running } : {}),
                  items: folded,
                },
              ]
            : []),
          ...kept,
          ...part.items.slice(start),
        ]
      })
      return [...(user ? [user] : []), ...shown, ...notes]
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
