import { DEFAULT_THEME, parseTheme, type ThemeVariant } from './theme'

export const THEME_EDITOR_PREVIEW_URL = 'ramu-theme://preview/theme-editor.html'
export interface ThemeEditorUpdate {
  ramuThemePreview: 1
  type: 'update'
  instance: string
  request: number
  appearance: 'light' | 'dark'
  view: 'code' | 'diff'
  split: boolean
  variant: ThemeVariant
}
/** Preview data can choose a palette and local view, never source, paths, commands or callbacks. */
export function parseThemeEditorUpdate(value: unknown): ThemeEditorUpdate | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  if (
    m.ramuThemePreview !== 1 ||
    m.type !== 'update' ||
    typeof m.instance !== 'string' ||
    !m.instance ||
    m.instance.length > 160 ||
    !Number.isSafeInteger(m.request) ||
    (m.request as number) < 1 ||
    (m.appearance !== 'light' && m.appearance !== 'dark') ||
    (m.view !== 'code' && m.view !== 'diff') ||
    typeof m.split !== 'boolean'
  )
    return null
  const parsed = parseTheme({ ...DEFAULT_THEME, id: 'preview', name: 'Preview', light: m.variant, dark: m.variant })
  if (!parsed.ok) return null
  return {
    ramuThemePreview: 1,
    type: 'update',
    instance: m.instance,
    request: m.request as number,
    appearance: m.appearance,
    view: m.view,
    split: m.split,
    variant: parsed.theme[m.appearance],
  }
}
