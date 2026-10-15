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
