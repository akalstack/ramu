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
