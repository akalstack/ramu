import { describe, expect, it } from 'vitest'
import { checkTheme, parseTheme } from '../src/theme'
import { mobilePalette } from '../src/themeMobile'
import { THEME_PRESETS, themePreset } from '../src/themePresets'

describe('built-in themes', () => {
  it('ship with unique ids, valid data and no readability failures', () => {
    expect(new Set(THEME_PRESETS.map((theme) => theme.id)).size).toBe(THEME_PRESETS.length)
    for (const theme of THEME_PRESETS) {
      expect(parseTheme(theme).ok, theme.id).toBe(true)
      expect(checkTheme(theme).map((issue) => `${theme.id} ${issue.variant} ${issue.message}`)).toEqual([])
    }
  })
  it('never take the id of Ramu Default and are found by id', () => {
    expect(THEME_PRESETS.some((theme) => theme.id === 'ramu-default')).toBe(false)
    expect(themePreset('ramu-forest')?.name).toBe('Forest')
    expect(themePreset('nope')).toBeUndefined()
  })
  it('give the phone a complete palette in both appearances', () => {
    for (const theme of THEME_PRESETS)
      for (const scheme of ['light', 'dark'] as const)
        for (const [key, value] of Object.entries(mobilePalette(theme[scheme])))
          expect(value, `${theme.id} ${scheme} ${key}`).toBeTruthy()
  })
})
