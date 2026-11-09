// The optional Ramu account, as hosts, phones and the service agree on it: where it is, its limits, and the shapes its
// API returns. An account is never access: it carries sealed backups and pairing requests, and a host still approves
// every device itself.

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
  /** How often a listed host checks for requests while it runs. */
  hostPollMs: 30_000,
} as const

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
}

/** One pairing message a device relayed to a listed host, waiting for the host's answer. */
export interface RelayMessage {
  id: string
  path: string
  body: unknown
  /** The same for every message from one device, and nothing else about it. */
  from: string
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
