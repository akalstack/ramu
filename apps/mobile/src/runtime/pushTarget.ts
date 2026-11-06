// Where a tap on a push notification goes. No React Native in here, so it is unit tested.

export type PushRoute =
  | { kind: 'thread'; computerId: string; taskId: string }
  | { kind: 'schedules'; computerId: string }
  | { kind: 'recaps'; computerId: string }
  | { kind: 'page'; computerId: string; pageId: string }

/**
 * The screen a notification opens, from the data the host sent. A push about one thread carries its `taskId`; the two that
 * are not about a thread (a scheduled run that could not start, the daily recap) carry a `target` instead. Anything from a
 * host this phone is not paired with, or that is not understood, opens nothing.
 */
export function pushTarget(data: unknown, knownComputers: readonly string[]): PushRoute | null {
  if (!data || typeof data !== 'object') return null
  const { computerId, taskId, target, pageId } = data as Record<string, unknown>
  if (typeof computerId !== 'string' || !knownComputers.includes(computerId)) return null
  if (target === 'schedules') return { kind: 'schedules', computerId }
  if (target === 'recaps') return { kind: 'recaps', computerId }
  if (target === 'page' && typeof pageId === 'string' && /^[\w-]{1,80}$/.test(pageId))
    return { kind: 'page', computerId, pageId }
  if (typeof taskId === 'string') return { kind: 'thread', computerId, taskId }
  return null
}

/**
 * Delivered pushes whose notice has since been read or cleared, on this phone or the desktop, so they can leave the
 * notification list. A push stands for the host notice `agent:<session>`; only a notice the host has listed before and
 * no longer does counts as read, so a push that arrives ahead of its notice is kept.
 */
export function readPushes(
  presented: readonly { id: string; data: unknown }[],
  listed: ReadonlyMap<string, ReadonlySet<string>>,
  current: Readonly<Record<string, readonly { id: string }[] | undefined>>,
): string[] {
  return presented
    .filter(({ data }) => {
      if (!data || typeof data !== 'object') return false
      const { computerId, sessionId } = data as Record<string, unknown>
      if (typeof computerId !== 'string' || typeof sessionId !== 'string') return false
      const notice = `agent:${sessionId}`
      const now = current[computerId]
      return !!now && !!listed.get(computerId)?.has(notice) && !now.some((entry) => entry.id === notice)
    })
    .map(({ id }) => id)
}
