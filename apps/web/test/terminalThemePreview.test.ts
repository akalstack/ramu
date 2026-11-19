import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  near: true,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  created: 0,
  disposed: 0,
  output: '',
  options: {} as { theme?: { background?: string; foreground?: string }; disableStdin?: boolean },
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (initial: unknown) => (h.slots[h.cursor++] ??= { current: initial }),
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++,
      previous = h.effects[index]
    if (previous && deps.every((dep, i) => dep === previous.deps[i])) return
    h.pending.push(() => {
      previous?.cleanup?.()
      h.effects[index] = { deps, cleanup: run() || undefined }
    })
  },
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options: typeof h.options
    constructor(options: typeof h.options) {
      h.created++
      this.options = options
      h.options = options
    }
    open() {}
    loadAddon() {}
    write(value: string) {
      h.output += value
    }
    dispose() {
      h.disposed++
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('../src/lib/useNearViewport', () => ({ useNearViewport: () => h.near }))
vi.mock('../src/i18n', () => ({ t: (value: string) => value }))
import { TerminalThemePreview } from '../src/theme/TerminalThemePreview'
import { terminalTheme, terminalThemeForVariant } from '../src/theme/terminalTheme'
function RenderTerminal(variant = DEFAULT_THEME.dark, appearance: 'dark' | 'light' = 'dark') {
  h.cursor = 0
  const tree = TerminalThemePreview({ variant, appearance })
  tree.props.ref.current = {}
  while (h.pending.length) h.pending.shift()!()
  return tree
}
beforeEach(() => {
  h.slots = []
  h.effects = []
  h.pending = []
  h.created = h.disposed = 0
  h.near = true
  h.output = ''
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => {
  for (const effect of h.effects) effect?.cleanup?.()
  vi.unstubAllGlobals()
})
it('renders ANSI output with real xterm and updates only its palette without opening a shell', () => {
  RenderTerminal()
  expect(h.options.disableStdin).toBe(true)
  expect(h.output).toContain('\x1b[32mPASS')
  const variant = {
    ...DEFAULT_THEME.light,
    colors: { ...DEFAULT_THEME.light.colors, codeBackground: '#123456', textBody: '#abcdef' },
  }
  RenderTerminal(variant, 'light')
  expect(h.created).toBe(1)
  expect(h.disposed).toBe(0)
  expect(h.options.theme?.background).toBe('#123456')
  expect(h.options.theme?.foreground).toBe('#abcdef')
  h.near = false
  RenderTerminal(variant, 'light')
  expect(h.disposed).toBe(1)
})
it('shares the production custom-theme mapping and keeps default terminal colors unchanged', () => {
  const custom = { ...DEFAULT_THEME, id: 'custom' }
  for (const appearance of ['light', 'dark'] as const)
    expect(terminalThemeForVariant(custom[appearance], appearance)).toEqual(terminalTheme(appearance, custom))
  expect(terminalTheme('dark', DEFAULT_THEME).background).toBe('#141416')
  expect(terminalTheme('light', DEFAULT_THEME).background).toBe('#f4f4f6')
})
