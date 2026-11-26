import type { AccountTrust } from '@ramu/shared/account'

/** Whether devices on this host's Ramu account connect, and how: the host's trust, or off when it is not listed. */
export type AccountAccess = 'off' | AccountTrust

/** The account choice as two switches, plus view-only access kept under Advanced. */
export interface AccountSwitches {
  connect: boolean
  ask: boolean
  viewOnly: boolean
}

export function accountSwitches(access: AccountAccess): AccountSwitches {
  return { connect: access !== 'off', ask: access === 'ask', viewOnly: access === 'viewer' }
}

/** Asking first wins over view-only, since the person picks the access when they allow each device. */
export function accountAccess({ connect, ask, viewOnly }: AccountSwitches): AccountAccess {
  if (!connect) return 'off'
  if (ask) return 'ask'
  return viewOnly ? 'viewer' : 'owner'
}
