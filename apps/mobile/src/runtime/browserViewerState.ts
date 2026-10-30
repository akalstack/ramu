import { BROWSER_ZOOM_LEVELS } from '@ramu/shared/browserBridge'
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
  settling: 'Waiting for the current browser action to finish',
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
    return frameScroll(touch.dx, touch.dy, frame)
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

/** A drag sends each new displacement while the finger moves, rather than waiting for release. */
export function frameScroll(
  dx: number,
  dy: number,
  frame: { width: number; pageWidth: number },
): Extract<FrameGesture, { kind: 'scroll' }> {
  const scale = frame.pageWidth > 0 ? frame.pageWidth / Math.max(1, frame.width) : 1
  const limit = (value: number) => Math.max(-2000, Math.min(2000, Math.round(value)))
  return { kind: 'scroll', x: limit(-dx * scale), y: limit(-dy * scale) }
}

/**
 * What the header shows for a tab: its title, else its host, else the plain address. Only the fixed fallbacks pass
 * through `translate`; a website's own title is never treated as app copy.
 */
export function tabTitle(
  tab: Pick<BrowserTabInfo, 'title' | 'url'> | undefined,
  translate: (text: string) => string = (text) => text,
): string {
  if (!tab) return translate('Browser')
  if (tab.title?.trim()) return tab.title.trim()
  try {
    return new URL(tab.url).host || tab.url || translate('New tab')
  } catch {
    return tab.url || translate('New tab')
  }
}

/** The strip's single action for each control state, so the person always sees the next step. */
export function controlAction(state: ControlState): 'take' | 'release' | null {
  if (state === 'yours' || state === 'settling') return 'release'
  if (state === 'offline' || state === 'backgrounded') return null
  return 'take'
}

export type BrowserMenuKey =
  | 'paste'
  | 'hardReload'
  | 'display'
  | 'newTab'
  | 'searchEngine'
  | 'openOnPhone'
  | 'readText'
  | 'upload'
  | 'downloads'
  | 'closeTab'

/**
 * Overflow actions offered for the current tab. Only working actions appear: file transfers need the host-managed
 * browser, pasting, reloading, display changes or uploading need the phone to hold control, and opening on the phone
 * needs a web page the phone can address.
 */
export function browserMenu(context: {
  hasTab: boolean
  own: boolean
  hostManaged: boolean
  fileInput: boolean
  phonePage: boolean
}): BrowserMenuKey[] {
  const keys: BrowserMenuKey[] = []
  if (context.own) keys.push('paste', 'hardReload', 'display')
  keys.push('newTab', 'searchEngine')
  if (!context.hasTab) return keys
  if (context.phonePage) keys.push('openOnPhone')
  keys.push('readText')
  if (context.hostManaged && context.own && context.fileInput) keys.push('upload')
  if (context.hostManaged) keys.push('downloads')
  keys.push('closeTab')
  return keys
}

/**
 * The layout size to ask the host for: the visible page area in points. Small height jitter never refits; the phone
 * keyboard opening or closing does, so the page shrinks above the keyboard as a phone browser's does.
 */
export function fitSize(
  area: { width: number; height: number },
  previous: { width: number; height: number } | null,
): { width: number; height: number } | null {
  const width = Math.round(Math.min(1920, area.width))
  const height = Math.round(Math.min(1920, area.height))
  // A small phone with its keyboard up leaves about 200 points of page; still refit for it.
  if (width < 240 || height < 160) return null
  if (previous && Math.abs(previous.width - width) < 8 && Math.abs(previous.height - height) < 40) return null
  return { width, height }
}

/** The tab to preview over the chat: the newest one that appeared since the last read. Tabs already open never pop up. */
export function revealedTab(previous: ReadonlySet<string> | null, tabs: readonly Pick<BrowserTabInfo, 'id'>[]) {
  if (!previous) return null
  return tabs.findLast((tab) => !previous.has(tab.id))?.id ?? null
}

/** The next page zoom step up or down, as a desktop browser's zoom buttons move; an odd value snaps onto the ladder. */
export function zoomStep(current: number, direction: 1 | -1): number {
  const levels: readonly number[] = BROWSER_ZOOM_LEVELS
  if (direction > 0) return levels.find((level) => level > current + 0.001) ?? levels.at(-1)!
  return [...levels].reverse().find((level) => level < current - 0.001) ?? levels[0]!
}
