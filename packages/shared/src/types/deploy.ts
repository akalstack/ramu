// What the Deploy sheet shows on both clients. Platforms are reached through plugins, so nothing here names one: the
// latest deploy is read from the checks the Git host lists on the default branch, and the live address is watched
// from the host.
import type { DeployTargetId } from '../stacks'
import type { ForgeCheck } from './forge'

/** The checks on one repository's newest default-branch commit, where a connected platform reports each deploy. */
export interface DeployChecks {
  repoId: string
  /** The repository's name in Ramu. */
  name: string
  branch: string
  commit: string
  checks: ForgeCheck[]
}

export interface DeployStatus {
  /** The platform the project's stack names, from `ramu.json`. */
  recommended: DeployTargetId | null
  /** Each repository of the project whose Git host Ramu reads checks from. */
  repositories: DeployChecks[]
}

/** How one uptime check of the live address came out. `unknown` means the host itself could not tell. */
export type UptimeResult = 'up' | 'down' | 'unknown'

/** Why a check got no usable answer, in words the clients translate. */
export type UptimeFailure = 'timeout' | 'unreachable' | 'redirects'

export interface UptimeCheck {
  at: number
  result: UptimeResult
  /** The HTTP status the address answered with, when it answered. */
  status: number | null
  /** How long the answer took, in milliseconds. */
  ms: number | null
  failure: UptimeFailure | null
}

/** The live address watch of a project, as the Deploy sheet shows it. */
export interface UptimeStatus {
  /** On unless the person turned it off; checks start once the project has a live address. */
  enabled: boolean
  /** The live address the person saved, or the lasting address of the app published from this computer. */
  address: string | null
  /** The address checked: the live address and the health path from `ramu.json`. */
  url: string | null
  last: UptimeCheck | null
  /** When the current run of failed checks began. */
  downSince: number | null
  /** The latest span the host was asleep or not running, reported as unknown rather than as downtime. */
  gap: { from: number; to: number } | null
  /** The open incident's thread, while the address is down. */
  incident: { taskId: string; openedAt: number } | null
}

/** How an app runs on this computer: in a Docker container, or as a program with the person's own permissions. */
export type LocalAppMode = 'container' | 'process'

/** An app published from this computer through a tunnel of its own (Deploy → Run on this computer). */
export interface LocalAppStatus {
  state: 'off' | 'building' | 'running' | 'failed'
  mode: LocalAppMode | null
  /** The lasting hostname the app runs at, when one is set; a quick tunnel's changing address otherwise. */
  lasting: string | null
  /** The app's own public address once its tunnel is up. */
  url: string | null
  error: string | null
  since: number | null
}
