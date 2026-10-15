import type { LibrarySummaryItem } from '@ramu/shared/types'

type Focus = Pick<LibrarySummaryItem, 'kind' | 'id' | 'title'>
let pending: Focus | null = null

/** Opens Settings → Memory & skills on one item. Settings may still be mounting, so the request waits to be taken. */
export function focusLibraryItem(item: Focus): void {
  pending = item
  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'memory' } }))
  window.dispatchEvent(new Event('ramu:library-focus'))
}
/** The waiting request for this kind of item, if any. Taking it clears it. */
export function takeLibraryFocus(kind: Focus['kind']): Focus | null {
  if (pending?.kind !== kind) return null
  const taken = pending
  pending = null
  return taken
}
