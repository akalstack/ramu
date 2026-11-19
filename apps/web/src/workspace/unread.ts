// Unread marks for one host's chats. Pure, so each host's store keeps its own set and tests need no window.
import type { TaskStatus } from '@ramu/shared/types'
import type { HostStorage } from '../hostStorage'

const KEY = 'ramu.unread'
const FINISHED: TaskStatus[] = ['ready-for-review', 'needs-input', 'failed']

const same = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id))

export function loadUnread(storage: HostStorage): Set<string> {
  try {
    return new Set(JSON.parse(storage.getItem(KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

/** Saves `next` unless it equals `current`; returns whichever set should stay in state (the same object when unchanged). */
export function commitUnread(storage: HostStorage, current: Set<string>, next: Set<string>): Set<string> {
  if (same(current, next)) return current
  try {
    storage.setItem(KEY, JSON.stringify([...next]))
  } catch {
    /* Marks still work for this session. */
  }
  return next
}

/**
 * A chat that stops working while you look elsewhere is marked until you open it. `watching` must be false for every
 * chat of a host that is not on screen, or a hidden host would clear the mark of whatever chat it last had open.
 */
export function statusUnread(
  current: ReadonlySet<string>,
  tasks: readonly { id: string; status: TaskStatus }[],
  previous: Map<string, TaskStatus>,
  watching: (taskId: string) => boolean,
): Set<string> {
  const next = new Set(current)
  const ids = new Set(tasks.map((task) => task.id))
  for (const task of tasks) {
    const before = previous.get(task.id)
    const looking = watching(task.id)
    if (before === 'running' && FINISHED.includes(task.status) && !looking) next.add(task.id)
    if (looking) next.delete(task.id)
    previous.set(task.id, task.status)
  }
  for (const id of next) if (!ids.has(id)) next.delete(id)
  return next
}

/** The host's inbox decides too: a finished notice marks its chat, and a notice cleared elsewhere (the phone) unmarks it. */
export function inboxUnread(
  current: ReadonlySet<string>,
  done: ReadonlySet<string>,
  previous: ReadonlySet<string>,
): Set<string> {
  const next = new Set(current)
  for (const id of done) next.add(id)
  for (const id of previous) if (!done.has(id)) next.delete(id)
  return next
}
