/**
 * The host's queue order after moving one queued message up or down past its visible neighbour. The phone lists queued
 * messages without the steers, so the move swaps the two in the full order and leaves everything else in place.
 */
export function moveQueued(
  order: readonly string[],
  shown: readonly string[],
  id: string,
  delta: -1 | 1,
): string[] | null {
  const at = shown.indexOf(id)
  const neighbour = shown[at + delta]
  if (at < 0 || neighbour === undefined) return null
  const next = [...order]
  const from = next.indexOf(id)
  const to = next.indexOf(neighbour)
  if (from < 0 || to < 0) return null
  next[from] = neighbour
  next[to] = id
  return next
}
