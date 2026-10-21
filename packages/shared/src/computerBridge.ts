// Contract between the execution server and the computer runtime owner's native broker. The server owns policy,
// grants and leases; the broker owns OS capture/input. Coordinates are pixels in the most recent observation.

export const MAX_COMPUTER_TEXT = 2000
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
  capture(target: ComputerTarget): Promise<ComputerCapture>
  perform(target: ComputerTarget, action: ComputerAction): Promise<void>
  /** Release held keys and buttons after cancellation, an ownership change or connection loss. */
  releaseInput(target: ComputerTarget): void
  /** How often a watched target is worth capturing, in milliseconds. Cheap streaming backends return less than the default. */
  frameInterval?(target: ComputerTarget): number
  /** Prepares slow one-time setup (for example building a native helper) before the first capture needs it. */
  warm?(): void
}

/** What the execution host asks a runtime owner's broker to do. The owner runs it on its own backend. */
export type BrokerCommand =
  | { id: string; kind: 'capture'; target: ComputerTarget }
  | { id: string; kind: 'perform'; target: ComputerTarget; action: ComputerAction }
  | { id: string; kind: 'release'; target: ComputerTarget }
  | { id: string; kind: 'apps' }

export type BrokerOutcome = { ok: true; value?: unknown } | { ok: false; error: string }

/** A backend refused before doing anything (for example the screen is locked), so the action certainly did not run. */
export class ComputerNotRun extends Error {}
