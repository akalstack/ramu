/** Builds are unsigned until an Apple Developer ID is available, so the app cannot install its own updates. Off: no background downloads and no auto-update setting; releases are installed manually from GitHub. */
export const APP_AUTO_UPDATE = false

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
}

/** What one host needs to be current: a newer Ramu release, and the provider CLIs that have newer versions. */
export interface HostUpdateSummary {
  currentVersion: string | null
  /** The newer release, when there is one. */
  nextVersion: string | null
  /** Providers with an update that can run there, in the order the host listed them. */
  providers: { provider: import('./types').AgentProvider; version: string | null; latest: string | null }[]
}

export function hostUpdateSummary(
  app: Pick<AppUpdateStatus, 'currentVersion' | 'release'> | null,
  providers: readonly Pick<
    import('./providers/providers').ProviderStatus,
    'provider' | 'version' | 'latestVersion' | 'updateAvailable' | 'updateCommand' | 'updating'
  >[],
): HostUpdateSummary {
  return {
    currentVersion: app?.currentVersion ?? null,
    nextVersion: app?.release?.version ?? null,
    providers: providers
      .filter((status) => status.updateAvailable && status.updateCommand && !status.updating)
      .map((status) => ({ provider: status.provider, version: status.version, latest: status.latestVersion })),
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
