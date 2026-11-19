// What this device last read of another host's workspace, so that host can be opened while it is unreachable: its
// threads listed, their kept transcripts shown, and messages written there held in the outbox until it is back.
import type { Project, Repository, Task, WorktreeWorkspace } from '@ramu/shared/types'
import { LOCAL_HOST } from '../hosts'
import { storeForHost } from '../hostStorage'
import { readLastOverview } from './lastOverview'

const KEY = 'ramu.workspace.copy'
/** Saves stay well inside the browser's storage quota; older threads past this many are left out. */
const MAX_TASKS = 400

export interface OfflineCopy {
  projects: Project[]
  tasks: Task[]
  workspaces: WorktreeWorkspace[]
  repos: Record<string, Repository[]>
}

/** This machine's own host is never unreachable from its window, so only other hosts keep a copy. */
export const keepsOfflineCopy = (host: string) => host !== LOCAL_HOST

const present = new Map<string, boolean>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** Coalesced: a working host refreshes its lists in bursts, and only the latest matters. */
export function saveOfflineCopy(host: string, copy: OfflineCopy) {
  if (!keepsOfflineCopy(host)) return
  present.set(host, true)
  clearTimeout(timers.get(host))
  timers.set(
    host,
    setTimeout(() => {
      timers.delete(host)
      const tasks = [...copy.tasks].sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, MAX_TASKS)
      try {
        storeForHost(host)?.setItem(KEY, JSON.stringify({ ...copy, tasks }))
      } catch {
        // Storage full or unavailable: the last overview still lists the host's threads.
      }
    }, 2000),
  )
}

/** The last full read of the host, else its last sidebar overview (projects and threads, no repositories). */
export function readOfflineCopy(host: string): OfflineCopy | null {
  if (!keepsOfflineCopy(host)) return null
  try {
    const saved = JSON.parse(storeForHost(host)?.getItem(KEY) ?? 'null') as Partial<OfflineCopy> | null
    if (saved && Array.isArray(saved.projects) && Array.isArray(saved.tasks))
      return {
        projects: saved.projects,
        tasks: saved.tasks,
        workspaces: Array.isArray(saved.workspaces) ? saved.workspaces : [],
        repos: saved.repos && typeof saved.repos === 'object' ? saved.repos : {},
      }
  } catch {
    // An unreadable copy falls back to the overview.
  }
  const overview = readLastOverview(host)
  return overview ? { projects: overview.projects, tasks: overview.tasks, workspaces: [], repos: {} } : null
}

/** Whether the host can be opened while unreachable. Read once per host: a copy, once made, is kept. */
export function hasOfflineCopy(host: string): boolean {
  const known = present.get(host)
  if (known !== undefined) return known
  const found = readOfflineCopy(host) !== null
  // A host with no copy yet may get one from its overview soon, so only a found copy is remembered.
  if (found) present.set(host, true)
  return found
}
