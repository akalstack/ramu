import type { PushEvents } from './api'

/**
 * Push channels whose payload comes from one host's server (or from the main process about one host's connection).
 * Every event on these carries the host it belongs to, and a window that shows several hosts routes them by that host.
 */
export const HOST_PUSH_CHANNELS = [
  'hostBrowser:changed',
  'hostBrowser:present',
  'agent:event',
  'agent:rewound',
  'term:data',
  'term:exit',
  'term:behind',
  'term:changed',
  'workspace:changed',
  'automation:changed',
  'fs:changed',
  'notices:changed',
  'aside:changed',
  'context:changed',
  'memory:changed',
  'pages:changed',
  'summaries:changed',
  'rules:changed',
  'usage:changed',
  'models:news',
  'logins:changed',
  'settings:changed',
  'settings:models',
  'activity:changed',
  'providers:updates',
  'mcp:changed',
  'device:permissions',
  'pairing:requests',
  'permission:requests',
  'pairBack:invites',
  'background:connection',
] as const satisfies readonly (keyof PushEvents)[]
export type HostPushChannel = (typeof HOST_PUSH_CHANNELS)[number]

/**
 * The streaming kinds of a thread's transcript. A client asks for them only for the threads on screen; every other
 * thread arrives in brief (state, questions, queue, goal, settings), and what it missed is read when it is opened.
 */
export const STREAMING_KINDS: readonly string[] = ['text', 'thinking', 'tool-use', 'tool-result', 'turn-diff']

/**
 * Push channels about this window or this machine: visibility and checkpoints, menus, pairing links, app updates (one
 * per machine), notifications the main process raises for a window, the host list, and device-wide UI state.
 */
export const WINDOW_PUSH_CHANNELS = [
  'menu:action',
  'pair:link',
  'updates:changed',
  'notify:inapp',
  'notify:open',
  'browser:open-link',
  'browser:changed',
  'browser:present',
  'computers:changed',
  'computers:navigate',
  'computers:activity',
  'computers:pairCode',
  'device-state:changed',
  'live:closed',
  'live:open',
] as const satisfies readonly (keyof PushEvents)[]

// Every channel is exactly one kind: adding a push event without classifying it fails to compile here.
type Classified = HostPushChannel | (typeof WINDOW_PUSH_CHANNELS)[number]
const everyChannelClassified: Exclude<keyof PushEvents, Classified> extends never ? true : never = true
void everyChannelClassified

const hostChannels = new Set<string>(HOST_PUSH_CHANNELS)
export const isHostPushChannel = (channel: string): channel is HostPushChannel => hostChannels.has(channel)

/** One push event as a client receives it: the channel, and the payload that channel carries. */
export type PushMessage = { [K in keyof PushEvents]: { channel: K; payload: PushEvents[K] } }[keyof PushEvents]
/** The same as listener arguments; checking the channel narrows the payload. */
export type PushArgs = { [K in keyof PushEvents]: [channel: K, payload: PushEvents[K]] }[keyof PushEvents]

const ARRAY_PAYLOADS = new Set<string>([
  'activity:changed',
  'usage:changed',
  'notices:changed',
  'providers:updates',
  'models:news',
])

/** Fields a client reads straight away on the busiest channels, with their type. */
const REQUIRED: Partial<Record<keyof PushEvents, Record<string, 'string' | 'number' | 'boolean' | 'object'>>> = {
  'agent:event': { sessionId: 'string', event: 'object' },
  'agent:rewound': { sessionId: 'string', seq: 'number' },
  'context:changed': { sessionId: 'string', context: 'object' },
  'aside:changed': { sessionId: 'string', asideId: 'string' },
  'term:data': { id: 'string', data: 'string' },
  'term:exit': { id: 'string', code: 'number' },
  'term:behind': { id: 'string' },
  'term:changed': { taskId: 'string' },
  'pages:changed': { pageId: 'string' },
  'fs:changed': { cwd: 'string', path: 'string' },
  'notify:inapp': { sessionId: 'string', taskId: 'string', title: 'string', body: 'string' },
  'notify:open': { sessionId: 'string', taskId: 'string' },
  'background:connection': { connected: 'boolean' },
}

const allChannels = new Set<string>([...HOST_PUSH_CHANNELS, ...WINDOW_PUSH_CHANNELS])

/**
 * A push event from the wire, or null when its channel is unknown or its payload cannot be what that channel carries:
 * the outer shape (array or object) and, on the busiest channels, the fields clients read at once. A client drops a
 * null instead of acting on it, so a newer or misbehaving host cannot crash a listener.
 */
export function pushMessage(channel: unknown, payload: unknown): PushMessage | null {
  if (typeof channel !== 'string' || !allChannels.has(channel)) return null
  if (ARRAY_PAYLOADS.has(channel)) return Array.isArray(payload) ? ({ channel, payload } as PushMessage) : null
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const fields = REQUIRED[channel as keyof PushEvents]
  if (fields)
    for (const [key, type] of Object.entries(fields)) {
      const value = (payload as Record<string, unknown>)[key]
      if (type === 'object' ? !value || typeof value !== 'object' : typeof value !== type) return null
    }
  if (channel === 'agent:event' && typeof (payload as { event: { kind?: unknown } }).event.kind !== 'string')
    return null
  return { channel, payload } as PushMessage
}
