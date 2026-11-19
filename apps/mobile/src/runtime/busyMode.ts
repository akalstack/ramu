/** What a message sent while the agent is working does by default on this phone. */
export type BusyMode = 'steer' | 'queue'

/** This phone's own choice, kept in device storage with the other phone-only drafts; never sent to a host. */
export const BUSY_MODE_DEVICE_KEY = 'pref-device:queueWhileBusy'
/** This phone's choice about the warning before changing model mid-conversation: 'on', 'off', or unset. */
export const MODEL_WARNING_DEVICE_KEY = 'pref-device:modelChangeWarning'

export type PreferenceSourceLabel = 'device' | 'mobile' | 'all' | 'default'

/** What each scope holds for one preference, already checked; absent means that scope has no value of its own. */
export interface LayeredValues<V> {
  device?: V
  mobile?: V
  all?: V
}

/** This phone's value first, then all your phones, then all devices (the computer's own setting), then `fallback`. */
export function resolveLayered<V>(held: LayeredValues<V>, fallback: V): { value: V; source: PreferenceSourceLabel } {
  if (held.device !== undefined) return { value: held.device, source: 'device' }
  if (held.mobile !== undefined) return { value: held.mobile, source: 'mobile' }
  if (held.all !== undefined) return { value: held.all, source: 'all' }
  return { value: fallback, source: 'default' }
}

export interface ResolvedBusyMode {
  mode: BusyMode
  /** Where the value comes from, so Settings can say so: this phone, all mobile devices, the computer, or the default. */
  source: PreferenceSourceLabel
}

/** A stored, shared or host value read as a busy mode; anything else reads as "not set". */
export const readBusyMode = (value: unknown): BusyMode | undefined =>
  value === 'steer' || value === 'queue' ? value : undefined

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
  const { value, source } = resolveLayered(
    { device: readBusyMode(deviceRaw), mobile: readBusyMode(mobileValue), all: readBusyMode(hostValue) },
    'steer' as BusyMode,
  )
  return { mode: value, source }
}

/** The warning choice as Settings shows it: this phone stores 'on'/'off', the shared layer and the computer a boolean. */
export type ModelWarning = 'on' | 'off'

export const readModelWarning = (value: unknown): ModelWarning | undefined =>
  value === 'on' || value === true ? 'on' : value === 'off' || value === false ? 'off' : undefined

/** Whether to warn: this phone's choice, then the shared mobile setting, then the computer's `warnModelChange`, then warn. */
export function resolveModelChangeWarning(
  deviceRaw: string | undefined,
  mobileValue: unknown,
  hostValue: unknown,
): { warn: boolean; source: PreferenceSourceLabel } {
  // Only this phone stores 'on'/'off'; the shared layer and the computer hold booleans, so a string there is unreadable.
  const { value, source } = resolveLayered(
    {
      device: typeof deviceRaw === 'string' ? readModelWarning(deviceRaw) : undefined,
      mobile: typeof mobileValue === 'boolean' ? readModelWarning(mobileValue) : undefined,
      all: typeof hostValue === 'boolean' ? readModelWarning(hostValue) : undefined,
    },
    'on' as ModelWarning,
  )
  return { warn: value === 'on', source }
}
