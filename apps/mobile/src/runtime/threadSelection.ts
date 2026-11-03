import { useSyncExternalStore } from 'react'

/**
 * The threads picked on the Threads tab for one action together. Device-local and short-lived: it is never saved.
 * Selecting stays on with nothing picked until it is cancelled, as in Mail and Files.
 */
export interface ThreadSelectionState {
  on: boolean
  ids: ReadonlySet<string>
}

let state: ThreadSelectionState = { on: false, ids: new Set() }
const listeners = new Set<() => void>()
const publish = (next: ThreadSelectionState) => {
  state = next
  for (const listener of listeners) listener()
}

export const threadSelection = {
  state: (): ThreadSelectionState => state,
  /** Turns selecting on with this thread picked. */
  start(id: string) {
    publish({ on: true, ids: new Set([id]) })
  },
  toggle(id: string) {
    const ids = new Set(state.ids)
    if (!ids.delete(id)) ids.add(id)
    publish({ on: true, ids })
  },
  /** Keeps only threads still listed, after some left the list. */
  keep(listed: ReadonlySet<string>) {
    if (![...state.ids].some((id) => !listed.has(id))) return
    publish({ ...state, ids: new Set([...state.ids].filter((id) => listed.has(id))) })
  },
  clear() {
    if (state.on || state.ids.size) publish({ on: false, ids: new Set() })
  },
}

export function useThreadSelection(): ThreadSelectionState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => state,
  )
}

type Pickable = { status: string; doneAt?: number | null }

/** A thread that is working or waiting for an answer is finished deliberately, one at a time. */
const busy = (chat: Pickable) => chat.status === 'running' || chat.status === 'needs-input'

/**
 * What "Mark done" does for the picked threads: reopen them when every one is done already, otherwise finish the ones
 * that are idle and not done. Archived threads are left alone.
 */
export function donePlan<T extends Pickable>(chats: readonly T[]): { done: boolean; targets: T[] } {
  const live = chats.filter((chat) => chat.status !== 'archived')
  const done = !live.every((chat) => chat.doneAt)
  return { done, targets: live.filter((chat) => (done ? !chat.doneAt && !busy(chat) : !!chat.doneAt)) }
}
