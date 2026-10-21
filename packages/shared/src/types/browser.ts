/** A tab in the integrated browser, as the workspace shows it. */
export interface BrowserTabInfo {
  id: string
  hostId: string
  threadId: string
  runId: string | null
  profileId: string
  url: string
  title: string
  /** Who may drive the page now. The agent acts only after the person releases it. */
  controller: 'human' | 'agent' | 'none'
  generation: number
  /** Human input waits for an old agent action to settle after takeover. */
  inputReady: boolean
  paused: boolean
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
