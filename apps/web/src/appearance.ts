import { useSyncExternalStore } from 'react'
import { deviceStorage } from './deviceStorage'

export type Appearance = 'system' | 'light' | 'dark'
export type ResolvedAppearance = 'light' | 'dark'

const KEY = 'appearance'
const DARK_QUERY = '(prefers-color-scheme: dark)'

const media = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(DARK_QUERY) : undefined)

/** The device's choice. Nothing stored means the original dark look, so an upgrade never flips an existing window. */
export function storedAppearance(): Appearance {
  const value = deviceStorage.getItem(KEY)
  return value === 'system' || value === 'light' ? value : 'dark'
}

export function setAppearance(appearance: Appearance) {
  deviceStorage.setItem(KEY, appearance)
}

export function resolveAppearance(appearance: Appearance, systemDark: boolean): ResolvedAppearance {
  return appearance === 'system' ? (systemDark ? 'dark' : 'light') : appearance
}

export function resolvedAppearance(): ResolvedAppearance {
  return resolveAppearance(storedAppearance(), media()?.matches ?? true)
}

/** Runs when the stored choice or the system appearance changes. Returns the unsubscribe function. */
export function subscribeAppearance(listener: () => void) {
  const query = media()
  const off = deviceStorage.subscribe((key) => key === KEY && listener())
  query?.addEventListener('change', listener)
  return () => {
    off()
    query?.removeEventListener('change', listener)
  }
}

/** Marks the document before first paint and follows later changes. */
export function installAppearance(root: HTMLElement = document.documentElement) {
  const apply = () => {
    root.dataset.appearance = resolvedAppearance()
  }
  apply()
  return subscribeAppearance(apply)
}

export function useAppearance() {
  return useSyncExternalStore(subscribeAppearance, storedAppearance)
}

export function useResolvedAppearance() {
  return useSyncExternalStore(subscribeAppearance, resolvedAppearance)
}
