import type { AgentEvent, ChatGoal } from './types'

export type GoalChangeType = 'set' | 'edited' | 'paused' | 'resumed' | 'blocked' | 'turn-limit' | 'cleared'
export type GoalChange = { type: GoalChangeType; goal: ChatGoal }

/**
 * The goal events worth a line in the transcript. Every status tick is recorded, but the history only needs the turning points:
 * a goal set or edited, paused, resumed, blocked, out of turns or cleared. Completion has its own row at the end of its turn,
 * and provider waits and turn counts belong to the live tray.
 */
export function goalChanges(events: readonly AgentEvent[]): Map<AgentEvent, GoalChange> {
  const changes = new Map<AgentEvent, GoalChange>()
  let previous: ChatGoal | null = null
  for (const event of events) {
    if (event.kind !== 'goal') continue
    const goal = event.goal
    const add = (type: GoalChangeType, shown: ChatGoal) => {
      changes.set(event, { type, goal: shown })
    }
    if (!goal) {
      if (previous && previous.status !== 'completed') add('cleared', previous)
    } else if (!previous || previous.id !== goal.id) {
      if (goal.status !== 'completed') add('set', goal)
    } else if (previous.status === 'completed') {
      /* a finished goal is closed; its row is the completion */
    } else if (goal.objective !== previous.objective) add('edited', goal)
    else if (goal.status !== previous.status) {
      if (goal.status === 'paused') add('paused', goal)
      else if (goal.status === 'blocked') add('blocked', goal)
      else if (goal.status === 'turn-limit') add('turn-limit', goal)
      else if (goal.status === 'active' && previous.status !== 'waiting-provider') add('resumed', goal)
    }
    previous = goal
  }
  return changes
}
