import { useSyncExternalStore } from 'react'
import { nextCorner, type LiveSurface, type LiveViewPin } from '@ramu/shared/liveView'

// The phone's live view: pinned to one thread until closed. Kept for the session; it never opens by itself.
let pin: LiveViewPin | null = null
const listeners = new Set<() => void>()
const write = (next: LiveViewPin | null) => {
  pin = next
  for (const listener of listeners) listener()
}

export const floatLiveView = (hostId: string, taskId: string, pinned?: LiveSurface) =>
  write({ hostId, taskId, ...(pinned ? { pinned } : {}), corner: pin?.corner ?? 'bottom-right' })
export const closeLiveView = () => write(null)
export const setLiveCorner = (corner: LiveViewPin['corner']) => pin && write({ ...pin, corner })
export const moveLiveView = () => pin && write({ ...pin, corner: nextCorner(pin.corner) })
export const pinLiveSurface = (pinned: LiveSurface) => pin && write({ ...pin, pinned })

export const useLiveViewPin = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => pin,
  )
