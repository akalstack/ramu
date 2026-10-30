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
  /** The page is laid out at the controlling phone's screen size; it returns to the default when control changes. */
  fitted?: boolean
  /** Page zoom when not 100%. */
  zoom?: number
  /** A forced light or dark appearance; absent follows the system. */
  colorScheme?: 'light' | 'dark'
  crashed: boolean
  /** Whether the device that asked is the one in control. Absent when the answer was not for a particular device. */
  controlledHere?: boolean
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

/** One browser profile on this computer that sessions could be copied from. Names only: no cookie or path is exposed. */
export interface BrowserImportProfile {
  id: string
  name: string
}
/** A website with sign-in cookies in a source profile. Counts only; values never leave the privileged process. */
export interface BrowserImportDomain {
  domain: string
  cookies: number
}
export interface BrowserImportSkip {
  reason: string
  count: number
}
/** What an import did. Counts and reasons only. */
export interface BrowserImportResult {
  imported: number
  skipped: BrowserImportSkip[]
  failed: number
}
/** A new profile holding imported sessions, hidden from agents until the person keeps it. */
export interface BrowserImportStaged {
  profileId: string
  name: string
  result: BrowserImportResult
}
