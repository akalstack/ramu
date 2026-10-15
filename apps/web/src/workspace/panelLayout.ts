import { useSyncExternalStore } from 'react'
import { useDefaultLayout, useGroupRef, type Layout, type LayoutStorage } from 'react-resizable-panels'

/**
 * Panel layouts are remembered per group and per set of visible panels (chat + editor,
 * chat + editor + terminal, ...), as proportions. Coming back to a combination restores
 * exactly what the user last left it at instead of recomputing from fixed pixel widths.
 */
const PREFIX = 'ramu.layout.'
const storage: LayoutStorage = {
  getItem: (key) => localStorage.getItem(PREFIX + key),
  setItem: (key, value) => localStorage.setItem(PREFIX + key, value),
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
  for (const key of Object.keys(localStorage)) if (key.startsWith(PREFIX)) localStorage.removeItem(key)
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

/** A single pixel size (a sidebar or tool column) remembered across launches. */
export function readSize(key: string, fallback: number) {
  const value = Number(localStorage.getItem(PREFIX + key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function writeSize(key: string, value: number) {
  localStorage.setItem(PREFIX + key, String(Math.round(value)))
}
