import { readAppearance, saveAppearance } from '../storage'
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Platform, useColorScheme } from 'react-native'

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
  ok: '#30d158',
  okWash: 'rgba(48,209,88,0.08)',
  warn: '#ffb340',
  warnWash: 'rgba(255,179,64,0.08)',
  bad: '#ff6961',
  badWash: 'rgba(255,105,97,0.08)',
  terminal: '#0e0e10',
}

export type Palette = typeof dark

const light: Palette = {
  window: '#f2f2f4',
  canvas: '#ffffff',
  raised: '#ececef',
  raised2: '#f5f5f7',
  bubble: '#ececf0',
  code: '#f4f4f6',
  fill: 'rgba(0,0,0,0.04)',
  pressed: 'rgba(0,0,0,0.08)',
  line: 'rgba(0,0,0,0.07)',
  lineStrong: 'rgba(0,0,0,0.12)',
  text: '#111113',
  body: '#27272a',
  soft: '#3f3f46',
  muted: '#6b6b73',
  placeholder: '#a1a1a8',
  primary: '#5b40ad',
  primaryInk: '#ffffff',
  accent: '#6a46c8',
  accentWash: 'rgba(118,82,212,0.08)',
  ok: '#1f9d45',
  okWash: 'rgba(31,157,69,0.08)',
  warn: '#b26b00',
  warnWash: 'rgba(178,107,0,0.08)',
  bad: '#d93a32',
  badWash: 'rgba(217,58,50,0.08)',
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

interface ThemeValue {
  c: Palette
  scheme: 'light' | 'dark'
  appearance: Appearance
  setAppearance: (a: Appearance) => void
}

const ThemeContext = createContext<ThemeValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [appearance, updateAppearance] = useState<Appearance>(readAppearance)
  const setAppearance = (value: Appearance) => {
    saveAppearance(value)
    updateAppearance(value)
  }
  const scheme = appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance
  const value = useMemo(
    () => ({ c: scheme === 'light' ? light : dark, scheme, appearance, setAppearance }),
    [scheme, appearance],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme outside ThemeProvider')
  return value
}
