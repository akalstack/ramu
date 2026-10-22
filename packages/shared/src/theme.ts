/**
 * Ramu's theme model: one versioned set of semantic color roles per appearance. Colors are explicit hex values only, so
 * a theme can be validated, compared and shared as data; layout, geometry and behavior are not themeable.
 */

import { sha256Hex } from './sha256'

export const THEME_SCHEMA_VERSION = 1

export const THEME_ROLES = [
  'window',
  'canvas',
  'raised',
  'subtle',
  'bubble',
  'codeBackground',
  'text',
  'textBody',
  'soft',
  'muted',
  'placeholder',
  'primary',
  'primaryHover',
  'primaryInk',
  'accent',
  'ok',
  'warn',
  'bad',
] as const
export type ThemeRole = (typeof THEME_ROLES)[number]

/** One appearance. `overlay` is the ink that translucent fills and lines are drawn with: white on dark, black on light. */
export interface ThemeVariant {
  overlay: 'white' | 'black'
  colors: Record<ThemeRole, string>
}

export interface RamuTheme {
  schema: typeof THEME_SCHEMA_VERSION
  id: string
  name: string
  light: ThemeVariant
  dark: ThemeVariant
}

export const DEFAULT_DARK: ThemeVariant = {
  overlay: 'white',
  colors: {
    window: '#131315',
    canvas: '#1c1c1f',
    raised: '#29292d',
    subtle: '#29292d',
    bubble: '#2c2c31',
    codeBackground: '#141416',
    text: '#f5f5f7',
    textBody: '#e4e4e7',
    soft: '#c7c7cc',
    muted: '#a1a1a8',
    placeholder: '#6c6c72',
    primary: '#7652d4',
    primaryHover: '#8060d8',
    primaryInk: '#ffffff',
    accent: '#b7a6f3',
    ok: '#30d158',
    warn: '#ffb340',
    bad: '#ff6961',
  },
}

export const DEFAULT_LIGHT: ThemeVariant = {
  overlay: 'black',
  colors: {
    window: '#ececef',
    canvas: '#ffffff',
    raised: '#ffffff',
    subtle: '#f0f0f3',
    bubble: '#ebebef',
    codeBackground: '#f4f4f6',
    text: '#17171a',
    textBody: '#26262b',
    soft: '#46464d',
    muted: '#62626a',
    placeholder: '#8a8a92',
    primary: '#7652d4',
    primaryHover: '#8060d8',
    primaryInk: '#ffffff',
    accent: '#5b36b8',
    ok: '#1a7f37',
    warn: '#9a5b00',
    bad: '#c62828',
  },
}

export const DEFAULT_THEME: RamuTheme = {
  schema: THEME_SCHEMA_VERSION,
  id: 'ramu-default',
  name: 'Ramu Default',
  light: DEFAULT_LIGHT,
  dark: DEFAULT_DARK,
}

const HEX = /^#[0-9a-f]{6}$/
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/

/** Pairs that must stay readable: a role drawn on a surface, with the lowest acceptable WCAG contrast ratio. */
export const READABILITY_CHECKS: { role: ThemeRole; on: ThemeRole; min: number }[] = [
  { role: 'text', on: 'canvas', min: 7 },
  { role: 'textBody', on: 'canvas', min: 4.5 },
  { role: 'textBody', on: 'bubble', min: 4.5 },
  { role: 'text', on: 'window', min: 4.5 },
  { role: 'soft', on: 'canvas', min: 4.5 },
  { role: 'muted', on: 'canvas', min: 4.5 },
  { role: 'muted', on: 'window', min: 3 },
  { role: 'placeholder', on: 'canvas', min: 3 },
  { role: 'primaryInk', on: 'primary', min: 4.5 },
  { role: 'accent', on: 'canvas', min: 4.5 },
  { role: 'ok', on: 'canvas', min: 3 },
  { role: 'warn', on: 'canvas', min: 3 },
  { role: 'bad', on: 'canvas', min: 3 },
]

function channel(value: number) {
  const c = value / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG contrast ratio between two `#rrggbb` colors, from 1 to 21. */
export function contrastRatio(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (high + 0.05) / (low + 0.05)
}

/** Status colors that must stay tellable apart, so an error never reads as success or a warning as done. */
const STATUS_PAIRS: [ThemeRole, ThemeRole][] = [
  ['ok', 'warn'],
  ['ok', 'bad'],
  ['warn', 'bad'],
]
const MIN_STATUS_DISTANCE = 60

function colorDistance(a: string, b: string) {
  const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)]
  return Math.hypot(((x >> 16) & 255) - ((y >> 16) & 255), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255))
}

export interface ThemeIssue {
  variant: 'light' | 'dark'
  role: ThemeRole
  message: string
}

/** Readability failures of one variant. A theme with any issue stays a draft: it can be edited but not kept or shared. */
export function checkVariant(variant: ThemeVariant, name: 'light' | 'dark'): ThemeIssue[] {
  const issues: ThemeIssue[] = []
  for (const { role, on, min } of READABILITY_CHECKS) {
    const ratio = contrastRatio(variant.colors[role], variant.colors[on])
    if (ratio < min)
      issues.push({ variant: name, role, message: `${role} on ${on} is ${ratio.toFixed(1)}:1; it needs ${min}:1.` })
  }
  for (const [first, second] of STATUS_PAIRS)
    if (colorDistance(variant.colors[first], variant.colors[second]) < MIN_STATUS_DISTANCE)
      issues.push({ variant: name, role: second, message: `${first} and ${second} look too alike to tell apart.` })
  return issues
}

