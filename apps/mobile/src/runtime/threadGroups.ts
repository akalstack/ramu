/** Threads that need someone, or are still working, are never hidden by a group's cap. */
const active = (status: string) => status === 'running' || status === 'needs-input' || status === 'failed'

/**
 * As on the desktop, threads marked done leave their projects, Pinned and the standalone bucket for one Done list, most
 * recently finished first. Sending a message reopens a thread, which brings it back.
 */
export function splitDone<T extends { doneAt?: number | null }>(threads: readonly T[]): { open: T[]; done: T[] } {
  return {
    open: threads.filter((thread) => !thread.doneAt),
    done: threads.filter((thread) => thread.doneAt).sort((a, b) => b.doneAt! - a.doneAt!),
  }
}

/** Projects are qualified by host: two hosts can both have a standalone bucket or a colliding project ID. */
export const groupKey = (computerId: string, projectId: string) => `${computerId}\u0000${projectId}`

/**
 * Where each host's project lands: its own key, or with the rest of its repository when hosts merge. Threads of a
 * project the list does not know keep their own key.
 */
export function groupKeys(
  projects: readonly { id: string; computerId: string; repository?: string }[],
  mergeHosts: boolean,
): (computerId: string, projectId: string) => string {
  const keyOf = new Map<string, string>()
  for (const project of projects) {
    const own = groupKey(project.computerId, project.id)
    keyOf.set(own, mergeHosts && project.repository ? `repository\u0000${project.repository}` : own)
  }
  return (computerId, projectId) => {
    const own = groupKey(computerId, projectId)
    return keyOf.get(own) ?? own
  }
}

/** Projects groups threads under their project; Recent threads is one list by latest activity (the desktop's "Sidebar shows"). */
export type ThreadListMode = 'projects' | 'recent'

/** This phone's own choice, kept with the other phone-only drafts; never sent to a host. */
export const THREAD_LIST_KEY = 'pref-device:threadList'

/** A value from this phone, all your phones (a boolean) or the host's `recentChatMode`; anything else is not set. */
export const readThreadList = (value: unknown): ThreadListMode | undefined =>
  value === 'recent' || value === true ? 'recent' : value === 'projects' || value === false ? 'projects' : undefined

export type ThreadGroup<T, P> = {
  key: string
  computerId: string
  projectId: string
  /** Undefined for threads outside any project (standalone) or a project the device no longer lists. */
  project?: P
  /** Rows to draw, newest first. Empty while the group is collapsed. */
  threads: T[]
  total: number
  /** Threads still out of view; 0 when everything shows. */
  hidden: number
  /** Running, waiting and failed threads, so a collapsed header can still say work needs attention. */
  running: number
  attention: number
  /**
   * The same repository's project on every host that has it, when groups merge across hosts; the group's own
   * `computerId`, `projectId` and `project` are the one worked in last. Absent for a group of one host.
   */
  members?: { computerId: string; projectId: string; project: P }[]
}

/**
 * Home's project view: every project gets a group (empty ones too, so its menu stays reachable), in the order given,
 * which is the host's own (the one the desktop shows and reorders), so a new message never moves a project. Threads
 * outside any project come last. Each group shows its newest `limit` threads plus any active one, all of them once
 * expanded, and none while collapsed.
 */
export function groupThreads<
  T extends { computerId: string; projectId: string; status: string; lastActiveAt: number },
  P extends { id: string; computerId: string; repository?: string },
>(
  threads: readonly T[],
  projects: readonly P[],
  options: {
    limit: number
    expanded: ReadonlySet<string>
    collapsed: ReadonlySet<string>
    /** One group for a repository however many hosts have it, as T3 Code groups by repository. */
    mergeHosts?: boolean
  },
): ThreadGroup<T, P>[] {
  type Bucket = {
    computerId: string
    projectId: string
    project?: P
    threads: T[]
    members: { computerId: string; projectId: string; project: P }[]
  }
  const buckets = new Map<string, Bucket>()
  const keyOf = groupKeys(projects, !!options.mergeHosts)
  for (const project of projects) {
    const key = keyOf(project.computerId, project.id)
    const member = { computerId: project.computerId, projectId: project.id, project }
    const bucket = buckets.get(key)
    if (bucket) bucket.members.push(member)
    else buckets.set(key, { ...member, threads: [], members: [member] })
  }
  for (const thread of threads) {
    const key = keyOf(thread.computerId, thread.projectId)
    const bucket = buckets.get(key) ?? {
      computerId: thread.computerId,
      projectId: thread.projectId,
      threads: [],
      members: [],
    }
    bucket.threads.push(thread)
    buckets.set(key, bucket)
  }
  // Projects first in the order given; a project the device no longer lists, then standalone threads, follow.
  return (
    [...buckets.entries()]
      .map(([key, bucket]) => {
        const sorted = [...bucket.threads].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        const visible = options.collapsed.has(key)
          ? []
          : options.expanded.has(key)
            ? sorted
            : sorted.filter((thread, index) => index < options.limit || active(thread.status))
        // A merged group acts on the host it was last worked on, so its menu and New thread go where the work is.
        const lead =
          bucket.members.length > 1
            ? (bucket.members.find(
                (member) =>
                  sorted[0] && member.computerId === sorted[0].computerId && member.projectId === sorted[0].projectId,
              ) ?? bucket.members[0]!)
            : undefined
        return {
          key,
          computerId: lead?.computerId ?? bucket.computerId,
          projectId: lead?.projectId ?? bucket.projectId,
          project: lead?.project ?? bucket.project,
          ...(bucket.members.length > 1 ? { members: bucket.members } : {}),
          threads: visible,
          total: sorted.length,
          hidden: sorted.length - visible.length,
          running: sorted.filter((thread) => thread.status === 'running').length,
          attention: sorted.filter((thread) => thread.status === 'needs-input' || thread.status === 'failed').length,
        }
      })
      // The sort is stable, so listed projects keep the order they were given in.
      .sort((a, b) => Number(!a.project) - Number(!b.project))
  )
}

/** A host's project ids with one moved a place up (-1) or down (1); null at the edge, where there is nowhere to go. */
export function moveProject(ids: readonly string[], id: string, by: -1 | 1): string[] | null {
  const at = ids.indexOf(id)
  const to = at + by
  if (at < 0 || to < 0 || to >= ids.length) return null
  const next = [...ids]
  ;[next[at], next[to]] = [next[to]!, next[at]!]
  return next
}
