import type { DeviceChange } from './types'

type Translate = (text: string, values: Record<string, string>) => string

/**
 * One change a paired device made to the host's devices, in a sentence for the person at the host ("Ahmad’s iPhone
 * removed MacBook Air"). Each app passes its own `t` so the sentence reads in the chosen language.
 */
export function deviceChangeText(change: DeviceChange, t: Translate): string {
  const by = change.by
  switch (change.action) {
    case 'removed':
      return change.deviceId === change.byId
        ? t('{0} removed itself', { 0: by })
        : t('{0} removed {1}', { 0: by, 1: change.device })
    case 'removedOthers':
      return change.count === 1
        ? t('{0} removed 1 other device', { 0: by })
        : t('{0} removed {1} other devices', { 0: by, 1: String(change.count) })
    case 'renamed':
      return t('{0} renamed {1} to {2}', { 0: by, 1: change.device, 2: change.name })
    case 'connected':
      return change.role === 'viewer'
        ? t('{0} connected a new device with view-only access: {1}', { 0: by, 1: change.device })
        : t('{0} connected a new device: {1}', { 0: by, 1: change.device })
    case 'declined':
      return t('{0} declined a pairing request from {1}', { 0: by, 1: change.device })
  }
}
