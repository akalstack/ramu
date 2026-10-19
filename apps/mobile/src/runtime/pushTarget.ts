// Where a tap on a push notification goes. No React Native in here, so it is unit tested.

export type PushRoute =
  | { kind: 'thread'; computerId: string; taskId: string }
  | { kind: 'schedules'; computerId: string }
  | { kind: 'recaps'; computerId: string }

/**
 * The screen a notification opens, from the data the host sent. A push about one thread carries its `taskId`; the two that
 * are not about a thread (a scheduled run that could not start, the daily recap) carry a `target` instead. Anything from a
 * host this phone is not paired with, or that is not understood, opens nothing.
 */
export function pushTarget(data: unknown, knownComputers: readonly string[]): PushRoute | null {
  if (!data || typeof data !== 'object') return null
  const { computerId, taskId, target } = data as Record<string, unknown>
  if (typeof computerId !== 'string' || !knownComputers.includes(computerId)) return null
  if (target === 'schedules') return { kind: 'schedules', computerId }
  if (target === 'recaps') return { kind: 'recaps', computerId }
  if (typeof taskId === 'string') return { kind: 'thread', computerId, taskId }
  return null
}
