// The optional Ramu account, as hosts, phones and the service agree on it: where it is, its limits, and the shapes its
// API returns. An account is access only where the person at a host chose it: a listed host asks before pairing each
// device unless it was set to let the same account's devices connect, with the access chosen there.

export const ACCOUNT_URL = 'https://account.akalstack.com'

export const ACCOUNT_LIMITS = {
  /** Versions kept per backup slot. */
  versions: 30,
  /** The largest sealed backup accepted. */
  backupBytes: 256 * 1024,
  /** A slot takes at most one upload a minute. */
  uploadEveryMs: 60_000,
  /** How long a key request or relayed pairing request waits. */
  requestMs: 10 * 60_000,
  /** Pairing requests waiting per listed host, and how often one device may send one. */
  waitingPerHost: 5,
  requestEveryMs: 60_000,
  /** A listed host waits this long on each check for a request, so one arrives within a second or two. */
  hostWaitMs: 20_000,
  /** After a failed check, a listed host waits this long before the next. */
  hostRetryMs: 30_000,
} as const

/**
 * What a listed host does when a device signed in to the same account asks to pair: ask the person at the host, or
 * pair it straight away with view-only or full access. Chosen only at the host.
 */
export type AccountTrust = 'ask' | 'viewer' | 'owner'
export const ACCOUNT_TRUST: readonly AccountTrust[] = ['ask', 'viewer', 'owner']

/** The identity providers an account signs in with; a passkey is added to an account made with one of them. */
export type AccountProvider = 'github' | 'google'
export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = ['github', 'google']

export interface AccountUser {
  id: string
  name: string
  email: string
  image: string | null
}

export interface BackupSlotInfo {
  slot: string
  kind: 'host' | 'phone'
  /** The slot's name, sealed under the backup key, base64. */
  label: string
  versions: { id: string; size: number; createdAt: number }[]
}

/** A new device asking for the backup key, as a device that has it sees it. */
export interface KeyRequestInfo {
  id: string
  name: string
  commit: string
  requesterKey: string | null
  approverKey: string | null
  envelope: string | null
  createdAt: number
  expiresAt: number
}

export interface ListedHostInfo {
  id: string
  name: string
  hostKey: string
  lastSeen: number
  /** Whether a device on this account connects without the host asking, and with what access. */
  trust: AccountTrust
}

/** One pairing message a device relayed to a listed host, waiting for the host's answer. */
export interface RelayMessage {
  id: string
  path: string
  body: unknown
  /** The same for every message from one device, and nothing else about it. */
  from: string
  /** The account the asking device is signed in to, which the host checks is its own. */
  account: string
}

/** The sign-in a client shows: the code and the page where it is confirmed. */
export interface AccountSignIn {
  userCode: string
  verificationUri: string
  expiresAt: number
}

export interface AccountStatus {
  signedIn: boolean
  user: AccountUser | null
  /** The providers linked to the account, the one it was made with first. */
  providers: AccountProvider[]
  /** Settings backup to the Ramu account and to the person's own GitHub. */
  backup: {
    account: boolean
    github: boolean
    lastBackupAt: number | null
    error: string | null
    /** Whether this host holds the backup key. */
    hasKey: boolean
  }
  /** Whether this host is listed under Your hosts. */
  listed: boolean
  /** What this host does when a device on the same account asks to pair. */
  trust: AccountTrust
  /** A sign-in waiting for the person to confirm its code. */
  pendingSignIn: AccountSignIn | null
}

/** A backup another host or phone made, as Restore lists it. */
export interface RestoreChoice {
  source: 'account' | 'github'
  slot: string
  name: string
  kind: 'host' | 'phone'
  versions: { id: string; createdAt: number; size: number }[]
}
