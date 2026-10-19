import type { BackgroundStatus } from '@ramu/shared/types'

/** Older hosts omit `access`, and the server enforces it either way; this only decides what to offer. */
export const isViewOnly = (status: Pick<BackgroundStatus, 'access'> | null | undefined): boolean =>
  status?.access === 'viewer'

export const VIEW_ONLY_NOTICE =
  'This device can view threads and answer requests, but not send messages. Ask the host owner to pair it with full access.'
