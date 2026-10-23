/** What a message sent while the agent is working does by default on this phone. */
export type BusyMode = 'steer' | 'queue'

/** This phone's own choice, kept in device storage with the other phone-only drafts; never sent to a host. */
export const BUSY_MODE_DEVICE_KEY = 'pref-device:queueWhileBusy'
/** This phone's choice about the warning before changing model mid-conversation: 'on', 'off', or unset. */
export const MODEL_WARNING_DEVICE_KEY = 'pref-device:modelChangeWarning'

export type PreferenceSourceLabel = 'device' | 'mobile' | 'all' | 'default'

export interface ResolvedBusyMode {
  mode: BusyMode
  /** Where the value comes from, so Settings can say so: this phone, all mobile devices, the computer, or the default. */
  source: PreferenceSourceLabel
}

const valid = (value: unknown): value is BusyMode => value === 'steer' || value === 'queue'

/**
 * This phone's choice first, then the shared mobile setting on the computer, then the computer's "Messages while
 * working" setting, then Steer. An unreadable or unknown value is ignored rather than trusted; neither this phone nor
 * the shared layer changes the computer's own setting.
 */
export function resolveBusyMode(
  deviceRaw: string | undefined,
  mobileValue: unknown,
  hostValue: unknown,
): ResolvedBusyMode {
  if (valid(deviceRaw)) return { mode: deviceRaw, source: 'device' }
  if (valid(mobileValue)) return { mode: mobileValue, source: 'mobile' }
  if (valid(hostValue)) return { mode: hostValue, source: 'all' }
  return { mode: 'steer', source: 'default' }
}

export const otherBusyMode = (mode: BusyMode): BusyMode => (mode === 'steer' ? 'queue' : 'steer')

/** Whether to warn: this phone's choice, then the shared mobile setting, then the computer's `warnModelChange`, then warn. */
export function resolveModelChangeWarning(
  deviceRaw: string | undefined,
  mobileValue: unknown,
  hostValue: unknown,
): { warn: boolean; source: PreferenceSourceLabel } {
  if (deviceRaw === 'on' || deviceRaw === 'off') return { warn: deviceRaw === 'on', source: 'device' }
  if (typeof mobileValue === 'boolean') return { warn: mobileValue, source: 'mobile' }
  if (typeof hostValue === 'boolean') return { warn: hostValue, source: 'all' }
  return { warn: true, source: 'default' }
}
