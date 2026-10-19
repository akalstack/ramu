import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_DARK,
  DEFAULT_LIGHT,
  DEFAULT_THEME,
  THEME_FILE_MAX_BYTES,
  canonicalTheme,
  exportThemeFile,
  importThemeFile,
  checkTheme,
  contrastRatio,
  parseTheme,
  themeCssVariables,
  themeDigest,
} from '../src/theme'

describe('theme', () => {
  it('ships a readable default in both appearances', () => {
    expect(checkTheme(DEFAULT_THEME)).toEqual([])
  })

  it('flags status colors that look alike', () => {
    const colors = { ...DEFAULT_DARK.colors, bad: '#30d160' }
    const issues = checkTheme({ ...DEFAULT_THEME, dark: { ...DEFAULT_DARK, colors } })
    expect(issues.map((issue) => issue.message).join(' ')).toContain('ok and bad look too alike')
  })

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrastRatio('#777777', '#777777')).toBe(1)
  })

  it('reports an unreadable pair with its role', () => {
    const theme = { ...DEFAULT_THEME, dark: { ...DEFAULT_DARK, colors: { ...DEFAULT_DARK.colors, text: '#25252a' } } }
    expect(checkTheme(theme).map((i) => `${i.variant}:${i.role}`)).toContain('dark:text')
  })

  it('round-trips through parse and keeps the same digest', async () => {
    const parsed = parseTheme(JSON.parse(JSON.stringify(DEFAULT_THEME)))
    expect(parsed.ok && (await themeDigest(parsed.theme))).toBe(await themeDigest(DEFAULT_THEME))
  })

  it('digests by content, not key order', async () => {
    const shuffled = {
      ...DEFAULT_THEME,
      light: { colors: { ...DEFAULT_LIGHT.colors }, overlay: DEFAULT_LIGHT.overlay },
    }
    expect(canonicalTheme(shuffled)).toBe(canonicalTheme(DEFAULT_THEME))
  })

  it('rejects malformed or unsupported themes and ignores unknown fields', () => {
    expect(parseTheme(null).ok).toBe(false)
    expect(parseTheme({ ...DEFAULT_THEME, schema: 2 }).ok).toBe(false)
    expect(parseTheme({ ...DEFAULT_THEME, id: 'Bad Id' }).ok).toBe(false)
    expect(
      parseTheme({ ...DEFAULT_THEME, light: { ...DEFAULT_LIGHT, colors: { ...DEFAULT_LIGHT.colors, text: 'red' } } })
        .ok,
    ).toBe(false)
    expect(parseTheme({ ...DEFAULT_THEME, dark: undefined }).ok).toBe(false)
    const withExtra = parseTheme({ ...DEFAULT_THEME, css: 'body{display:none}', script: 'x' })
    expect(withExtra.ok && Object.keys(withExtra.theme)).toEqual(['schema', 'id', 'name', 'light', 'dark'])
  })

  it('stays in step with the stylesheet defaults', () => {
    const css = readFileSync(new URL('../../../apps/web/src/styles.css', import.meta.url), 'utf8')
    const block = (selector: string) => css.slice(css.indexOf(selector), css.indexOf('\n}', css.indexOf(selector)))
    const declared = (source: string, name: string) => new RegExp(`${name}: (#[0-9a-f]{6});`).exec(source)?.[1]
    for (const [variant, source] of [
      [DEFAULT_DARK, block('\n:root {')],
      [DEFAULT_LIGHT, block(":root[data-appearance='light'] {")],
    ] as const) {
      const vars = themeCssVariables(variant)
      for (const name of [
        '--window',
        '--canvas',
        '--bubble',
        '--text',
        '--text-body',
        '--soft',
        '--muted',
        '--placeholder',
        '--ok',
        '--warn',
        '--bad',
      ]) {
        expect(declared(source, name), name).toBe(vars[name])
      }
    }
  })
})

describe('theme files', () => {
  it('exports readable JSON that imports to the same theme', async () => {
    const text = await exportThemeFile(DEFAULT_THEME)
    expect(text).toContain('\n')
    const imported = await importThemeFile(text)
    expect(imported.ok && imported.theme).toEqual(DEFAULT_THEME)
    expect(imported.ok && imported.edited).toBe(false)
    expect(imported.ok && imported.issues).toEqual([])
  })

  it('flags a file whose colors changed after export, without altering them', async () => {
    const file = JSON.parse(await exportThemeFile(DEFAULT_THEME))
    file.dark.colors.accent = '#112233'
    const imported = await importThemeFile(JSON.stringify(file))
    expect(imported.ok && imported.edited).toBe(true)
    expect(imported.ok && imported.theme.dark.colors.accent).toBe('#112233')
  })

  it('reports unreadable imports but still returns them for editing', async () => {
    const file = JSON.parse(await exportThemeFile(DEFAULT_THEME))
    file.light.colors.text = '#fafafa'
    const imported = await importThemeFile(JSON.stringify(file))
    expect(imported.ok && imported.issues.length).toBeGreaterThan(0)
  })

  it('refuses oversized, malformed and unsupported files', async () => {
    expect((await importThemeFile('x'.repeat(THEME_FILE_MAX_BYTES + 1))).ok).toBe(false)
    expect((await importThemeFile('{nope')).ok).toBe(false)
    expect((await importThemeFile(JSON.stringify({ ...DEFAULT_THEME, schema: 9 }))).ok).toBe(false)
  })
})
