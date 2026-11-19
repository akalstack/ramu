import { describe, expect, it } from 'vitest'
import { resolveAppearance, storedAppearance } from '../src/appearance'
import { RAMU_EDITOR_COLORS, RAMU_EDITOR_COLORS_LIGHT, editorThemeName } from '../src/editor/editorTheme'

describe('appearance', () => {
  it('keeps the original dark look until a choice is stored', () => {
    expect(storedAppearance()).toBe('dark')
  })

  it('follows the system only for the system choice', () => {
    expect(resolveAppearance('system', true)).toBe('dark')
    expect(resolveAppearance('system', false)).toBe('light')
    expect(resolveAppearance('light', true)).toBe('light')
    expect(resolveAppearance('dark', false)).toBe('dark')
  })

  it('gives the editor a complete theme for each appearance', () => {
    expect(editorThemeName('dark')).toBe('ramu')
    expect(editorThemeName('light')).toBe('ramu-light')
    expect(Object.keys(RAMU_EDITOR_COLORS_LIGHT).sort()).toEqual(Object.keys(RAMU_EDITOR_COLORS).sort())
  })
})

describe('custom editor colors', () => {
  it('takes surfaces and accent from the theme and keeps every other role', async () => {
    const { DEFAULT_THEME } = await import('@ramu/shared/theme')
    const { editorColorsFor } = await import('../src/editor/editorTheme')
    const theme = {
      ...DEFAULT_THEME,
      dark: { ...DEFAULT_THEME.dark, colors: { ...DEFAULT_THEME.dark.colors, canvas: '#10202a', accent: '#40c0a0' } },
    }
    const colors = editorColorsFor(theme, 'dark')
    expect(colors['editor.background']).toBe('#10202a')
    expect(colors['editorCursor.foreground']).toBe('#40c0a0')
    expect(Object.keys(colors).sort()).toEqual(Object.keys(RAMU_EDITOR_COLORS).sort())
  })
})

describe('theme preview scope', () => {
  it('restates the overlay steps so a preview does not inherit the app’s', async () => {
    const { DEFAULT_THEME } = await import('@ramu/shared/theme')
    const { previewVariables } = await import('../src/theme/ThemePreview')
    const light = previewVariables(DEFAULT_THEME.light) as Record<string, string>
    const dark = previewVariables(DEFAULT_THEME.dark) as Record<string, string>
    expect(light['--fill']).toBe('rgb(0 0 0 / 0.055)')
    expect(dark['--fill']).toBe('rgb(255 255 255 / 0.05)')
    expect(light.colorScheme).toBe('light')
    expect(light['--canvas']).toBe(DEFAULT_THEME.light.colors.canvas)
  })
})
