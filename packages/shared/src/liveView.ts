// A live view watches one thread's Browser or Computer from a corner. It never opens by itself and adds no authority.

export type LiveSurface = { kind: 'computer' } | { kind: 'browser'; tabId: string; host: boolean }
export type LiveCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

export interface LiveViewPin {
  hostId: string
  taskId: string
  /** A surface the person chose; absent means follow what the agent used last. */
  pinned?: LiveSurface
  corner: LiveCorner
}

export const LIVE_CORNERS: LiveCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right']

/** The next corner clockwise, for a keyboard or a tap that moves the view out of the way. */
export const nextCorner = (corner: LiveCorner): LiveCorner =>
  LIVE_CORNERS[(LIVE_CORNERS.indexOf(corner) + 1) % LIVE_CORNERS.length]!

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
