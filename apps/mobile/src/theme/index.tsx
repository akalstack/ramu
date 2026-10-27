import {
  readAppearance,
  readSelectedThemeId,
  readTextSize,
  readThemeLibraryText,
  saveAppearance,
  saveSelectedThemeId,
  saveTextSize,
  saveThemeLibraryText,
  type TextSize,
} from '../storage'
import { DEFAULT_THEME, checkTheme, parseTheme, type RamuTheme, type ThemeIssue } from '@ramu/shared/theme'
import { themePreset } from '@ramu/shared/themePresets'
import { mobilePalette } from '@ramu/shared/themeMobile'
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Appearance, Platform, useColorScheme } from 'react-native'

// Ported from apps/web/src/styles.css: neutral gray surfaces separated by shade,
// violet only for primary actions and highlights.
const dark = {
  window: '#131315',
  canvas: '#1c1c1f',
  raised: '#29292d',
  raised2: '#232327',
  bubble: '#2c2c31',
  code: '#141416',
  fill: 'rgba(255,255,255,0.05)',
  pressed: 'rgba(255,255,255,0.09)',
  line: 'rgba(255,255,255,0.065)',
  lineStrong: 'rgba(255,255,255,0.11)',
  text: '#f5f5f7',
  body: '#e4e4e7',
  soft: '#c7c7cc',
  muted: '#a1a1a8',
  placeholder: '#6c6c72',
  // Filled buttons are large on a phone; a deeper violet than the desktop's
  // #7652d4 keeps them from overpowering the neutral surfaces.
  primary: '#5b40ad',
  primaryInk: '#ffffff',
  accent: '#b7a6f3',
  accentWash: 'rgba(183,166,243,0.10)',
  // Selected chips and toggles: a quiet tonal violet, not the loud filled primary.
  accentSoft: 'rgba(183,166,243,0.18)',
  ok: '#30d158',
  okWash: 'rgba(48,209,88,0.08)',
  warn: '#ffb340',
  warnWash: 'rgba(255,179,64,0.08)',
  bad: '#ff6961',
  badWash: 'rgba(255,105,97,0.08)',
  terminal: '#0e0e10',
}

export type Palette = typeof dark

// iOS grouped look: cards are white on a cool gray page, so groups separate by shade like the dark theme does.
const light: Palette = {
  window: '#f2f2f7',
  canvas: '#f2f2f7',
  raised: '#e5e5ea',
  raised2: '#ffffff',
  bubble: '#e9e9ee',
  code: '#f4f4f6',
  fill: 'rgba(60,60,67,0.08)',
  pressed: 'rgba(60,60,67,0.12)',
  line: 'rgba(60,60,67,0.10)',
  lineStrong: 'rgba(60,60,67,0.18)',
  text: '#111113',
  body: '#27272a',
  soft: '#3f3f46',
  muted: '#6b6b73',
  placeholder: '#a1a1a8',
  primary: '#5b40ad',
  primaryInk: '#ffffff',
  accent: '#6a46c8',
  accentWash: 'rgba(118,82,212,0.10)',
  accentSoft: 'rgba(106,70,200,0.13)',
  ok: '#1f9d45',
  okWash: 'rgba(31,157,69,0.10)',
  warn: '#b26b00',
  warnWash: 'rgba(178,107,0,0.10)',
  bad: '#d93a32',
  badWash: 'rgba(217,58,50,0.10)',
  terminal: '#0e0e10',
}

export const radius = { xs: 4, s: 8, row: 10, m: 12, l: 20, xl: 24, full: 999 } as const
export const space = { xs: 4, s: 8, m: 12, l: 16, xl: 24 } as const
export const font = {
  caption: 12,
  control: 13,
  body: 15,
  heading: 17,
  title: 22,
  hero: 28,
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  }),
} as const

export type Appearance = 'system' | 'light' | 'dark'
export type { TextSize }
/** Multiplies the app's own sizes on top of the OS text size, which RN already applies. */
export const TEXT_SCALE: Record<TextSize, number> = { default: 1, large: 1.12, larger: 1.25 }

/** Themes kept on this phone. Each document is validated again on load, so damaged text never reaches the palette. */
const MAX_THEMES = 20
function readLibrary(): RamuTheme[] {
  try {
    const raw = JSON.parse(readThemeLibraryText() ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item) => {
      const parsed = parseTheme(item)
      return parsed.ok ? [parsed.theme] : []
    })
  } catch {
    return []
  }
}
/** A trial is only ever a preview: it reverts on its own after this long unless it is kept. */
const TRIAL_MS = 2 * 60_000

