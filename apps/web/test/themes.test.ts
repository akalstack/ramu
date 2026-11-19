import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_THEME, type RamuTheme } from '@ramu/shared/theme'

const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  key: (index: number) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size
  },
})
const themes = await import('../src/theme/themes')

const custom = (patch: Partial<RamuTheme> = {}): RamuTheme => ({ ...DEFAULT_THEME, id: 'calm', name: 'Calm', ...patch })
const root = () => {
  const values = new Map<string, string>()
  return {
    values,
    style: {
      setProperty: (name: string, value: string) => void values.set(name, value),
      removeProperty: (name: string) => void values.delete(name),
    },
  } as unknown as HTMLElement & { values: Map<string, string> }
}

describe('theme library', () => {
  beforeEach(() => storage.clear())

  it('falls back to Ramu Default when nothing is selected or the selection is gone', () => {
    expect(themes.selectedTheme().id).toBe('ramu-default')
    themes.keepTheme(custom())
    themes.removeTheme('calm')
    expect(themes.selectedTheme().id).toBe('ramu-default')
  })

  it('keeps and selects a readable theme', () => {
    expect(themes.keepTheme(custom())).toEqual([])
    expect(themes.selectedTheme().id).toBe('calm')
    expect(themes.themeLibrary().map((theme) => theme.id)).toEqual(['calm'])
  })

  it('refuses an unreadable theme and leaves the selection alone', () => {
    const dark = { ...DEFAULT_THEME.dark, colors: { ...DEFAULT_THEME.dark.colors, text: '#25252a' } }
    expect(themes.keepTheme(custom({ dark })).length).toBeGreaterThan(0)
    expect(themes.themeLibrary()).toEqual([])
    expect(themes.selectedTheme().id).toBe('ramu-default')
  })

  it('shows a trial without saving it, and drops it on revert', () => {
    themes.startTrial(custom())
    expect(themes.effectiveTheme().id).toBe('calm')
    expect(themes.themeLibrary()).toEqual([])
    themes.endTrial()
    expect(themes.effectiveTheme().id).toBe('ramu-default')
  })

  it('selects a built-in theme without copying it into the library', () => {
    const [first] = themes.builtInThemes()
    themes.selectTheme(first!.id)
    expect(themes.selectedTheme().id).toBe(first!.id)
    expect(themes.themeLibrary()).toEqual([])
    expect(themes.isBuiltInTheme(first!.id)).toBe(true)
    themes.selectTheme(null)
    expect(themes.selectedTheme().id).toBe('ramu-default')
  })

  it('does not select an id nobody has', () => {
    themes.selectTheme('missing')
    expect(themes.selectedTheme().id).toBe('ramu-default')
  })

  it('renames a kept theme and nothing else', () => {
    themes.keepTheme(custom())
    expect(themes.renameTheme('calm', '  Quiet  ')).toBe(true)
    expect(themes.themeLibrary()[0]).toMatchObject({ id: 'calm', name: 'Quiet' })
    expect(themes.renameTheme('calm', '   ')).toBe(false)
    expect(themes.renameTheme(themes.builtInThemes()[0]!.id, 'Mine')).toBe(false)
  })

  it('makes a copy with its own id and the name it was given', () => {
    const copy = themes.copyOfTheme(custom(), 'Calm copy')
    expect(copy.id).not.toBe('calm')
    expect(copy.name).toBe('Calm copy')
    expect(themes.copyOfTheme(copy, 'Again').id.match(/-copy-/g)).toHaveLength(1)
  })

  it('ignores corrupt stored themes', () => {
    storage.set('theme.library', JSON.stringify([{ id: 'x' }, custom()]))
    expect(themes.themeLibrary().map((theme) => theme.id)).toEqual(['calm'])
    storage.set('theme.library', 'not json')
    expect(themes.themeLibrary()).toEqual([])
  })

  it('writes a custom theme onto the root and clears it for the default', () => {
    const target = root()
    themes.applyTheme(target, custom(), 'light')
    expect(target.values.get('--canvas')).toBe(DEFAULT_THEME.light.colors.canvas)
    expect(target.values.get('--ink')).toBe('0 0 0')
    themes.applyTheme(target, DEFAULT_THEME, 'light')
    expect(target.values.size).toBe(0)
  })
})

describe('trying before saving', () => {
  beforeEach(() => storage.clear())

  it('keeps a new theme in the library and selects it after a reload of the stored text', () => {
    themes.keepTheme(custom({ id: 'my-theme-abc', name: 'My theme' }))
    expect(themes.themeLibrary().map((theme) => theme.id)).toEqual(['my-theme-abc'])
    expect(themes.selectedTheme().id).toBe('my-theme-abc')
  })

  it('shows a trial without storing it and returns to the saved theme when it ends', () => {
    themes.keepTheme(custom({ id: 'saved-theme' }))
    themes.startTrial(themes.builtInThemes()[0]!)
    expect(themes.effectiveTheme().id).toBe(themes.builtInThemes()[0]!.id)
    expect(themes.selectedTheme().id).toBe('saved-theme')
    themes.endTrial()
    expect(themes.effectiveTheme().id).toBe('saved-theme')
  })

  it('previews light or dark without storing it', async () => {
    const { previewAppearance, resolvedAppearance, storedAppearance } = await import('../src/appearance')
    const heard = vi.fn()
    const { subscribeAppearance } = await import('../src/appearance')
    const off = subscribeAppearance(heard)
    previewAppearance('light')
    expect(resolvedAppearance()).toBe('light')
    expect(storedAppearance()).toBe('dark')
    expect(heard).toHaveBeenCalledOnce()
    previewAppearance(null)
    expect(resolvedAppearance()).toBe('dark')
    off()
  })
})
