/** What a message sent while the agent is working does by default on this phone. */
export type BusyMode = 'steer' | 'queue'

/** This phone's own choice, kept in device storage with the other phone-only drafts; never sent to a host. */
export const BUSY_MODE_DEVICE_KEY = 'pref-device:queueWhileBusy'

export interface ResolvedBusyMode {
  mode: BusyMode
  /** Where the value comes from, so Settings can say so: this phone, the computer's own setting, or the built-in default. */
  source: 'device' | 'all' | 'default'
}

const valid = (value: unknown): value is BusyMode => value === 'steer' || value === 'queue'

/**
 * The phone's choice first, then the selected computer's "Messages while working" setting, then Steer. An unreadable
 * or unknown stored value is ignored rather than trusted; the computer's setting never changes because of this phone.
 */
export function resolveBusyMode(deviceRaw: string | undefined, hostValue: unknown): ResolvedBusyMode {
  if (valid(deviceRaw)) return { mode: deviceRaw, source: 'device' }
  if (valid(hostValue)) return { mode: hostValue, source: 'all' }
  return { mode: 'steer', source: 'default' }
}

export const otherBusyMode = (mode: BusyMode): BusyMode => (mode === 'steer' ? 'queue' : 'steer')

/** This phone's choice about the warning before changing model mid-conversation: 'on', 'off', or unset to follow the computer. */
export const MODEL_WARNING_DEVICE_KEY = 'pref-device:modelChangeWarning'

/** Whether to warn: this phone's choice, then the computer's `warnModelChange` setting, then warn. */
export function resolveModelChangeWarning(
  deviceRaw: string | undefined,
  hostValue: unknown,
): { warn: boolean; source: 'device' | 'all' | 'default' } {
  if (deviceRaw === 'on' || deviceRaw === 'off') return { warn: deviceRaw === 'on', source: 'device' }
  if (typeof hostValue === 'boolean') return { warn: hostValue, source: 'all' }
  return { warn: true, source: 'default' }
}
