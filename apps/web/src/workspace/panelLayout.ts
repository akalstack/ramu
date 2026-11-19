import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { DEFAULT_SIDEBAR_WIDTH, SIDEBAR_WIDTH_RANGE } from '@ramu/shared/types'
import { useDefaultLayout, useGroupRef, type Layout, type LayoutStorage } from 'react-resizable-panels'
import { ownHostId } from '../hosts'
import { deviceStorage, type DeviceStorage } from '../deviceStorage'
import { clearOwnHostLayout, hostStorageFor } from '../hostStorage'

/**
 * Panel layouts are remembered per group and per set of visible panels (chat + editor,
 * chat + editor + terminal, ...), as proportions. Coming back to a combination restores
 * exactly what the user last left it at instead of recomputing from fixed pixel widths.
 */
const PREFIX = 'ramu.layout.'
/** Device-wide, like the sidebar width: the group layouts here (Source Control's panes) look the same in every host's window. */
const storage: LayoutStorage = {
  getItem: (key) => deviceStorage.getItem(PREFIX + key),
  setItem: (key, value) => deviceStorage.setItem(PREFIX + key, value),
}
/** The shell's sidebar width, shared by every host's window. `preferences.sidebarWidth` is only its starting value. */
export const SIDEBAR_WIDTH_KEY = 'ramu.sidebar-width'

/** Parses a stored sidebar width; anything outside the allowed range counts as unset. */
export function parseSidebarWidth(raw: string | null): number | null {
  const value = raw === null ? NaN : Number(raw)
  return Number.isInteger(value) && value >= SIDEBAR_WIDTH_RANGE[0] && value <= SIDEBAR_WIDTH_RANGE[1] ? value : null
}

/**
 * The shared sidebar width, live across windows. Until a width has been stored the host's saved preference applies,
 * and is then stored once so every host's window starts from the same value.
 */
export function useSidebarWidth(preferred: number): [number, (width: number) => void] {
  const raw = useSyncExternalStore(
    (listener) => deviceStorage.subscribe((key) => key === SIDEBAR_WIDTH_KEY && listener()),
    () => deviceStorage.getItem(SIDEBAR_WIDTH_KEY),
  )
  const stored = parseSidebarWidth(raw)
  const lastPreferred = useRef(preferred)
  useEffect(() => {
    const changed = lastPreferred.current !== preferred
    lastPreferred.current = preferred
    // Seed once, and follow the preference when it is saved or reset (Settings), so those still move the sidebar.
    if ((stored === null || changed) && parseSidebarWidth(String(preferred)) !== null)
      deviceStorage.setItem(SIDEBAR_WIDTH_KEY, String(preferred))
  }, [stored, preferred])
  const set = useCallback((width: number) => deviceStorage.setItem(SIDEBAR_WIDTH_KEY, String(Math.round(width))), [])
  return [stored ?? preferred, set]
}

/** A side pane's width in pixels: where it starts, and how narrow or wide dragging may make it. */
export interface SplitBounds {
  initial: number
  min: number
  max: number
}

const splitKey = (id: string) => `${PREFIX}split.${id}`

/**
 * A page's remembered side-pane width on this device, or `bounds.initial` when none is stored or the stored value is
 * no longer inside the bounds. Lives under the layout prefix so resetting layout sizes clears it too.
 */
export function readSplitWidth(storage: Pick<DeviceStorage, 'getItem'>, id: string, bounds: SplitBounds) {
  const raw = storage.getItem(splitKey(id))
  const value = raw === null ? NaN : Number(raw)
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max ? value : bounds.initial
}

/** Remembers a dragged width, kept inside the bounds; the starting width is stored as no preference at all. */
export function saveSplitWidth(
  storage: Pick<DeviceStorage, 'setItem' | 'removeItem'>,
  id: string,
  bounds: SplitBounds,
  width: number,
) {
  const value = Math.round(Math.min(bounds.max, Math.max(bounds.min, width)))
  if (value === bounds.initial) storage.removeItem(splitKey(id))
  else storage.setItem(splitKey(id), String(value))
}

let epoch = 0
const listeners = new Set<() => void>()

/** Groups remount with this as their key after a reset, so they re-read the now-empty storage. */
export function useLayoutEpoch() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => epoch,
  )
}

export function resetPanelLayouts() {
  for (const key of deviceStorage.keys(PREFIX)) deviceStorage.removeItem(key)
  deviceStorage.setItem(SIDEBAR_WIDTH_KEY, String(DEFAULT_SIDEBAR_WIDTH))
  clearOwnHostLayout()
  epoch++
  listeners.forEach((listener) => listener())
}

/** Read the layout for the current panel combination. Callers remount the split shell
 * when its panels change, keeping view contents mounted in their own portal hosts. */
export function usePanelLayout(id: string, panelIds: string[], fallback: (panelIds: string[]) => Layout) {
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id,
    panelIds,
    storage,
    onlySaveAfterUserInteractions: true,
  })
  const group = useGroupRef()
  const wanted = defaultLayout ?? fallback(panelIds)
  const size = (panel: string) => {
    const value = wanted[panel]
    return value === undefined ? undefined : `${value}%`
  }
  return { groupRef: group, defaultLayout: wanted, onLayoutChanged, size }
}

/** A single per-workspace size (a split share) remembered across launches, under this window's host. */
export function readSize(key: string, fallback: number, host = ownHostId()) {
  const value = Number(hostStorageFor(host).getItem(PREFIX + key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}
