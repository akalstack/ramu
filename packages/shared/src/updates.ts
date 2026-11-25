import { newerVersion } from './version'

/** Off: no background downloads and no auto-update setting; releases are installed manually from GitHub. */
export const APP_AUTO_UPDATE = true

export interface AppRelease {
  version: string
  notesUrl: string
  publishedAt: string
  assetUrl: string
  assetName: string
  size: number
  checksumsUrl: string
}
export interface AppUpdateStatus {
  currentVersion: string
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error'
  release: AppRelease | null
  checkedAt: string | null
  error: string | null
  downloadedBytes: number
  nativeReady?: boolean
  supported?: boolean
  /** A newer release still inside its waiting period; offered once it has waited, or now when the person chooses. */
  waiting?: { version: string; notesUrl: string; settlesAt: string } | null
}

/** What a desktop app tells the service on its host: the version installed there, and whether it installs updates itself. */
export interface InstalledApp {
  version: string
  canInstall: boolean
}

/** A downloaded update this app can install by itself, without the person downloading an installer. */
export const installsUnattended = (status: AppUpdateStatus): boolean =>
  APP_AUTO_UPDATE && status.phase === 'ready' && !!status.nativeReady && status.supported !== false

/** What one host needs to be current: a newer Ramu release, and the provider CLIs that have newer versions. */
export interface HostUpdateSummary {
  currentVersion: string | null
  /** The newer release, when there is one. */
  nextVersion: string | null
  /** Providers with an update that can run there, in the order the host listed them. */
  providers: { provider: import('./types').AgentProvider; version: string | null; latest: string | null }[]
  /** Releases still inside their waiting period, with when they will be offered; each can be installed now. */
  waiting: WaitingUpdate[]
}

/** A release out less than a day: Ramu itself, or a provider CLI, and when it will be offered. */
export interface WaitingUpdate {
  provider: import('./types').AgentProvider | 'ramu'
  version: string
  until: string | null
}

export function hostUpdateSummary(
  app: Pick<AppUpdateStatus, 'currentVersion' | 'release' | 'waiting'> | null,
  providers: readonly Pick<
    import('./providers/providers').ProviderStatus,
    | 'provider'
    | 'version'
    | 'latestVersion'
    | 'updateAvailable'
    | 'updateCommand'
    | 'updating'
    | 'waitingVersion'
    | 'waitingUntil'
  >[],
): HostUpdateSummary {
  return {
    currentVersion: app?.currentVersion ?? null,
    nextVersion: app?.release?.version ?? null,
    providers: providers
      .filter((status) => status.updateAvailable && status.updateCommand && !status.updating)
      .map((status) => ({ provider: status.provider, version: status.version, latest: status.latestVersion })),
    waiting: [
      ...(app?.waiting
        ? [{ provider: 'ramu' as const, version: app.waiting.version, until: app.waiting.settlesAt }]
        : []),
      ...providers
        .filter((status) => status.waitingVersion && status.updateCommand && !status.updating)
        .map((status) => ({
          provider: status.provider,
          version: status.waitingVersion!,
          until: status.waitingUntil ?? null,
        })),
    ],
  }
}

/** Whether a host has anything to update. */
export const hostNeedsUpdate = (summary: HostUpdateSummary) => !!summary.nextVersion || summary.providers.length > 0

/** One provider CLI with a newer version on one host, as the update notice offers it. */
export interface PendingProviderUpdate {
  host: string
  provider: import('./types').AgentProvider
  binary: string
  version: string | null
  latest: string
}

/** Identifies one offered version on one host, so dismissing it hides that version only until a newer one comes. */
export const providerUpdateKey = (update: Pick<PendingProviderUpdate, 'host' | 'provider' | 'binary' | 'latest'>) =>
  `${update.host}:${update.provider}:${update.binary}:${update.latest}`

/**
 * Every provider update the hosts report that can run now: not already updating, with a version to go to and a command
 * to get there, and not dismissed. Hosts keep the order given, and each host's providers keep the host's order.
 */
export function pendingProviderUpdates(
  byHost: ReadonlyArray<
    readonly [
      string,
      readonly Pick<
        import('./providers/providers').ProviderStatus,
        'provider' | 'binary' | 'version' | 'latestVersion' | 'updateAvailable' | 'updateCommand' | 'updating'
      >[],
    ]
  >,
  dismissed: ReadonlySet<string>,
): PendingProviderUpdate[] {
  return byHost.flatMap(([host, statuses]) =>
    statuses.flatMap((status) => {
      if (!status.updateAvailable || !status.updateCommand || status.updating || !status.latestVersion) return []
      const update = {
        host,
        provider: status.provider,
        binary: status.binary,
        version: status.version,
        latest: status.latestVersion,
      }
      return dismissed.has(providerUpdateKey(update)) ? [] : [update]
    }),
  )
}

/**
 * How long a new release waits before Ramu offers it. A compromised release is usually found and pulled within hours,
 * so waiting a day keeps most of them off every host; the person can still install one now.
 */
export const UPDATE_WAIT_MS = 24 * 60 * 60_000

/** When each version of one tool was first seen as its newest release, as ISO times. */
export type SeenVersions = Readonly<Record<string, string>>

/**
 * Notes `latest` the first time it is seen. A version newer than `latest` that was seen before has been pulled (the
 * source went back to an older release), so it is forgotten and never offered.
 */
export function recordSeen(seen: SeenVersions, latest: string, now = Date.now()): SeenVersions {
  const kept = Object.fromEntries(Object.entries(seen).filter(([version]) => !newerVersion(version, latest)))
  return latest in kept ? kept : { ...kept, [latest]: new Date(now).toISOString() }
}

/** When a version seen at `firstSeen` has waited long enough to be offered. */
export const settlesAt = (firstSeen: string, waitMs = UPDATE_WAIT_MS) =>
  new Date(Date.parse(firstSeen) + waitMs).toISOString()

/**
 * The newest release that may be offered now. Without waiting it is `latest`. With waiting it is the newest version
 * seen at least `waitMs` ago; a tool that can only update to its newest release (`pins` false) is offered nothing until
 * `latest` itself has waited, since its updater would install whatever is newest at that moment.
 */
export function offeredVersion(
  seen: SeenVersions,
  latest: string,
  options: { wait: boolean; pins: boolean; now?: number; waitMs?: number },
): string | null {
  if (!options.wait) return latest
  const now = options.now ?? Date.now()
  const waitMs = options.waitMs ?? UPDATE_WAIT_MS
  const settled = (version: string) => !!seen[version] && Date.parse(seen[version]!) + waitMs <= now
  if (!options.pins) return settled(latest) ? latest : null
  return (
    Object.keys(seen)
      .filter((version) => settled(version) && !newerVersion(version, latest))
      .sort((a, b) => (newerVersion(a, b) ? -1 : newerVersion(b, a) ? 1 : 0))[0] ?? null
  )
}

/** Whole hours until a waiting release is offered, never under one, for "offered in 5h". */
export const hoursUntil = (until: string, now = Date.now()) =>
  Math.max(1, Math.ceil((Date.parse(until) - now) / 3_600_000))

/** A service started before an app update runs the same code (matching build) but still reports the version it started under. */
export const serviceReportsOlderVersion = (
  service: { version?: string; bundledVersion?: string; updateAvailable?: boolean } | null,
) =>
  !!service &&
  !service.updateAvailable &&
  !!service.version &&
  !!service.bundledVersion &&
  service.version !== service.bundledVersion
