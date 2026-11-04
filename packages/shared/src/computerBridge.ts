import type { BrowserFieldFocus } from './browserBridge'
// Contract between the execution server and the computer runtime owner's native broker. The server owns policy,
// grants and leases; the broker owns OS capture/input. Coordinates are pixels in the most recent observation.

export const MAX_COMPUTER_TEXT = 2000
/** The most accessibility-tree text one observation carries to the agent. */
export const MAX_COMPUTER_TREE_TEXT = 12_000
/** A frame older than this while subscribed is shown as stale and no longer accepts remote input. */
export const COMPUTER_FRAME_STALE_MS = 5000

export type ComputerTargetKind = 'app' | 'display'
export interface ComputerTarget {
  id: string
  kind: ComputerTargetKind
  name: string
}

/** What the person granted for exactly one runtime/target/session. Observation and input are separate. */
export interface ComputerGrant {
  target: ComputerTarget
  observe: boolean
  input: boolean
}

export type ComputerButton = 'left' | 'right' | 'middle'
export type ComputerModifier = 'Alt' | 'Control' | 'Meta' | 'Shift'
export type ComputerAction =
  | { kind: 'click'; x: number; y: number; button?: ComputerButton; clickCount?: 1 | 2 | 3 }
  | { kind: 'type'; text: string }
  | { kind: 'key'; key: string; modifiers?: ComputerModifier[] }
  | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { kind: 'drag'; fromX: number; fromY: number; toX: number; toY: number }

export interface ComputerCapture {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  /** Base64 image data. Never stored in transcript events. */
  data: string
  width: number
  height: number
  scale: number
  /** The app's accessibility tree as text, when the backend has one. For an agent only; viewers never receive it. */
  text?: string
}

export interface ComputerFrameMeta {
  targetId: string
  sequence: number
  capturedAt: number
  width: number
  height: number
  scale: number
  generation: number
}

export type ComputerRuntimeStatus =
  | { available: true; computer: { id: string; name: string } }
  | {
      available: false
      reason: 'not-installed' | 'permission-denied' | 'locked' | 'offline' | 'headless' | 'unsupported'
      detail?: string
    }

/** The native side. The server never imports a platform runtime directly; a fake implements this in tests. */
export interface ComputerBackend {
  status(): ComputerRuntimeStatus
  /**
   * `forViewer`: the picture is for a person watching, so a backend may leave out what only an agent reads (an app's
   * full accessibility tree) to send it sooner.
   */
  capture(target: ComputerTarget, options?: { forViewer?: boolean }): Promise<ComputerCapture>
  /** Resolves with the target as it looks after the action when the backend got that picture along with it. */
  perform(target: ComputerTarget, action: ComputerAction): Promise<ComputerCapture | void>
  /** Release held keys and buttons after cancellation, an ownership change or connection loss. */
  releaseInput(target: ComputerTarget): void
  /**
   * Whether the person is using this computer's real mouse or keyboard right now, ignoring input Ramu injected. A
   * backend without it cannot pause the agent by itself, so the person has to take control explicitly.
   */
  localInputActive?(target: ComputerTarget): Promise<boolean>
  /** The kind of text field focused on the computer, so a phone raises its keyboard after a tap; never the value. */
  focusedField?(target: ComputerTarget): Promise<BrowserFieldFocus>
  /** How often a watched target is worth capturing, in milliseconds. Cheap streaming backends return less than the default. */
  frameInterval?(target: ComputerTarget): number
  /** Prepares slow one-time setup (for example building a native helper) before the first capture needs it. */
  warm?(): void
}

/** A backend refused before doing anything (for example the screen is locked), so the action certainly did not run. */
export class ComputerNotRun extends Error {}
