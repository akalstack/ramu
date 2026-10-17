import type { Task } from '@ramu/shared/types'

/** Done threads gather across projects, including pinned and projectless threads. */
export function sidebarThreads(tasks: Task[]) {
  const visible = tasks.filter((task) => task.status !== 'archived')
  return {
    active: visible.filter((task) => !task.doneAt),
    done: visible.filter((task) => task.doneAt).sort((a, b) => b.doneAt! - a.doneAt!),
  }
}

/** Use the same bounded project preview for local and remote hosts. Keep the active thread visible. */
export function projectThreadPreview(
  tasks: Task[],
  projectId: string,
  limit: number,
  expanded: boolean,
  activeId?: string | null,
) {
  const sorted = tasks
    .filter((task) => task.projectId === projectId && task.status !== 'archived' && !task.doneAt && !task.pinnedAt)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return {
    tasks: expanded ? sorted : sorted.filter((task, index) => index < limit || task.id === activeId),
    hasMore: sorted.length > limit,
  }
}
