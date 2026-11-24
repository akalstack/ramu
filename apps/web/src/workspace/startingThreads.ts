import { useSyncExternalStore } from 'react'
import type { AgentSettings, Attachment } from '@ramu/shared/types'

/** A thread created from Home whose agent is still starting: the first message, and what is happening now. */
export interface StartingThread {
  text: string
  attachments: Attachment[]
  /** When it was sent, so its day label is the one its turn will carry. */
  sentAt: number
  /** Already translated. */
  status: string
  /** What the thread starts on, shown in its message box until the thread's own settings load. */
  settings: AgentSettings
}

const starting = new Map<string, StartingThread>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Threads Home has created and opened while their agent starts, so the thread view shows the first message where it
 * will stay, from the moment it opens until the host's copy of it arrives.
 */
export const startingThreads = {
  get: (taskId: string) => starting.get(taskId),
  set(taskId: string, thread: StartingThread) {
    starting.set(taskId, thread)
    emit()
  },
  /** What the start is doing now; nothing once the thread has left the list. */
  status(taskId: string, status: string) {
    const thread = starting.get(taskId)
    if (!thread || thread.status === status) return
    starting.set(taskId, { ...thread, status })
    emit()
  },
  delete(taskId: string) {
    if (starting.delete(taskId)) emit()
  },
}

export function useStartingThread(taskId: string): StartingThread | undefined {
  return useSyncExternalStore(subscribe, () => startingThreads.get(taskId))
}
