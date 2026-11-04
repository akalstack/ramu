import type { AgentEvent, AgentTask } from '../types'
import {
  latestTasks,
  parseAdvice,
  parseTaskMessage,
  parseTaskReport,
  parseTaskStop,
} from '@ramu/shared/chat/agentTasks'
import { parseAnswerMessage } from '@ramu/shared/chat/questions'

export const helperIdentity = (host: string, session: string, helper: string): string =>
  JSON.stringify([host, session, helper])
export const helperActive = (task: AgentTask): boolean => task.status === 'running' && !task.recovered
/** The agent's own background shell commands still running, such as a dev server; they are not helpers in the transcript. */
export const runningCommands = (events: AgentEvent[]): AgentTask[] =>
  latestTasks(events).filter((task) => task.taskType === 'local_bash' && task.background && helperActive(task))
export function helperActions(task: AgentTask, connected: boolean) {
  return {
    canMessage: connected && task.canMessage === true,
    canStop: connected && helperActive(task) && task.canStop === true,
  }
}
export function helperElapsed(task: AgentTask, now: number): number | null {
  if (task.startedAt === undefined) return task.durationMs === undefined ? null : Math.max(0, task.durationMs)
  const end = task.endedAt ?? (task.status === 'running' ? now : undefined)
  return end === undefined ? (task.durationMs ?? null) : Math.max(0, end - task.startedAt)
}
export function helperCounts(tasks: AgentTask[]) {
  return {
    total: tasks.length,
    active: tasks.filter(helperActive).length,
    completed: tasks.filter((t) => t.status === 'completed').length,
    failed: tasks.filter((t) => t.status === 'failed').length,
    stopped: tasks.filter((t) => t.status === 'stopped').length,
    waiting: tasks.filter((t) => helperActive(t) && t.waitingFor).length,
  }
}
export function helperStatusLabel(task: AgentTask): string {
  if (task.recovered && task.status === 'running') return 'Recovered activity'
  if (task.status !== 'running') return { completed: 'Completed', failed: 'Failed', stopped: 'Stopped' }[task.status]
  return task.waitingFor === 'input'
    ? 'Waiting for input'
    : task.waitingFor === 'provider'
      ? 'Waiting for provider'
      : 'Working'
}
/**
 * What kind of helper this is, for the small tag beside its name: a teammate you added (and how it works), the
 * thread's advisor, a background command, or a sub-agent the agent started (and its type, such as Explore).
 */
export function helperRole(task: Pick<AgentTask, 'teammate' | 'taskType' | 'agentType'>): {
  role: 'teammate' | 'advisor' | 'command' | 'subagent'
  label: string
  detail?: string
} {
  if (task.teammate)
    return { role: 'teammate', label: 'Teammate', detail: task.teammate === 'take-over' ? 'Take over' : 'Review' }
  if (task.taskType === 'advisor') return { role: 'advisor', label: 'Advisor' }
  if (task.taskType === 'local_bash') return { role: 'command', label: 'Command' }
  return {
    role: 'subagent',
    label: 'Sub-agent',
    ...(task.agentType && !/^general/i.test(task.agentType) ? { detail: task.agentType } : {}),
  }
}

/** The status words a helper's report back uses, the same as its card's. */
export const REPORT_STATUS: Record<string, string> = {
  finished: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  'is still working': 'Still working',
  says: 'Note',
  asks: 'Question',
}

const rank = (task: AgentTask) =>
  task.waitingFor === 'input' && helperActive(task) ? 0 : helperActive(task) ? 1 : task.status === 'failed' ? 2 : 3
export const sortHelpers = (tasks: AgentTask[]): AgentTask[] => [...tasks].sort((a, b) => rank(a) - rank(b))
export const isUserTurn = (event: AgentEvent): boolean =>
  event.kind === 'user' &&
  !event.agentId &&
  !parseTaskReport(event.text) &&
  !parseAdvice(event.text) &&
  !parseTaskMessage(event.text) &&
  !parseTaskStop(event.text) &&
  !parseAnswerMessage(event.text)

export interface HelperGroup {
  id: string
  anchor: number | null
  launchIndex: number
  tasks: AgentTask[]
  advisor: boolean
}
/** Launch membership stays historical; state always comes from the latest task record. */
export function helperGroups(events: AgentEvent[]): {
  groups: HelperGroup[]
  selected: AgentTask[]
  advisors: AgentTask[]
  history: AgentTask[]
} {
  const latest = latestTasks(events).filter((task) => task.taskType !== 'local_bash')
  const launches = new Map<string, number>()
  const tools = new Map<string, number>()
  const anchors: (number | null)[] = []
  let anchor: number | null = null
  events.forEach((event, index) => {
    if (isUserTurn(event)) anchor = index
    anchors[index] = anchor
    if (event.kind === 'tool-use' && !event.agentId && !tools.has(event.toolUseId)) tools.set(event.toolUseId, index)
    if (event.kind === 'agent' && !launches.has(event.agentId)) launches.set(event.agentId, index)
  })
  const groups = new Map<string, HelperGroup>()
  for (const task of latest) {
    const index = launches.get(task.agentId) ?? -1
    const tool = task.toolUseId ? (tools.get(task.toolUseId) ?? -1) : -1
    const start = tool >= 0 ? tool : index
    const knownAnchor = task.recovered && tool < 0 ? null : (anchors[start] ?? null)
    const advisor = task.taskType === 'advisor'
    const id = `${advisor ? 'advice' : 'agents'}:${knownAnchor ?? 'earlier'}`
    const group = groups.get(id) ?? { id, anchor: knownAnchor, launchIndex: Math.max(0, start), tasks: [], advisor }
    group.tasks.push(task)
    groups.set(id, group)
  }
  const selected = [...groups.values()]
    .filter((g) => !g.advisor)
    .flatMap((g) => g.tasks.filter((t) => (g.anchor === anchor && anchor !== null) || helperActive(t)))
  const advisors = latest.filter((task) => task.taskType === 'advisor')
  return {
    groups: [...groups.values()].sort((a, b) => a.launchIndex - b.launchIndex),
    selected: sortHelpers(selected),
    advisors,
    history: latest.filter((t) => t.taskType !== 'advisor' && !selected.includes(t)),
  }
}
