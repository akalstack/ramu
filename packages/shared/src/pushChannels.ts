import type { PushEvents } from './api'

/**
 * Push channels whose payload comes from one host's server (or from the main process about one host's connection).
 * Every event on these carries the host it belongs to, and a window that shows several hosts routes them by that host.
 */
export const HOST_PUSH_CHANNELS = [
  'agent:event',
  'agent:rewound',
  'term:data',
  'term:exit',
  'term:changed',
  'workspace:changed',
  'automation:changed',
  'fs:changed',
  'notices:changed',
  'aside:changed',
  'context:changed',
  'memory:changed',
  'summaries:changed',
  'rules:changed',
  'usage:changed',
  'settings:changed',
  'settings:models',
  'activity:changed',
  'providers:updates',
  'mcp:changed',
  'background:connection',
] as const satisfies readonly (keyof PushEvents)[]
export type HostPushChannel = (typeof HOST_PUSH_CHANNELS)[number]

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
  'computers:changed',
  'computers:navigate',
  'computers:activity',
  'device-state:changed',
] as const satisfies readonly (keyof PushEvents)[]

// Every channel is exactly one kind: adding a push event without classifying it fails to compile here.
type Classified = HostPushChannel | (typeof WINDOW_PUSH_CHANNELS)[number]
const everyChannelClassified: Exclude<keyof PushEvents, Classified> extends never ? true : never = true
void everyChannelClassified

const hostChannels = new Set<string>(HOST_PUSH_CHANNELS)
export const isHostPushChannel = (channel: string): channel is HostPushChannel => hostChannels.has(channel)
