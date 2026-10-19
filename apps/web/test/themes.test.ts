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
