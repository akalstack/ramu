import { cardSurface, type ThemeVariant } from './theme'

/** The phone's color roles. Surfaces, text and status come from the theme; fills and lines derive from its overlay ink. */
export interface MobilePalette {
  window: string
  canvas: string
  raised: string
  raised2: string
  bubble: string
  code: string
  fill: string
  pressed: string
  line: string
  lineStrong: string
  text: string
  body: string
  soft: string
  muted: string
  placeholder: string
  primary: string
  primaryInk: string
  accent: string
  accentWash: string
  accentSoft: string
  /** Words a find or quote led to in a message. */
  mark: string
  ok: string
  okWash: string
  warn: string
  warnWash: string
  bad: string
  badWash: string
  terminal: string
}

const parts = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = parts(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * Maps one appearance of a theme to the phone's palette. Ramu Default keeps its hand-tuned phone palettes; this mapping
 * serves installed themes, so a shared theme reproduces the same surface hierarchy and status colors on a phone.
 */
export function mobilePalette(variant: ThemeVariant): MobilePalette {
  const c = variant.colors
  const ink = variant.overlay === 'white' ? [255, 255, 255] : [60, 60, 67]
  const overlay = (alpha: number) => `rgba(${ink.join(',')},${alpha})`
  const dark = variant.overlay === 'white'
  return {
    window: c.window,
    canvas: c.canvas,
    raised: c.raised,
    raised2: cardSurface(variant),
    bubble: c.bubble,
    code: c.codeBackground,
    fill: overlay(dark ? 0.05 : 0.08),
    pressed: overlay(dark ? 0.09 : 0.12),
    line: overlay(dark ? 0.065 : 0.1),
    lineStrong: overlay(dark ? 0.11 : 0.18),
    text: c.text,
    body: c.textBody,
    soft: c.soft,
    muted: c.muted,
    placeholder: c.placeholder,
    primary: c.primary,
    primaryInk: c.primaryInk,
    accent: c.accent,
    accentWash: rgba(c.accent, 0.1),
    accentSoft: rgba(c.accent, dark ? 0.18 : 0.13),
    mark: rgba(c.accent, dark ? 0.38 : 0.24),
    ok: c.ok,
    okWash: rgba(c.ok, dark ? 0.08 : 0.1),
    warn: c.warn,
    warnWash: rgba(c.warn, dark ? 0.08 : 0.1),
    bad: c.bad,
    badWash: rgba(c.bad, dark ? 0.08 : 0.1),
    terminal: c.codeBackground,
  }
}
