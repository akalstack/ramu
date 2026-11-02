import { useSyncExternalStore } from 'react'
import { nextCorner, type LiveSurface, type LiveViewPin } from '@ramu/shared/liveView'

const KEY = 'ramu.live-view'
const listeners = new Set<() => void>()
const read = (): LiveViewPin | null => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as LiveViewPin | null
  } catch {
    return null
  }
}
let pin = read()
const write = (next: LiveViewPin | null) => {
  pin = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    /* The view still works for this session. */
  }
  for (const listener of listeners) listener()
}

/** Float: the person asks for a live view of this thread. It stays pinned to the thread until closed. */
export const floatLiveView = (hostId: string, taskId: string, pinned?: LiveSurface) =>
  write({ hostId, taskId, ...(pinned ? { pinned } : {}), corner: pin?.corner ?? 'bottom-right' })
export const closeLiveView = () => write(null)
export const pinLiveSurface = (pinned: LiveSurface | undefined) => {
  if (!pin) return
  const { pinned: _old, ...rest } = pin
  write(pinned ? { ...rest, pinned } : rest)
}
export const moveLiveView = () => pin && write({ ...pin, corner: nextCorner(pin.corner) })

export const useLiveViewPin = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pin,
  )