export const checkTheme = (theme: RamuTheme): ThemeIssue[] => [
  ...checkVariant(theme.light, 'light'),
  ...checkVariant(theme.dark, 'dark'),
]

export type ParsedTheme = { ok: true; theme: RamuTheme } | { ok: false; error: string }

function parseVariant(value: unknown, label: string): ThemeVariant | string {
  if (!value || typeof value !== 'object') return `${label} is missing.`
  const { overlay, colors } = value as Record<string, unknown>
  if (overlay !== 'white' && overlay !== 'black') return `${label}.overlay must be "white" or "black".`
  if (!colors || typeof colors !== 'object') return `${label}.colors is missing.`
  const found = colors as Record<string, unknown>
  const result = {} as Record<ThemeRole, string>
  for (const role of THEME_ROLES) {
    const color = found[role]
    if (typeof color !== 'string' || !HEX.test(color.toLowerCase()))
      return `${label}.colors.${role} must be a #rrggbb color.`
    result[role] = color.toLowerCase()
  }
  return { overlay, colors: result }
}

/**
 * Validates untrusted theme data. Only the declared fields are read, so unknown or executable-looking fields are
 * dropped rather than interpreted. Readability is checked separately by `checkTheme`.
 */
export function parseTheme(value: unknown): ParsedTheme {
  if (!value || typeof value !== 'object') return { ok: false, error: 'A theme must be an object.' }
  const { schema, id, name, light, dark } = value as Record<string, unknown>
  if (schema !== THEME_SCHEMA_VERSION) return { ok: false, error: `Unsupported theme version ${String(schema)}.` }
  if (typeof id !== 'string' || !ID.test(id))
    return { ok: false, error: 'The theme id must be lowercase letters, digits and hyphens.' }
  if (typeof name !== 'string' || !name.trim() || name.length > 80)
    return { ok: false, error: 'The theme needs a name of up to 80 characters.' }
  const parsedLight = parseVariant(light, 'light')
  if (typeof parsedLight === 'string') return { ok: false, error: parsedLight }
  const parsedDark = parseVariant(dark, 'dark')
  if (typeof parsedDark === 'string') return { ok: false, error: parsedDark }
  return { ok: true, theme: { schema, id, name: name.trim(), light: parsedLight, dark: parsedDark } }
}

/** Stable JSON: fixed key order, so equal themes serialize (and hash) identically. */
export function canonicalTheme(theme: RamuTheme): string {
  const variant = (v: ThemeVariant) => ({
    overlay: v.overlay,
    colors: Object.fromEntries(THEME_ROLES.map((r) => [r, v.colors[r]])),
  })
  return JSON.stringify({
    schema: theme.schema,
    id: theme.id,
    name: theme.name,
    light: variant(theme.light),
    dark: variant(theme.dark),
  })
}

/** Content digest that detects changes; it does not authenticate who made the theme. */
export async function themeDigest(theme: RamuTheme): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalTheme(theme))
  // React Native's engine has no SubtleCrypto; the portable fallback gives the same digest.
  if (typeof crypto === 'undefined' || !crypto.subtle) return sha256Hex(bytes)
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The CSS custom properties (styles.css `:root`) a variant sets; the rest derive from them. */
export function themeCssVariables(variant: ThemeVariant): Record<string, string> {
  const c = variant.colors
  return {
    '--window': c.window,
    '--canvas': c.canvas,
    '--raised': c.raised,
    '--subtle': c.subtle,
    '--bubble': c.bubble,
    '--code-bg': c.codeBackground,
    '--text': c.text,
    '--text-body': c.textBody,
    '--soft': c.soft,
    '--muted': c.muted,
    '--placeholder': c.placeholder,
    '--primary': c.primary,
    '--primary-hover': c.primaryHover,
    '--primary-ink': c.primaryInk,
    '--accent': c.accent,
    '--ok': c.ok,
    '--warn': c.warn,
    '--bad': c.bad,
    '--ok-wash': `${c.ok}14`,
    '--warn-wash': `${c.warn}14`,
    '--bad-wash': `${c.bad}14`,
    '--ink': variant.overlay === 'white' ? '255 255 255' : '0 0 0',
  }
}

export const THEME_FILE_EXTENSION = '.ramu-theme.json'
/** Pasted or opened theme text is refused above this size, so a hostile file can't stall the parser. */
export const THEME_FILE_MAX_BYTES = 64 * 1024

/** The portable text of a theme: readable JSON with a digest of its canonical data. */
export async function exportThemeFile(theme: RamuTheme): Promise<string> {
  return JSON.stringify({ ...JSON.parse(canonicalTheme(theme)), digest: await themeDigest(theme) }, null, 2)
}

export type ImportedTheme =
  { ok: true; theme: RamuTheme; issues: ThemeIssue[]; digest: string; edited: boolean } | { ok: false; error: string }

/**
 * Reads a shared theme without changing it. `edited` is true when the file carries a digest that no longer matches
 * its colors; the digest detects changes, it does not prove who made the theme.
 */
export async function importThemeFile(text: string): Promise<ImportedTheme> {
  if (new TextEncoder().encode(text).length > THEME_FILE_MAX_BYTES)
    return { ok: false, error: 'This theme file is too large.' }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'This is not a theme file.' }
  }
  const parsed = parseTheme(raw)
  if (!parsed.ok) return parsed
  const digest = await themeDigest(parsed.theme)
  const declared = (raw as { digest?: unknown }).digest
  return {
    ok: true,
    theme: parsed.theme,
    issues: checkTheme(parsed.theme),
    digest,
    edited: typeof declared === 'string' && declared !== digest,
  }
}
