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
