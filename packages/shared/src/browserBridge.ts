import type { BrowserTabInfo } from './types/browser'
export const MAX_BROWSER_UPLOAD_BYTES = 8 * 1024 * 1024
export const BROWSER_UPLOAD_CHUNK_BYTES = 64 * 1024
export interface BrowserDownloadInfo {
  id: string
  tabId: string
  name: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  received: number
  total: number
}
/** Private authenticated human input. Never exposed as an agent tool. Positions are normalized to the captured viewport. */
export type BrowserHumanInput =
  | { kind: 'click'; x: number; y: number; button: BrowserMouseButton; clickCount: 1 | 2 }
  | { kind: 'scroll'; x: number; y: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: string; modifiers?: BrowserInputModifier[] }

/** A named key, a single printable character, or F1–F12. */
export type BrowserKey = string
export type BrowserModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'
/** `Primary` is the shortcut key of the computer running the page: Command on macOS, Control elsewhere. */
export type BrowserInputModifier = BrowserModifier | 'Primary'
/** Keys a viewer may press as a person's input; a letter only as part of a shortcut, since text arrives as text. */
export const BROWSER_INPUT_KEY =
  /^(Enter|Escape|Tab|Arrow(Up|Down|Left|Right)|Backspace|Delete|Home|End|PageUp|PageDown|[a-z])$/
export type BrowserMouseButton = 'left' | 'right' | 'middle'
export type BrowserPageAction =
  | { kind: 'upload'; snapshot: number; ref: number; name: string; data: string }
  | { kind: 'click'; snapshot: number; ref: number; button?: BrowserMouseButton; clickCount?: 1 | 2 | 3 }
  | { kind: 'hover'; snapshot: number; ref: number }
  | { kind: 'drag'; snapshot: number; ref: number; toRef: number }
  | { kind: 'type'; snapshot: number; ref: number; text: string; submit: boolean }
  | { kind: 'select'; snapshot: number; ref: number; labels: string[] }
  | { kind: 'press'; snapshot: number; ref: number; key: BrowserKey; shift: boolean; modifiers?: BrowserModifier[] }
  | { kind: 'scroll'; snapshot: number; ref?: number; x: number; y: number }
export interface BrowserScreenshot {
  mimeType: 'image/jpeg'
  data: string
  width: number
  height: number
}
/** Latest compositor frame. Cursors belong to one tab; slow viewers skip superseded frames. */
export interface BrowserLiveFrame extends BrowserScreenshot {
  sequence: number
}
export interface BrowserDialog {
  id: string
  type: 'alert' | 'confirm' | 'prompt' | 'beforeunload'
  message: string
}
export interface BrowserDiagnostics {
  console: { level: string; message: string }[]
  network: { method: string; origin: string; status?: number; error?: string }[]
  truncated: boolean
}

/** A paired device's own view of a desktop browser tab, answered by the same runtime that serves the agent. */
/**
 * What the page's focused element accepts, so a phone can raise the matching keyboard. Kinds only; never the field's
 * value, name or contents.
 */
export interface BrowserFieldFocus {
  editable: boolean
  kind?: 'text' | 'password' | 'email' | 'number' | 'tel' | 'url' | 'search' | 'multiline'
}
/** Page zoom steps a viewer offers, as in a desktop browser. */
export const BROWSER_ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
/**
 * One display change the controlling person makes to a tab. Zoom and appearance stay with the tab; a hard reload and
 * clearing the cache happen once. Cookies and sign-ins are never cleared here.
 */
export interface BrowserTabAdjust {
  hardReload?: true
  zoom?: number
  colorScheme?: 'system' | 'light' | 'dark'
  clearCache?: true
}
export type BrowserViewerOperation =
  | { op: 'adjust'; tabId: string; change: BrowserTabAdjust }
  | { op: 'list' }
  | { op: 'focus'; tabId: string }
  | { op: 'dialog'; tabId: string }
  | { op: 'frame'; tabId: string }
  | { op: 'nextFrame'; tabId: string; after: number }
  | { op: 'read'; tabId: string }
  | { op: 'take'; tabId: string }
  | { op: 'release'; tabId: string; runId?: string }
  | { op: 'input'; tabId: string; generation: number; input: BrowserHumanInput }
  | { op: 'navigate'; tabId: string; url: string }
  | { op: 'history'; tabId: string; direction: 'back' | 'forward' | 'reload' }
  | { op: 'close'; tabId: string }
  | { op: 'open'; url: string; profileId?: string }
  | { op: 'answerDialog'; tabId: string; dialogId: string; accept: boolean; text?: string }
  | { op: 'disconnect' }

/** Private local-desktop broker messages. The execution server supplies thread/run identity. */
export type BrowserBridgeCommand =
  | { kind: 'viewer'; device: string; operation: BrowserViewerOperation }
  | { kind: 'download-prepare'; tabId: string }
  | { kind: 'downloads'; tabId: string }
  | { kind: 'download-read'; tabId: string; downloadId: string; offset: number }
  | { kind: 'download-cancel'; tabId: string; downloadId: string }
  | { kind: 'upload-begin'; tabId: string; name: string; size: number }
  | { kind: 'upload-chunk'; tabId: string; uploadId: string; offset: number; data: string }
  | { kind: 'upload-cancel'; tabId: string; uploadId: string }
  | { kind: 'upload'; tabId: string; uploadId: string; snapshot: number; ref: number }
  | { kind: 'list' }
  | { kind: 'profiles' }
  | { kind: 'open'; url: string; profileId?: string; presentation?: 'background' | 'foreground' }
  | { kind: 'present'; tabId: string }
  | { kind: 'snapshot'; tabId: string }
  | { kind: 'navigate'; tabId: string; url: string }
  | (Exclude<BrowserPageAction, { kind: 'upload' }> & { tabId: string })
  | { kind: 'screenshot'; tabId: string }
  | { kind: 'diagnostics'; tabId: string }
  | { kind: 'dialog'; tabId: string }
  | { kind: 'handle-dialog'; tabId: string; dialogId: string; accept: boolean; promptText?: string }
  | { kind: 'wait'; tabId: string; text?: string; urlIncludes?: string; timeoutMs: number }
  | { kind: 'back' | 'forward' | 'reload'; tabId: string }
  | { kind: 'close'; tabId: string }
  | { kind: 'end' }

export interface BrowserBridgeRequest {
  requestId: string
  clientId: string
  threadId: string
  runId: string
  expiresAt: number
  command: BrowserBridgeCommand
}

export interface BrowserPageSnapshot {
  url: string
  title: string
  text: string
  elements: {
    ref: number
    tag: string
    role: string
    name: string
    type?: string
    href?: string
    options?: { label: string; disabled: boolean }[]
  }[]
  truncated: boolean
  snapshot: number
  tab: BrowserTabInfo
}
