import { useSyncExternalStore } from 'react'

/** The sidebar threads picked for a bulk action. Device-local and short-lived: it is never saved. */
let selected: ReadonlySet<string> = new Set()
let anchor: string | null = null
const listeners = new Set<() => void>()
const publish = (next: ReadonlySet<string>) => {
  selected = next
  for (const listener of listeners) listener()
}

export const threadSelection = {
  ids: (): ReadonlySet<string> => selected,
  has: (id: string) => selected.has(id),
  /** Adds or removes one thread, and makes it the start of the next shift-click range. */
  toggle(id: string) {
    const next = new Set(selected)
    if (next.delete(id)) anchor = next.size ? anchor : null
    else {
      next.add(id)
      anchor = id
    }
    publish(next)
  },
  /** Selects everything between the last toggled thread and this one, in the order the list shows them. */
  range(id: string, ordered: readonly string[]) {
    const from = anchor ? ordered.indexOf(anchor) : -1
    const to = ordered.indexOf(id)
    if (from < 0 || to < 0) return threadSelection.toggle(id)
    const [start, end] = from < to ? [from, to] : [to, from]
    publish(new Set([...selected, ...ordered.slice(start, end + 1)]))
  },
  set(ids: readonly string[]) {
    anchor = ids.at(-1) ?? null
    publish(new Set(ids))
  },
  clear() {
    anchor = null
    if (selected.size) publish(new Set())
  },
}

export function useThreadSelection(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    () => selected,
  )
}
