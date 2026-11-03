import { HOST_PUSH_CHANNELS, STREAMING_KINDS } from '@ramu/shared/pushChannels'

/**
 * Channels the phone takes from a host only while a screen needs them, because they are frequent (file changes, terminal
 * output, a turn's context size) and only one screen reads each. Everything else the phone uses is always subscribed.
 */
export const ON_DEMAND_CHANNELS: readonly string[] = [
  'fs:changed',
  'aside:changed',
  'context:changed',
  'term:data',
  'term:behind',
]
/** Channels no phone screen reads: a host that streams them wastes the link. */
const UNUSED_CHANNELS: readonly string[] = [
  'memory:changed',
  'mcp:changed',
  'providers:updates',
  // The phone's own connection state, never sent by a host.
  'background:connection',
]
export const BASE_CHANNELS: string[] = HOST_PUSH_CHANNELS.filter(
  (channel) => !ON_DEMAND_CHANNELS.includes(channel) && !UNUSED_CHANNELS.includes(channel),
)

/** A screen's need for some on-demand channels, optionally only for the resources (threads, terminals) it shows. */
export interface Interest {
  channels: readonly string[]
  keys?: Record<string, readonly string[]>
}

/** What the phone asks a host to send: the base channels plus whatever the screens now open have asked for. */
export function hostSubscription(interests: Iterable<Interest>): {
  channels: string[]
  keys?: Record<string, string[]>
  skip?: Record<string, string[]>
} {
  const channels = new Set(BASE_CHANNELS)
  // A channel one screen wants in full is delivered in full; otherwise only the union of the ids asked for.
  const keys = new Map<string, Set<string> | null>()
  for (const interest of interests)
    for (const channel of interest.channels) {
      channels.add(channel)
      const ids = interest.keys?.[channel]
      if (!ids) keys.set(channel, null)
      else if (keys.get(channel) !== null) keys.set(channel, new Set([...(keys.get(channel) ?? []), ...ids]))
    }
  const narrowed = Object.fromEntries([...keys].filter(([, ids]) => ids).map(([channel, ids]) => [channel, [...ids!]]))
  // Threads are followed in brief unless a screen wants every thread's transcript in full.
  const brief = keys.get('agent:event') !== null
  return {
    channels: [...channels],
    ...(Object.keys(narrowed).length ? { keys: narrowed } : {}),
    ...(brief ? { skip: { 'agent:event': [...STREAMING_KINDS] } } : {}),
  }
}
