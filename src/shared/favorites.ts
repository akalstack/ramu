/** Reorder the complete list even when search hides some favorites. */
export function moveFavorite(favorites: string[], key: string, target: string, after = false): string[] {
  if (key === target || !favorites.includes(key) || !favorites.includes(target)) return favorites
  const next = favorites.filter((favorite) => favorite !== key)
  next.splice(next.indexOf(target) + (after ? 1 : 0), 0, key)
  return next
}
