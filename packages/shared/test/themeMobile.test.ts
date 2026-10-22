import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { sha256Hex } from '../src/sha256'
import { DEFAULT_DARK, DEFAULT_LIGHT, DEFAULT_THEME, canonicalTheme, themeDigest } from '../src/theme'
import { mixColors, mobilePalette } from '../src/themeMobile'

describe('theme on a phone', () => {
  it('computes the same digest without SubtleCrypto', async () => {
    for (const text of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), canonicalTheme(DEFAULT_THEME)])
      expect(sha256Hex(new TextEncoder().encode(text))).toBe(createHash('sha256').update(text).digest('hex'))
    expect(await themeDigest(DEFAULT_THEME)).toBe(sha256Hex(new TextEncoder().encode(canonicalTheme(DEFAULT_THEME))))
  })

  it('maps surfaces, text and status roles and derives fills from the overlay ink', () => {
    const dark = mobilePalette(DEFAULT_DARK)
    expect(dark).toMatchObject({ window: '#131315', text: '#f5f5f7', ok: '#30d158', code: '#141416' })
    expect(dark.fill).toBe('rgba(255,255,255,0.05)')
    expect(dark.badWash).toBe('rgba(255,105,97,0.08)')
    const light = mobilePalette(DEFAULT_LIGHT)
    expect(light.fill).toBe('rgba(60,60,67,0.08)')
    expect(light.raised2).toBe(mixColors(DEFAULT_LIGHT.colors.canvas, DEFAULT_LIGHT.colors.raised, 0.5))
  })

  it('mixes colors between their ends', () => {
    expect(mixColors('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mixColors('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080')
  })
})
