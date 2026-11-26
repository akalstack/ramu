import { KIND_VERB, toolKind } from './agentTools'
import { toolVerb } from './toolStatus'
import type { AgentEvent, AgentSessionState } from '../types'

/**
 * The thread's one live status, as T3 Code keeps it: starting, or working. What the agent is doing within the turn is
 * the transcript's own business (a thinking row, a tool group), so the line never flips between "Thinking" and
 * "Writing" as output streams in; it counts the time instead ("Working for 12s").
 */
export function agentActivityLabel(state: AgentSessionState | undefined): 'Starting…' | 'Working' | null {
  if (state === 'starting') return 'Starting…'
  return state === 'running' ? 'Working' : null
}

/** What the agent shows as work, so a result followed by it means the agent picked the work up again by itself. */
const OUTPUT = new Set<AgentEvent['kind']>(['thinking', 'text', 'content', 'tool-use'])

/**
 * When the stretch of work now running began, so its timer agrees with the turn the transcript draws. A message
 * steered in continues its turn. One steered in too late for the answer heads the work done for it, so that work starts
 * with it. Work the agent picks up by itself after a result, such as a sub-agent reporting back or a goal continuing,
 * starts where it resumed. A result with nothing after it leaves the clock on the turn it closed, which sub-agents may
 * still be working under.
 */
export function turnStartedAt(events: readonly AgentEvent[]): number | null {
  let resumed: number | null = null
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.agentId) continue
    if (event.kind === 'user' && !event.steered) return event.at ?? resumed
    if (event.kind === 'result' && resumed !== null) return lateSteerAt(events, index) ?? resumed
    if (OUTPUT.has(event.kind) && event.at !== undefined) resumed = event.at
  }
  return resumed
}

/** The steered message a result's answer was written without: nothing the agent ran came between it and the result. */
function lateSteerAt(events: readonly AgentEvent[], result: number): number | null {
  for (let index = result - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.agentId) continue
    if (event.kind === 'user') return event.steered ? (event.at ?? null) : null
    if (event.kind === 'tool-use' || event.kind === 'result') return null
  }
  return null
}

const COMMAND_KEYS = ['command', 'query', 'pattern', 'url', 'description']
const PATH_KEYS = ['file_path', 'absolute_path', 'path', 'dir_path']

/** A string argument of a JSON tool input, read even when a long input arrived cut short. */
function argument(summary: string, keys: string[]): string | undefined {
  let input: Record<string, unknown> | null = null
  try {
    input = JSON.parse(summary) as Record<string, unknown>
  } catch {}
  for (const key of keys) {
    const raw = input
      ? input[key]
      : /^"((?:[^"\\]|\\.)*)/.exec(summary.split(`"${key}"`)[1]?.replace(/^\s*:\s*/, '') ?? '')?.[1]
    let value = raw
    if (!input && typeof raw === 'string')
      try {
        value = JSON.parse(`"${raw}"`) as string
      } catch {}
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

/**
 * The command, file or query a tool works on, in one short line. Some providers summarise a call as its JSON input, whose
 * first line is just "{", so the telling argument is read from it instead: a file by its name, a command as written.
 */
export function toolStepDetail(event: { summary: string; locations?: { path: string }[] }): string {
  const summary = event.summary.trim()
  if (!/^[{[]/.test(summary)) return summary.split('\n')[0]!.slice(0, 80)
  const path = argument(summary, PATH_KEYS) ?? event.locations?.[0]?.path
  const line = argument(summary, COMMAND_KEYS) ?? (path ? path.split(/[\\/]/).filter(Boolean).at(-1) : undefined)
  return (line ?? '').trim().split('\n')[0]!.slice(0, 80)
}

/** One action of the running turn, for the working sheet: what it did and whether it has finished. */
export interface TurnStep extends AgentStep {
  done: boolean
}

/** The main agent's latest actions since the person's last message, newest last; at most `limit`. */
export function turnSteps(events: readonly AgentEvent[], limit = 6): TurnStep[] {
  const finished = new Set<string>()
  const steps: TurnStep[] = []
  for (let index = events.length - 1; index >= 0 && steps.length < limit; index--) {
    const event = events[index]!
    if (event.agentId) continue
    if (event.kind === 'user') break
    if (event.kind === 'tool-result' && !event.running) finished.add(event.toolUseId)
    else if (event.kind === 'tool-use') {
      const done = finished.has(event.toolUseId)
      const detail = toolStepDetail(event)
      steps.push({ label: toolVerb(KIND_VERB[toolKind(event)], !done), done, ...(detail ? { detail } : {}) })
    }
  }
  return steps.reverse()
}

/** "12s", "1m 05s", "1h 02m": how long the turn has been working. */
export function elapsedText(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

/** What the agent is doing now, for the line above the composer: "Running" + "pnpm test", or "Working". */
export interface AgentStep {
  label: string
  /** The command, file or query of the running tool. */
  detail?: string
}

export function currentStep(state: AgentSessionState | undefined, events: readonly AgentEvent[]): AgentStep | null {
  if (state === 'starting') return { label: 'Starting…' }
  if (state !== 'running') return null
  const finished = new Set<string>()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.agentId) continue
    if (event.kind === 'tool-result' && !event.running) finished.add(event.toolUseId)
    else if (event.kind === 'tool-use' && !finished.has(event.toolUseId)) {
      const detail = toolStepDetail(event)
      return { label: toolVerb(KIND_VERB[toolKind(event)], true), ...(detail ? { detail } : {}) }
    } else if (event.kind === 'user' || event.kind === 'result') break
  }
  return { label: agentActivityLabel(state) ?? 'Working' }
}
