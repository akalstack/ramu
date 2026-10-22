import type { BrowserTabInfo } from '@ramu/shared/types/browser'

/**
 * What the phone can say about a tab's website identity. Profile names are administered on the owning host, so the phone
 * names the kind, and whether the sign-in is shared with other tabs of the same profile.
 */
export function profileLabel(profileId: string): string {
  if (profileId === 'temporary') return 'Temporary profile · not shared'
  if (profileId === 'default') return 'Default profile · shared with other tabs'
  return 'Named profile · shared with other tabs'
}

export type ControlState = 'offline' | 'backgrounded' | 'disconnected' | 'agent' | 'viewing' | 'yours' | 'settling'

/** One plain state for the controls, so they never imply control the phone does not hold. */
export function controlState(
  tab: Pick<BrowserTabInfo, 'controller' | 'paused' | 'generation'> & { inputReady?: boolean },
  context: { online: boolean; active: boolean; ownedGeneration: number | null },
): ControlState {
  if (!context.online) return 'offline'
  if (!context.active) return 'backgrounded'
  if (tab.paused) return 'disconnected'
  if (tab.controller === 'agent') return 'agent'
  if (tab.controller !== 'human' || tab.generation !== context.ownedGeneration) return 'viewing'
  return tab.inputReady ? 'yours' : 'settling'
}

export const CONTROL_TEXT: Record<ControlState, string> = {
  offline: 'Offline · showing the last frame',
  backgrounded: 'Paused while Ramu is in the background',
  disconnected: 'Control disconnected. Take control again to continue.',
  agent: 'The agent is in control',
  viewing: 'Viewing only',
  yours: 'You are in control',
  settling: 'Waiting for the agent’s last action to finish…',
}

/** Turns the host's refusal into the next step for the person. */
export function viewerMessage(error: string): string {
  if (/not granted|ask the owning host to grant/i.test(error))
    return 'This phone has not been allowed to view this thread’s browser. Ask the owner of that computer to allow it in Settings → Browser.'
  if (/pair this device/i.test(error)) return 'Pair this phone with the computer again to view its browser.'
  if (/wait before requesting/i.test(error)) return 'Refreshing…'
  if (/too large to stream/i.test(error))
    return 'This page is too large to show on the phone. Make the page smaller on the computer.'
  return error
}

/** Where a touch on the shown frame lands in the page, as fractions of the captured viewport. */
export function framePoint(x: number, y: number, width: number, aspect: number): { x: number; y: number } {
  const height = width / (aspect > 0 ? aspect : 4 / 3)
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  return { x: clamp(x / Math.max(1, width)), y: clamp(y / Math.max(1, height)) }
}

export type FrameGesture =
  | { kind: 'click'; x: number; y: number; button: 'left' | 'right'; clickCount: 1 | 2 }
  | { kind: 'scroll'; x: number; y: number }

/**
 * One finger on the frame: a short touch clicks (twice in a row double-clicks), a held touch right-clicks, and a drag
 * scrolls the page the way the finger moves. `pageWidth` is the captured viewport width, so a drag scrolls by what it
 * covers on screen.
 */
export function frameGesture(
  touch: { x: number; y: number; dx: number; dy: number; ms: number; afterTapMs: number | null },
  frame: { width: number; aspect: number; pageWidth: number },
): FrameGesture {
  if (Math.hypot(touch.dx, touch.dy) > 8) {
    const scale = frame.pageWidth > 0 ? frame.pageWidth / Math.max(1, frame.width) : 1
    const limit = (value: number) => Math.max(-2000, Math.min(2000, Math.round(value)))
    return { kind: 'scroll', x: limit(-touch.dx * scale), y: limit(-touch.dy * scale) }
  }
  const point = framePoint(touch.x, touch.y, frame.width, frame.aspect)
  if (touch.ms >= 500) return { kind: 'click', ...point, button: 'right', clickCount: 1 }
  return {
    kind: 'click',
    ...point,
    button: 'left',
    clickCount: touch.afterTapMs !== null && touch.afterTapMs < 350 ? 2 : 1,
  }
}
