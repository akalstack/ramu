import type { ChatGoal } from '../types/goal'
import { goalContinues } from './goalHold'

/**
 * Decides when a thread has really finished, so every notifier agrees with the thread list: a goal that continues or is
 * blocked is not finished, and neither is a thread whose independent helpers are still running. A finished notice that
 * is held for helpers goes out on the next idle state once they have settled.
 */
export function createFinishedGate() {
  const held = new Set<string>()
  return {
    /**
     * Call for each session state event. `turnEnded` is true when the session was working before this idle event.
     * Returns whether a finished notice should be sent now.
     */
    settle(
      id: string,
      state: string,
      input: { turnEnded: boolean; goal?: Pick<ChatGoal, 'status' | 'pausedBy'> | null; helpers: number },
    ): boolean {
      if (state !== 'idle') {
        held.delete(id)
        return false
      }
      if (!input.turnEnded && !held.has(id)) return false
      if (input.goal && (goalContinues(input.goal) || input.goal.status === 'blocked')) {
        held.delete(id)
        return false
      }
      if (input.helpers > 0) {
        held.add(id)
        if (held.size > 500) held.delete(held.values().next().value!)
        return false
      }
      held.delete(id)
      return true
    },
  }
}
