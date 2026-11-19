/** The first window's host, and the id every window uses until it learns otherwise. */
export const LOCAL_HOST = 'local'

/**
 * The host this window belongs to. The desktop shell names it on the preload command line, so it is known
 * synchronously, before `computers.list` answers. Query keys and storage keys depend on that: a host-less call must
 * resolve to the same key before and after the host list loads.
 */
export const ownHostId = (): string => globalThis.window?.ramu?.hostId || LOCAL_HOST
