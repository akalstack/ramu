import type { AgentTask } from '../types'
import { helperActive, helperCounts } from '@ramu/shared/chat/helperPresentation'
export type ActivityKind = 'connection' | 'input' | 'provider' | 'working' | 'helpers' | 'goal' | 'advisor' | 'queue'
export type GoalActivityState = 'active' | 'verifying' | 'paused' | 'blocked' | 'turn-limit' | 'provider'
export interface ActivityRequest {
  id: string
  kind: 'permission' | 'question' | 'elicitation'
  agentId?: string
}
export function threadActivity(input: {
  connected: boolean
  working: boolean
  helpers: AgentTask[]
  advisors: AgentTask[]
  requests: ActivityRequest[]
  providerWait: boolean
  queue: number
  goal?: GoalActivityState | null
}) {
  const counts = helperCounts(input.helpers)
  const kinds: ActivityKind[] = []
  if (!input.connected) kinds.push('connection')
  if (input.requests.length) kinds.push('input')
  if (input.providerWait) kinds.push('provider')
  if (input.working) kinds.push('working')
  if (counts.active) kinds.push('helpers')
  if (input.goal) kinds.push('goal')
  if (input.advisors.some(helperActive)) kinds.push('advisor')
  if (input.queue) kinds.push('queue')
  return {
    primary: kinds[0] ?? null,
    secondary: kinds.slice(1),
    counts,
    requestIds: input.requests.map((r) => r.id),
    queueCount: input.queue,
    permissionCount: input.requests.filter((r) => r.kind === 'permission').length,
    helperIds: input.helpers.map((t) => t.agentId),
    advisorIds: input.advisors.map((t) => t.agentId),
    goalState: input.goal ?? null,
    stale: !input.connected,
  }
}

export function goalActivityLabel(state: GoalActivityState | null): string {
  if (state === 'verifying') return 'Verifying goal'
  if (state === 'turn-limit') return 'Goal turn limit reached'
  // An active goal's pill is just "Goal", as the desktop's chip; only a state that needs a look says more.
  return state === 'active'
    ? 'Goal'
    : state === 'provider'
      ? 'Goal waiting for provider'
      : state === 'blocked'
        ? 'Goal blocked'
        : 'Goal paused'
}
