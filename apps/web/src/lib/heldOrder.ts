import { useEffect, useState } from 'react'

/**
 * `items` in the order `held` asks for, and whether the hold is over: the saved order has caught up, or an item was
 * added or removed meanwhile, so the list never shows something that is gone.
 */
export function heldOrder<T extends { id: string }>(
  items: readonly T[],
  held: readonly string[] | null,
): { items: T[]; over: boolean } {
  if (!held) return { items: [...items], over: false }
  const byId = new Map(items.map((item) => [item.id, item]))
  if (held.length !== items.length || held.some((id) => !byId.has(id))) return { items: [...items], over: true }
  return { items: held.map((id) => byId.get(id)!), over: held.every((id, index) => id === items[index]!.id) }
}

/**
 * A list as it is drawn after its rows are dragged into a new order: the dropped order, until the saved order catches
 * up. The host saves a reorder and reports the list again a moment later; drawn from the saved list alone, the row went
 * back to where it came from and then jumped. `release` gives the saved order back when the save fails.
 */
export function useHeldOrder<T extends { id: string }>(
  items: readonly T[],
): { items: T[]; hold(ids: readonly string[]): void; release(): void } {
  const [held, setHeld] = useState<readonly string[] | null>(null)
  const shown = heldOrder(items, held)
  useEffect(() => {
    if (shown.over) setHeld(null)
  }, [shown.over])
  return { items: shown.items, hold: setHeld, release: () => setHeld(null) }
}
