/** A tab in the integrated browser, as the workspace shows it. */
export interface BrowserTabInfo {
  id: string
  hostId: string
  threadId: string
  runId: string | null
  profileId: string
  url: string
  title: string
  faviconUrl?: string
  /** Who may drive the page now. The agent acts only after the person releases it. */
  controller: 'human' | 'agent' | 'none'
  generation: number
  /** Human input waits for an old agent action to settle after takeover. */
  inputReady: boolean
  paused: boolean
  /** The person handed this tab back while no agent run was active; the thread's next run takes it over. */
  released?: boolean
  crashed: boolean
}

/** Non-secret metadata only. Website data stays in the owning desktop's Chromium partition. */
export interface BrowserProfileInfo {
  id: string
  name: string
  builtin: boolean
  temporary: boolean
  createdAt: number | null
  importedAt?: number
}
export interface BrowserProfileCatalog {
  profiles: BrowserProfileInfo[]
  error?: string
}
export interface BrowserImportSource {
  id: string
  name: string
  installed: boolean
  supported: boolean
  reason?: string
}
