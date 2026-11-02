import { threadStatus } from '@ramu/shared/chat/threadStatus'
import type { Task } from '@ramu/shared/types'

/** Done threads gather across projects, including pinned and projectless threads. */
export function sidebarThreads(tasks: Task[]) {
  const visible = tasks.filter((task) => task.status !== 'archived')
  return {
    active: visible.filter((task) => !task.doneAt),
    done: visible.filter((task) => task.doneAt).sort((a, b) => b.doneAt! - a.doneAt!),
  }
}

/** The window's own host keeps its plain keys, so a person's saved tree survives; other hosts are namespaced. */
export const sidebarTreeKey = (host: string, own: string, key: string) => (host === own ? key : `host:${host}:${key}`)

/** One list across hosts, each thread still carrying the source it came from. */
export function mergedThreads<Source>(sources: Source[], threads: (source: Source) => Task[]) {
  return sources.flatMap((source) => threads(source).map((task) => ({ task, source })))
}

const NEEDS_YOU = new Set(['approval', 'input', 'blocked', 'turn-limit'])

/** Work that cannot continue until the person acts. A failure is excluded: it can sit for weeks without blocking anything. */
export function threadNeedsYou(task: Task) {
  const status = threadStatus(task, false, task.goalState)
  return !!status && NEEDS_YOU.has(status.kind)
}

/**
 * A recurring schedule reads as one row, its newest run. An older run stays in the list while it still has something to
 * show: it is open, unread or has a status of its own. Expects `tasks` newest first.
 */
function collapseScheduleRuns(tasks: Task[], keep: (task: Task) => boolean) {
  const newest = new Map<string, Task>()
  const earlierRuns: Record<string, number> = {}
  const visible = tasks.filter((task) => {
    if (!task.scheduleId) return true
    const lead = newest.get(task.scheduleId)
    if (!lead) {
      newest.set(task.scheduleId, task)
      return true
    }
    if (keep(task) || threadStatus(task, false, task.goalState)) return true
    earlierRuns[lead.id] = (earlierRuns[lead.id] ?? 0) + 1
    return false
  })
  return { visible, earlierRuns }
}

/** Use the same bounded project preview for local and remote hosts. Keep the active thread visible. */
export function projectThreadPreview(
  tasks: Task[],
  projectId: string,
  limit: number,
  expanded: boolean,
  activeId?: string | null,
  unread?: ReadonlySet<string>,
) {
  const sorted = tasks
    .filter((task) => task.projectId === projectId && task.status !== 'archived' && !task.doneAt && !task.pinnedAt)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const { visible, earlierRuns } = collapseScheduleRuns(
    sorted,
    (task) => task.id === activeId || !!unread?.has(task.id),
  )
  return {
    tasks: expanded ? sorted : visible.filter((task, index) => index < limit || task.id === activeId),
    hasMore: sorted.length > Math.min(limit, visible.length),
    earlierRuns: expanded ? {} : earlierRuns,
  }
}
