import type { BrowserTabInfo } from './types/browser'

export type BrowserKey =
  | 'Enter'
  | 'Escape'
  | 'Tab'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'Backspace'
  | 'Delete'
  | 'Space'
  | 'Home'
  | 'End'
  | 'PageUp'
  | 'PageDown'
export type BrowserPageAction =
  | { kind: 'click'; snapshot: number; ref: number }
  | { kind: 'type'; snapshot: number; ref: number; text: string; submit: boolean }
  | { kind: 'select'; snapshot: number; ref: number; labels: string[] }
  | { kind: 'press'; snapshot: number; ref: number; key: BrowserKey; shift: boolean }
  | { kind: 'scroll'; snapshot: number; ref?: number; x: number; y: number }
export interface BrowserScreenshot {
  mimeType: 'image/jpeg'
  data: string
  width: number
  height: number
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

/** Private local-desktop broker messages. The execution server supplies thread/run identity. */
export type BrowserBridgeCommand =
  | { kind: 'list' }
  | { kind: 'profiles' }
  | { kind: 'open'; url: string; profileId?: string }
  | { kind: 'snapshot'; tabId: string }
  | { kind: 'navigate'; tabId: string; url: string }
  | (BrowserPageAction & { tabId: string })
  | { kind: 'screenshot'; tabId: string }
  | { kind: 'diagnostics'; tabId: string }
  | { kind: 'dialog'; tabId: string }
  | { kind: 'handle-dialog'; tabId: string; dialogId: string; accept: boolean; promptText?: string }
  | { kind: 'wait'; tabId: string; text: string; timeoutMs: number }
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
