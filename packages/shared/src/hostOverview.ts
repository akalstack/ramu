import type { AgentSessionInfo, LibrarySummary, Project, RecapItem, Task } from './types'

/** Every row is addressed by host and resource ID together. */
export interface HostOverview {
  projects: Project[]
  tasks: Task[]
  agents: AgentSessionInfo[]
  recaps: RecapItem[]
  summaries: LibrarySummary[]
  errors: string[]
  /** Null when the host refuses or lacks the reading; a viewer device never has it. */
  resources?: import('./resources').HostResources | null
}

export type HostDestination =
  | { kind: 'task'; taskId: string; sessionId?: string }
  | { kind: 'project'; projectId: string }
  | { kind: 'new'; projectId?: string }
  | { kind: 'summary'; summaryId: string }
  | { kind: 'inbox' }
  | { kind: 'host' }

export function isHostDestination(value: unknown): value is HostDestination {
  if (!value || typeof value !== 'object') return false
  const d = value as Record<string, unknown>
  const id = (key: string) => typeof d[key] === 'string' && (d[key] as string).length > 0
  switch (d.kind) {
    case 'task':
      return id('taskId') && (d.sessionId === undefined || id('sessionId'))
    case 'project':
      return id('projectId')
    case 'new':
      return d.projectId === undefined || id('projectId')
    case 'summary':
      return id('summaryId')
    case 'inbox':
    case 'host':
      return true
    default:
      return false
  }
}

/** Translate host-owned tasks into the same inbox model used on mobile. IDs remain scoped without parsing them. */
export function hostInboxInput(hosts: { id: string; data?: HostOverview }[]) {
  return {
    chats: hosts.flatMap(({ id, data }) =>
      (data?.tasks ?? []).map((task) => {
        const sessions = data!.agents.filter((agent) => agent.taskId === task.id)
        const priority = (agent: AgentSessionInfo) =>
          agent.state === 'needs-input' || agent.pendingInput
            ? 2
            : agent.state === 'running' || agent.state === 'starting' || agent.waitingUntil
              ? 1
              : 0
        const session = [...sessions].sort((a, b) => priority(b) - priority(a) || b.createdAt - a.createdAt)[0]
        const needsInput = sessions.some((agent) => agent.state === 'needs-input' || agent.pendingInput)
        const running = sessions.some(
          (agent) => agent.state === 'running' || agent.state === 'starting' || agent.waitingUntil,
        )
        return {
          id: JSON.stringify([id, task.id]),
          computerId: id,
          taskId: task.id,
          status:
            task.status === 'archived'
              ? task.status
              : needsInput
                ? ('needs-input' as const)
                : running
                  ? ('running' as const)
                  : task.status,
          inputSummary: task.inputSummary,
          goalState: task.goalState,
          lastActiveAt: task.lastActiveAt,
          sessionId: session?.nativeTask ? (session.parentId ?? null) : (session?.id ?? null),
          doneAt: task.doneAt,
        }
      }),
    ),
    recaps: hosts.flatMap(({ id, data }) => (data?.recaps ?? []).map((item) => ({ computerId: id, item }))),
    summaries: hosts.flatMap(({ id, data }) => (data?.summaries ?? []).map((summary) => ({ computerId: id, summary }))),
    lowMemory: hosts.flatMap(({ id, data }) => {
      const low = data?.resources?.low
      return low ? [{ computerId: id, low }] : []
    }),
  }
}

/** Narrow set of thread commands available from a host group in the sidebar. */
export type HostTaskMethod = 'tasks.rename' | 'tasks.pin' | 'tasks.done' | 'tasks.archive' | 'tasks.delete'
export function isHostTaskCommand(method: unknown, args: unknown): method is HostTaskMethod {
  if (!Array.isArray(args) || args.length !== 2 || typeof args[0] !== 'string' || !args[0]) return false
  if (method === 'tasks.rename') return typeof args[1] === 'string' && !!args[1].trim()
  return (
    ['tasks.pin', 'tasks.done', 'tasks.archive', 'tasks.delete'].includes(method as string) &&
    typeof args[1] === 'boolean'
  )
}
