/**
 * Whether a helper gets its own copy of the checkout. It does when it would write at the same time as another writer
 * there: it runs in the background while the thread works on, or another writing helper is still running. A helper the
 * thread waits for alone shares the checkout, so its edits show in the thread's change review as they happen and it can
 * still be messaged. Read-only helpers and teammates (one writer at a time, always reachable) never need a copy.
 */
export function needsOwnCheckout(helper: {
  background: boolean
  readOnly: boolean
  teammate: boolean
  /** Writing helpers of the same thread that are still running. */
  otherWriters: number
}): boolean {
  if (helper.readOnly || helper.teammate) return false
  return helper.background || helper.otherWriters > 0
}
