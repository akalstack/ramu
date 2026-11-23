/** A layout size in CSS pixels; `mobile` lays the page out as a phone browser would, honouring its viewport meta tag. */
export interface BrowserViewport {
  width: number
  height: number
  mobile: boolean
}
/** Common sizes an agent checks a layout at, so it needs no device dimensions of its own. */
export const BROWSER_VIEWPORT_PRESETS = {
  phone: { width: 390, height: 844, mobile: true },
  'phone-landscape': { width: 844, height: 390, mobile: true },
  tablet: { width: 820, height: 1180, mobile: true },
  laptop: { width: 1280, height: 800, mobile: false },
  desktop: { width: 1920, height: 1080, mobile: false },
} as const satisfies Record<string, BrowserViewport>

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
  /** The size the agent laid the page out at, to check a phone or tablet layout. Ends when a person takes control. */
  viewport?: BrowserViewport
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
/**
 * The operating system refused Ramu access to a browser's data (on macOS, until Ramu has Full Disk Access). Reported as
 * this exact message, so the import can offer the setting instead of saying no profiles exist.
 */
export const BROWSER_DATA_BLOCKED =
  "This computer blocked Ramu from reading the browser's data. Allow Ramu in Full Disk Access, then check again."

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
