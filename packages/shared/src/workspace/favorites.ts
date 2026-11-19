/** Reorder the complete list even when search hides some favorites. */
export function moveFavorite(favorites: string[], key: string, target: string, after = false): string[] {
  if (key === target || !favorites.includes(key) || !favorites.includes(target)) return favorites
  const next = favorites.filter((favorite) => favorite !== key)
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, key)
  return next
}

/**
 * Drops `key` where `target` sits in the list on screen, which may leave out favorites a tab or search hides: dragged
 * down it lands after the target, dragged up before it, and hidden favorites keep their places.
 */
export function dropFavorite(favorites: string[], shown: readonly string[], key: string, target: string): string[] {
  return moveFavorite(favorites, key, target, shown.indexOf(key) < shown.indexOf(target))
}
