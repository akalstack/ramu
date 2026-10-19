import type { AgentSessionInfo, Task } from '@ramu/shared/types'

export type AgentGroup = 'Waiting for your input' | 'Running' | 'Limit reached' | 'Done'

/** A thread's own goal, still being worked, keeps it among the running work between turns instead of in Done. */
export const goalActive = (session: AgentSessionInfo, task: Task | undefined) =>
  !session.parentId && task?.goalState?.status === 'active'

export const groupOf = (session: AgentSessionInfo, task?: Task): AgentGroup =>
  session.state === 'needs-input' || session.pendingInput
    ? 'Waiting for your input'
    : session.waitingUntil
      ? 'Limit reached'
      : ['running', 'starting'].includes(session.state) || goalActive(session, task)
        ? 'Running'
        : 'Done'
