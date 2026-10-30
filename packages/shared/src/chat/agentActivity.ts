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
      const detail = event.summary.trim().split('\n')[0]!.slice(0, 80)
      return { label: toolVerb(KIND_VERB[toolKind(event)], true), ...(detail ? { detail } : {}) }
    } else if (event.kind === 'user' || event.kind === 'result') break
  }
  const label = agentActivityLabel(state, events as AgentEvent[])
  return label ? { label } : { label: 'Working' }
}