interface ThemeValue {
  /** The theme in effect (the trial while one runs), and the kept themes. Ramu Default is not in the list. */
  theme: RamuTheme
  themes: RamuTheme[]
  trial: RamuTheme | null
  /** Shows a theme without keeping it; null reverts. Never persisted. */
  tryTheme: (theme: RamuTheme | null) => void
  /** Keeps and selects a theme; one that fails the readability checks is refused with its issues. */
  keepTheme: (theme: RamuTheme) => ThemeIssue[]
  /** Selects a kept or built-in theme, or Ramu Default with no id. */
  selectTheme: (id: string | null) => void
  removeTheme: (id: string) => void
  /** Renames a kept theme; false when the name is empty or the theme is not a kept one. */
  renameTheme: (id: string, name: string) => boolean
  c: Palette
  scheme: 'light' | 'dark'
  appearance: Appearance
  setAppearance: (a: Appearance) => void
  textSize: TextSize
  setTextSize: (size: TextSize) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [appearance, updateAppearance] = useState<Appearance>(readAppearance)
  // Native search, toolbars, tabs and dialogs must follow the app's override too.
  useEffect(() => {
    if (Platform.OS !== 'web') Appearance.setColorScheme(appearance === 'system' ? 'unspecified' : appearance)
  }, [appearance])
  const [textSize, updateTextSize] = useState<TextSize>(readTextSize)
  const setTextSize = (value: TextSize) => {
    saveTextSize(value)
    updateTextSize(value)
  }
  const setAppearance = (value: Appearance) => {
    saveAppearance(value)
    updateAppearance(value)
  }
  const scheme = appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance
  const [themes, setThemes] = useState<RamuTheme[]>(readLibrary)
  const [selectedId, setSelectedId] = useState(readSelectedThemeId)
  const [trial, setTrial] = useState<RamuTheme | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const tryTheme = (theme: RamuTheme | null) => {
    clearTimeout(timer.current)
    setTrial(theme)
    if (theme) timer.current = setTimeout(() => setTrial(null), TRIAL_MS)
  }
  const keepTheme = (theme: RamuTheme) => {
    const issues = checkTheme(theme)
    if (issues.length) return issues
    const next = [theme, ...themes.filter((saved) => saved.id !== theme.id)].slice(0, MAX_THEMES)
    // The library is written before the pointer, so a failed write never selects a theme that is not stored.
    saveThemeLibraryText(JSON.stringify(next))
    saveSelectedThemeId(theme.id)
    setThemes(next)
    setSelectedId(theme.id)
    tryTheme(null)
    return []
  }
  const selectTheme = (id: string | null) => {
    const next = id && (themes.some((theme) => theme.id === id) || themePreset(id)) ? id : ''
    saveSelectedThemeId(next)
    setSelectedId(next)
  }
  const renameTheme = (id: string, name: string) => {
    const label = name.trim().slice(0, 80)
    if (!label || !themes.some((theme) => theme.id === id)) return false
    const next = themes.map((theme) => (theme.id === id ? { ...theme, name: label } : theme))
    saveThemeLibraryText(JSON.stringify(next))
    setThemes(next)
    return true
  }
  const removeTheme = (id: string) => {
    const next = themes.filter((theme) => theme.id !== id)
    saveThemeLibraryText(JSON.stringify(next))
    setThemes(next)
    if (selectedId === id) {
      saveSelectedThemeId('')
      setSelectedId('')
    }
  }
  const theme = trial ?? themes.find((item) => item.id === selectedId) ?? themePreset(selectedId) ?? DEFAULT_THEME
  const value = useMemo(
    () => ({
      theme,
      themes,
      trial,
      tryTheme,
      keepTheme,
      selectTheme,
      removeTheme,
      renameTheme,
      c: theme.id === DEFAULT_THEME.id ? (scheme === 'light' ? light : dark) : mobilePalette(theme[scheme]),
      scheme,
      appearance,
      setAppearance,
      textSize,
      setTextSize,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [scheme, appearance, textSize, theme, themes, trial] by design; the values it reads beyond these are current as of that run
    [scheme, appearance, textSize, theme, themes, trial],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme outside ThemeProvider')
  return value
}
