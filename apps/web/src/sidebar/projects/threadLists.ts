import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { collapseScheduleRuns } from '@ramu/shared/chat/scheduleRuns'
import { NO_PROJECT, type Project, type Task } from '@ramu/shared/types'
import { t } from '../../i18n'

/** Done threads gather across projects, including pinned and projectless threads. */
export function sidebarThreads(tasks: Task[]) {
  const visible = tasks.filter((task) => task.status !== 'archived')
  return {
    active: visible.filter((task) => !task.doneAt),
    done: visible.filter((task) => task.doneAt).sort((a, b) => b.doneAt! - a.doneAt!),
  }
}

/** Archived threads, most recently active first, for the sidebar's Archived view. */
export const archivedThreads = (tasks: Task[]) =>
  tasks.filter((task) => task.status === 'archived').sort((a, b) => b.lastActiveAt - a.lastActiveAt)

/** Opens the Archived view: the sidebar's foot, the command menu and Settings search all lead here. */
export const openArchivedThreads = () => window.dispatchEvent(new Event('ramu:archived'))

/** The project a row names in a list across projects; a thread outside any project says so rather than naming none. */
export const threadProjectName = (projects: Project[], projectId: string) =>
  projectId === NO_PROJECT ? t('No project') : projects.find((project) => project.id === projectId)?.name

/** The window's own host keeps its plain keys, so a person's saved tree survives; other hosts are namespaced. */
export const sidebarTreeKey = (host: string, own: string, key: string) => (host === own ? key : `host:${host}:${key}`)

/**
 * Every stored key that closes a section whose open state is shared by all hosts. A section closed under one host's
 * namespace counts too, so a choice made while that host was on screen still holds.
 */
export const sharedSectionKeys = (collapsed: readonly string[], key: string) =>
  collapsed.filter((entry) => entry === key || (entry.startsWith('host:') && entry.endsWith(`:${key}`)))

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
