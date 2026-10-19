import { useSyncExternalStore } from 'react'
import {
  DEFAULT_THEME,
  checkTheme,
  parseTheme,
  themeCssVariables,
  type RamuTheme,
  type ThemeIssue,
} from '@ramu/shared/theme'
import { deviceStorage } from '../deviceStorage'
import { resolvedAppearance, subscribeAppearance, type ResolvedAppearance } from '../appearance'

const LIBRARY_KEY = 'theme.library'
const SELECTED_KEY = 'theme.selected'
/** A theme kept on this device. The library is small (a handful of themes), so device state holds it directly. */
const MAX_THEMES = 20

/** A candidate being tried: applied to this window only, never persisted until it is kept. */
let trial: RamuTheme | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

function parseLibrary(text: string): RamuTheme[] {
  try {
    const raw = JSON.parse(text) as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item) => {
      const parsed = parseTheme(item)
      return parsed.ok ? [parsed.theme] : []
    })
  } catch {
    return []
  }
}

// useSyncExternalStore needs a stable snapshot, so the parsed library is reused until its stored text changes.
let cachedText: string | null = null
let cachedLibrary: RamuTheme[] = []
export function themeLibrary(): RamuTheme[] {
  const text = deviceStorage.getItem(LIBRARY_KEY) ?? '[]'
  if (text !== cachedText) {
    cachedText = text
    cachedLibrary = parseLibrary(text)
  }
  return cachedLibrary
}

export function selectedTheme(): RamuTheme {
  const id = deviceStorage.getItem(SELECTED_KEY)
  return (id && themeLibrary().find((theme) => theme.id === id)) || DEFAULT_THEME
}

/** What this window shows: the theme being tried, otherwise the selected one. */
export const effectiveTheme = () => trial ?? selectedTheme()
export const isCustomTheme = (theme: RamuTheme) => theme.id !== DEFAULT_THEME.id

/** Saves and selects a theme. A theme with readability failures is refused and its issues returned. */
export function keepTheme(theme: RamuTheme): ThemeIssue[] {
  const issues = checkTheme(theme)
  if (issues.length) return issues
  const others = themeLibrary().filter((saved) => saved.id !== theme.id)
  deviceStorage.setItem(LIBRARY_KEY, JSON.stringify([theme, ...others].slice(0, MAX_THEMES)))
  deviceStorage.setItem(SELECTED_KEY, theme.id)
  trial = null
  emit()
  return []
}

/** Selects a saved theme, or Ramu Default with no id. */
export function selectTheme(id: string | null) {
  if (id && themeLibrary().some((theme) => theme.id === id)) deviceStorage.setItem(SELECTED_KEY, id)
  else deviceStorage.removeItem(SELECTED_KEY)
  emit()
}

export function removeTheme(id: string) {
  deviceStorage.setItem(LIBRARY_KEY, JSON.stringify(themeLibrary().filter((theme) => theme.id !== id)))
  if (deviceStorage.getItem(SELECTED_KEY) === id) deviceStorage.removeItem(SELECTED_KEY)
  emit()
}

export function startTrial(theme: RamuTheme) {
  trial = theme
  emit()
}

export function endTrial() {
  if (!trial) return
  trial = null
  emit()
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  const off = deviceStorage.subscribe((key) => (key === LIBRARY_KEY || key === SELECTED_KEY) && listener())
  const offAppearance = subscribeAppearance(listener)
  return () => {
    listeners.delete(listener)
    off()
    offAppearance()
  }
}

export const useEffectiveTheme = () => useSyncExternalStore(subscribeTheme, effectiveTheme)
export const useThemeLibrary = () => useSyncExternalStore(subscribeTheme, themeLibrary)
export const useSelectedTheme = () => useSyncExternalStore(subscribeTheme, selectedTheme)

const applied = new Set<string>()

/** Writes a custom theme's colors onto the root; Ramu Default clears them so styles.css supplies its own. */
export function applyTheme(root: HTMLElement, theme: RamuTheme, appearance: ResolvedAppearance) {
  for (const name of applied) root.style.removeProperty(name)
  applied.clear()
  if (!isCustomTheme(theme)) return
  for (const [name, value] of Object.entries(themeCssVariables(theme[appearance]))) {
    root.style.setProperty(name, value)
    applied.add(name)
  }
}

/** Keeps the root in step with the chosen theme and appearance. */
export function installTheme(root: HTMLElement = document.documentElement) {
  const apply = () => applyTheme(root, effectiveTheme(), resolvedAppearance())
  apply()
  return subscribeTheme(apply)
}
