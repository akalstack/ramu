// A live view watches one thread's Browser or Computer from wherever the person puts it. It never opens by itself and adds no authority.

export type LiveSurface = { kind: 'computer' } | { kind: 'browser'; tabId: string; host: boolean }
/** Where the view sits: its share of the free space across and down, 0 to 1, so it keeps its place as the window resizes. */
export type LivePosition = { x: number; y: number }

export interface LiveViewPin {
  hostId: string
  taskId: string
  /** A surface the person chose; absent means follow what the agent used last. */
  pinned?: LiveSurface
  /** Absent until the person moves it: the bottom-right corner. */
  position?: LivePosition
  /** Shown in its own window above other apps instead of inside Ramu's window. */
  window?: boolean
  /** Hidden from screen sharing where the system supports it. */
  hideFromSharing?: boolean
}

/** The space the view may sit in: the window less a margin, and the title bar at the top. */
export type LiveBounds = { width: number; height: number; margin: number; top: number }
type Size = { width: number; height: number }

const span = (bounds: LiveBounds, size: Size) => ({
  x: Math.max(0, bounds.width - size.width - bounds.margin * 2),
  y: Math.max(0, bounds.height - size.height - bounds.top - bounds.margin),
})
const clamp = (value: number) => Math.min(1, Math.max(0, value))

/** Where the view is drawn, in pixels from the window's top-left, for a saved position (absent: bottom right). */
export function livePlacement(position: LivePosition | undefined, bounds: LiveBounds, size: Size) {
  const free = span(bounds, size)
  const { x, y } = position ?? { x: 1, y: 1 }
  return { left: bounds.margin + clamp(x) * free.x, top: bounds.top + clamp(y) * free.y }
}

/** The position to save for a view dropped at `left`/`top`, kept inside the window. */
export function livePosition(left: number, top: number, bounds: LiveBounds, size: Size): LivePosition {
  const free = span(bounds, size)
  return {
    x: free.x ? clamp((left - bounds.margin) / free.x) : 1,
    y: free.y ? clamp((top - bounds.top) / free.y) : 1,
  }
}

/** What the view shows: the pinned surface while it exists, else computer use while active, else the first tab. */
export function liveSurface(
  pin: Pick<LiveViewPin, 'pinned'>,
  available: { computer: boolean; tabs: { id: string; host: boolean }[] },
): LiveSurface | null {
  const pinned = pin.pinned
  if (pinned?.kind === 'computer' && available.computer) return pinned
  if (pinned?.kind === 'browser' && available.tabs.some((tab) => tab.id === pinned.tabId)) return pinned
  if (available.computer) return { kind: 'computer' }
  const tab = available.tabs[0]
  return tab ? { kind: 'browser', tabId: tab.id, host: tab.host } : null
}

/** The view's state line, in words, so a glance says whether the agent needs the person. */
export function liveState(status: string | undefined): 'needs-you' | 'working' | 'finished' | 'failed' | 'idle' {
  if (status === 'needs-input') return 'needs-you'
  if (status === 'running') return 'working'
  if (status === 'failed') return 'failed'
  if (status === 'ready-for-review') return 'finished'
  return 'idle'
}
