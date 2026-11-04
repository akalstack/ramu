import { KIND_VERB, toolKind } from './agentTools'
import { toolVerb } from './toolStatus'
import type { AgentEvent, AgentSessionState } from '../types'

/** Use the current turn's main-agent output rather than treating all work as reasoning. */
export function agentActivityLabel(state: AgentSessionState | undefined, events: AgentEvent[]): string | null {
  if (state === 'starting') return 'Starting…'
  if (state !== 'running') return null
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.agentId) continue
    switch (event.kind) {
      case 'user':
      case 'result':
      case 'content':
      case 'plan':
      case 'tool-use':
      case 'tool-result':
      case 'error':
      case 'permission-request':
      case 'question':
      case 'elicitation':
        return 'Working'
      case 'thinking':
        if (event.text.trim()) return 'Thinking'
        break
      case 'text':
        if (event.text.trim()) return 'Writing…'
        break
    }
  }
  return 'Working'
}

/** When the running turn began: the person's latest message, so its timer counts the whole turn. */
export function turnStartedAt(events: readonly AgentEvent[]): number | null {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (!event.agentId && event.kind === 'user') return event.at ?? null
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

/** What the agent is doing now, for the line above the composer: "Running" + "pnpm test", "Thinking", "Writing…". */
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
  const label = agentActivityLabel(state, events as AgentEvent[])
  return label ? { label } : { label: 'Working' }
}
