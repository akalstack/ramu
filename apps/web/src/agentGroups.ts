import type { AgentSessionInfo, Task } from '@ramu/shared/types'
import { isLimitHold } from '@ramu/shared/chat/goalHold'

export type AgentGroup = 'Waiting for your input' | 'Running' | 'Limit reached' | 'Done'

/** A thread's own goal, still being worked, keeps it among the running work between turns instead of in Done. */
export const goalActive = (session: AgentSessionInfo, task: Task | undefined) =>
  !session.parentId && task?.goalState?.status === 'active'

/**
 * Independent helpers still running keep their thread among the running work after its own turn ends, the same rule the
 * finished-thread gate applies to notices (`createFinishedGate`), so a list never says Done where a notice would not.
 */
export const helpersActive = (session: AgentSessionInfo, task: Task | undefined) =>
  !session.parentId && (task?.helperSummary?.active ?? 0) > 0

export const groupOf = (session: AgentSessionInfo, task?: Task): AgentGroup =>
  session.state === 'needs-input' || session.pendingInput
    ? 'Waiting for your input'
    : session.waitingUntil || (!session.parentId && isLimitHold(task?.goalState))
      ? 'Limit reached'
      : ['running', 'starting'].includes(session.state) || goalActive(session, task) || helpersActive(session, task)
        ? 'Running'
        : !session.parentId && task?.goalState && ['paused', 'blocked', 'turn-limit'].includes(task.goalState.status)
          ? 'Waiting for your input'
          : 'Done'
