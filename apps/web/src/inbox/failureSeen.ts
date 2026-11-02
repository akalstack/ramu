import { useSyncExternalStore } from 'react'

// Which failures this device has opened. Each remembers the activity time it was seen at, so a retry that fails again
// asks for the person once more.
const KEY = 'ramu.failures-seen'
const LIMIT = 300

type Seen = Record<string, number>
const listeners = new Set<() => void>()
const read = (): Seen => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Seen
  } catch {
    return {}
  }
}
let seen = read()
const keyOf = (hostId: string, taskId: string) => JSON.stringify([hostId, taskId])

export function markFailureSeen(hostId: string, taskId: string, lastActiveAt: number) {
  const key = keyOf(hostId, taskId)
  if (seen[key] === lastActiveAt) return
  const kept = Object.entries(seen)
    .filter(([entry]) => entry !== key)
    .sort((a, b) => b[1] - a[1])
    .slice(0, LIMIT - 1)
  seen = { ...Object.fromEntries(kept), [key]: lastActiveAt }
  try {
    localStorage.setItem(KEY, JSON.stringify(seen))
  } catch {
    /* The mark still holds for this session. */
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A stable predicate that changes whenever a failure is marked, for `buildInbox`. */
export function useFailureSeen() {
  const snapshot = useSyncExternalStore(subscribe, () => seen)
  return (chat: { computerId: string; taskId: string; lastActiveAt: number }) =>
    snapshot[keyOf(chat.computerId, chat.taskId)] === chat.lastActiveAt
}
