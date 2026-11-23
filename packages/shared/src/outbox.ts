// Messages and new threads written on a device while their host is unreachable wait there, oldest first, and go out
// in order once it answers. The desktop and the phone keep their own outboxes but share this rule for what goes next.

interface Queued {
  /** Absent or `waiting` may be sent; anything else (being sent, failed, in doubt, held for review) may not. */
  state?: string
}

const sendable = (item: Queued) => item.state === undefined || item.state === 'waiting'

/**
 * The next entry of one group (a thread, a host) that may be sent. A group goes strictly in order: its first entry
 * that is not `done` goes next when it is waiting, and one in front that is being sent, failed or in doubt holds the
 * rest back so nothing overtakes it.
 */
export function nextToSend<T extends Queued>(
  items: readonly T[],
  inGroup: (item: T) => boolean,
  done: (item: T) => boolean = () => false,
): T | undefined {
  const first = items.find((item) => inGroup(item) && !done(item))
  return first && sendable(first) ? first : undefined
}

/** The oldest entry that may be sent across every group, each group held back as `nextToSend` holds it. */
export function nextToSendAcross<T extends Queued>(
  items: readonly T[],
  groupOf: (item: T) => string,
  done: (item: T) => boolean = () => false,
): T | undefined {
  const seen = new Set<string>()
  for (const item of items) {
    if (done(item)) continue
    const group = groupOf(item)
    if (seen.has(group)) continue
    seen.add(group)
    if (sendable(item)) return item
  }
  return undefined
}
