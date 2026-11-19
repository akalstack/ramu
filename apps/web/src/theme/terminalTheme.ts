import { isCustomTheme } from './themes'
import type { RamuTheme, ThemeVariant } from '@ramu/shared/theme'
import type { ResolvedAppearance } from '../appearance'

const LIGHT_TERMINAL = {
  background: '#f4f4f6',
  foreground: '#26262b',
  cursor: '#7652d4',
  cursorAccent: '#f4f4f6',
  selectionBackground: '#7652d433',
  black: '#26262b',
  red: '#c62828',
  green: '#1a7f37',
  yellow: '#8a5a00',
  blue: '#1f5fbf',
  magenta: '#8a3fa8',
  cyan: '#0f7a80',
  white: '#62626a',
  brightBlack: '#62626a',
  brightRed: '#d32f2f',
  brightGreen: '#2e8f4a',
  brightYellow: '#9a6a00',
  brightBlue: '#2f6fd0',
  brightMagenta: '#9a4fb8',
  brightCyan: '#1a8a90',
  brightWhite: '#8a8a92',
}

/** The dark theme keeps xterm's ANSI palette; the light one darkens every color that would vanish on white. */
export function terminalTheme(appearance: ResolvedAppearance, custom: RamuTheme) {
  if (isCustomTheme(custom)) {
    return terminalThemeForVariant(custom[appearance], appearance)
  }
  if (appearance === 'dark') return { background: '#141416', cursor: '#72b4ff', selectionBackground: '#72b4ff35' }
  return LIGHT_TERMINAL
}

/** Candidate mapping shares the live terminal's custom-theme path without changing the app theme. */
export function terminalThemeForVariant(variant: ThemeVariant, appearance: ResolvedAppearance) {
  const c = variant.colors
  return {
    ...(appearance === 'light' ? LIGHT_TERMINAL : {}),
    background: c.codeBackground,
    foreground: c.textBody,
    cursor: c.accent,
    cursorAccent: c.codeBackground,
    selectionBackground: `${c.accent}40`,
  }
}
