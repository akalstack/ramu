import { DEFAULT_DARK, DEFAULT_LIGHT, type ThemeVariant } from './theme'

/** The app colors each renderer (desktop, mobile, preview) hands to generated documents. */
export interface InteractivePalette {
  scheme: 'light' | 'dark'
  background: string
  foreground: string
  muted: string
  /** Brand accent for text, links, focus and highlights. */
  primary: string
  /** Cards and panels on the background. */
  surface: string
  /** Buttons, inputs and tracks. */
  surfaceRaised: string
  codeBackground: string
  /** Solid action fill and the ink drawn on it. */
  button: string
  buttonForeground: string
  success: string
  warning: string
  danger: string
}

const CHART = {
  dark: ['#60a5fa', '#2dd4bf', '#fbbf24', '#fb7185', '#a3e635'],
  light: ['#2563eb', '#0d9488', '#d97706', '#e11d48', '#65a30d'],
} as const

/**
 * CSS custom properties a generated document can rely on. `--background`, `--foreground`, `--muted` and `--primary`
 * keep their original meaning so published documents restyle correctly; the rest are additive.
 */
export function interactiveThemeVariables(p: InteractivePalette): Record<string, string> {
  return {
    '--scheme': p.scheme,
    '--background': p.background,
    '--foreground': p.foreground,
    '--muted': p.muted,
    '--primary': p.primary,
    '--surface': p.surface,
    '--surface-raised': p.surfaceRaised,
    '--border': p.scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)',
    '--code-background': p.codeBackground,
    '--button': p.button,
    '--button-foreground': p.buttonForeground,
    '--success': p.success,
    '--warning': p.warning,
    '--danger': p.danger,
    '--chart-1': p.primary,
    ...Object.fromEntries(CHART[p.scheme].map((color, index) => [`--chart-${index + 2}`, color])),
  }
}

export function interactivePaletteFromVariant(variant: ThemeVariant, scheme: 'light' | 'dark'): InteractivePalette {
  const c = variant.colors
  return {
    scheme,
    background: c.canvas,
    foreground: c.text,
    muted: c.muted,
    primary: c.accent,
    surface: c.raised,
    surfaceRaised: c.bubble,
    codeBackground: c.codeBackground,
    button: c.primary,
    buttonForeground: c.primaryInk,
    success: c.ok,
    warning: c.warn,
    danger: c.bad,
  }
}

const rule = (variables: Record<string, string>) =>
  Object.entries(variables)
    .map(([name, value]) => `${name}:${value};`)
    .join('')

/** Default tokens before the host posts its live theme; follows the OS appearance until then. */
export const INTERACTIVE_DEFAULT_THEME_CSS =
  `:root{${rule(interactiveThemeVariables(interactivePaletteFromVariant(DEFAULT_DARK, 'dark')))}` +
  `--radius:10px;--font-sans:system-ui,-apple-system,"Segoe UI",sans-serif;--font-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace}` +
  `@media(prefers-color-scheme:light){:root{${rule(interactiveThemeVariables(interactivePaletteFromVariant(DEFAULT_LIGHT, 'light')))}}}`
