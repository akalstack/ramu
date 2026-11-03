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
