// New threads started while their host is unreachable wait here, on this computer, under an id made here. Once the
// host is back each is created there and its first message sent; the id doubles as the creation request id, so a
// retry after a lost reply never makes a second thread.
import { useSyncExternalStore } from 'react'
import type { AgentSettings, FileContext } from '@ramu/shared/types'
import { NO_PROJECT } from '@ramu/shared/types'

const KEY = 'ramu.pendingThreads'
/** Per host; past this the composer refuses rather than piling up threads that would all start at once later. */
export const PENDING_THREAD_LIMIT = 10

export interface PendingThread {
  id: string
  hostId: string
  /** Null: chosen automatically when the host is back, as Auto does. */
  projectId: string | null
  mode: 'current' | 'worktree'
  workspaceId?: string
  title: string
  prompt: string
  settings: AgentSettings
  context: FileContext[]
  createdAt: number
  /** `failed` waits for Retry, Move or Remove: the host may or may not have the thread. */
  state: 'waiting' | 'sending' | 'failed'
  error?: string
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

export function createPendingThreads(store: Store | null) {
  const listeners = new Set<() => void>()
  const read = (): PendingThread[] => {
    try {
      const saved = JSON.parse(store?.getItem(KEY) ?? '[]') as PendingThread[]
      if (!Array.isArray(saved)) return []
      // One cut off mid-send by closing the window may exist on the host already, so it needs a person to decide.
      return saved
        .filter((item) => item && typeof item.id === 'string' && typeof item.hostId === 'string')
        .map((item) =>
          item.state === 'sending'
            ? { ...item, state: 'failed', error: 'The app closed while starting this thread. Check the host first.' }
            : item,
        )
    } catch {
      return []
    }
  }
  let items = read()
  const write = (next: PendingThread[]) => {
    items = next
    try {
      store?.setItem(KEY, JSON.stringify(next))
    } catch {
      /* Kept in memory for this session when storage is full or blocked. */
    }
    for (const listener of listeners) listener()
  }
  return {
    snapshot: () => items,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    add(item: Omit<PendingThread, 'id' | 'createdAt' | 'state'>, id: string = crypto.randomUUID(), now = Date.now()) {
      if (items.filter((entry) => entry.hostId === item.hostId).length >= PENDING_THREAD_LIMIT)
        throw new Error('Too many threads are waiting for this host. Send them first, or remove some.')
      const added: PendingThread = { ...item, id, createdAt: now, state: 'waiting' }
      write([...items, added])
      return added
    },
    update(id: string, patch: Partial<PendingThread>) {
      write(items.map((item) => (item.id === id ? { ...item, ...patch } : item)))
    },
    remove(id: string) {
      write(items.filter((item) => item.id !== id))
    },
    /** To another host before it sends; its project there is chosen automatically, as Auto does. */
    move(id: string, hostId: string) {
      write(
        items.map((item) =>
          item.id === id
            ? { ...item, hostId, projectId: null, workspaceId: undefined, state: 'waiting', error: undefined }
            : item,
        ),
      )
    },
  }
}

let shared: ReturnType<typeof createPendingThreads> | null = null
export function pendingThreads() {
  if (!shared) {
    let store: Store | null
    try {
      store = window.localStorage
    } catch {
      store = null
    }
    shared = createPendingThreads(store)
  }
  return shared
}

export function usePendingThreads(hostId?: string): PendingThread[] {
  const box = pendingThreads()
  const all = useSyncExternalStore(box.subscribe, box.snapshot)
  return hostId ? all.filter((item) => item.hostId === hostId) : all
}

type Invoke = (method: string, ...args: unknown[]) => Promise<unknown>

/**
 * Starts one waiting thread on its host: the project (chosen now when it was Auto), the thread, its checkout and its
 * first message. Returns the new thread and session.
 */
export async function deliverPendingThread(
  item: PendingThread,
  invoke: Invoke,
): Promise<{ taskId: string; sessionId: string }> {
  let projectId = item.projectId
  if (projectId === null) {
    const outcome = (await invoke('projects.route', item.prompt || item.title, item.settings, {})) as {
      kind: string
      projectId?: string
    }
    projectId = outcome.kind === 'resolved' && outcome.projectId ? outcome.projectId : NO_PROJECT
  }
  const task = (await invoke('tasks.create', {
    projectId,
    title: item.title,
    mode: item.mode,
    workspaceId: item.workspaceId,
    requestId: item.id,
  })) as { id: string }
  if (item.mode === 'worktree') {
    const bindings = (await invoke('tasks.setup', task.id)) as { setupState: string }[]
    if (bindings.some((binding) => binding.setupState !== 'ready'))
      throw new Error('The worktree could not be set up. Open the thread to retry its setup.')
  }
  const session = (await invoke('agent.start', task.id, item.prompt, item.settings, [], item.context)) as {
    id: string
  }
  return { taskId: task.id, sessionId: session.id }
}
