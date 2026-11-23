import { useSyncExternalStore } from 'react'

/** A thread created from Home whose agent is still starting: the first message, and what is happening now. */
export interface StartingThread {
  text: string
  status: string
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
 * Threads Home has created and opened while their agent starts, so the thread view can show the first message at once
 * instead of the empty "start a chat" composer it shows a thread with no conversation.
 */
export const startingThreads = {
  set(taskId: string, thread: StartingThread) {
    starting.set(taskId, thread)
    emit()
  },
  delete(taskId: string) {
    if (starting.delete(taskId)) emit()
  },
}

export function useStartingThread(taskId: string): StartingThread | undefined {
  return useSyncExternalStore(subscribe, () => starting.get(taskId))
}
