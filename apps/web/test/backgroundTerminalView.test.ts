import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/views/TerminalView'

const control = vi.hoisted(() => ({
  effects: [] as (() => unknown)[],
  cleanups: [] as (() => void)[],
  input: (_data: string) => {},
  exit: (_code: number) => {},
  errors: [] as unknown[],
  writes: [] as string[],
  options: {} as { disableStdin?: boolean },
  invoke: vi.fn(),
  onExit: vi.fn(),
}))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (current: unknown) => ({ current }),
  useState: (value: unknown) => [value, (next: unknown) => control.errors.push(next)],
  useEffect: (effect: () => unknown) => control.effects.push(effect),
}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    options = control.options
    cols = 80
    rows = 24
    open() {}
    loadAddon() {}
    dispose() {}
    focus() {}
    write(value: string) {
      control.writes.push(value)
    }
    onData(callback: (data: string) => void) {
      control.input = callback
      return { dispose() {} }
    }
    onResize() {
      return { dispose() {} }
    }
    onKey() {
      return { dispose() {} }
    }
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  },
}))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    dispose() {}
  },
}))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { terminalFontSize: 13 } }) }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: control.invoke }) }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({ workspaceOf: () => 'task' }),
  useHostRuntime: () => ({
    terminals: {
      allShells: () => [],
      beginOpening: () => () => {},
      forgetTerminal() {},
      shellOf() {},
      takeAdopted() {},
      trackTerminal() {},
      onData: () => () => {},
      onExit: (_id: string, callback: (code: number) => void) => {
        control.exit = callback
        return () => {}
      },
    },
  }),
}))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: (error: unknown) => String(error) }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/theme/themes', () => ({
  isCustomTheme: () => false,
  effectiveTheme: () => ({}),
  useEffectiveTheme: () => ({}),
}))
vi.mock('../src/appearance', () => ({ resolvedAppearance: () => 'dark', useResolvedAppearance: () => 'dark' }))
const observer = class {
  observe() {}
  disconnect() {}
}
beforeEach(() => {
  control.effects = []
  control.cleanups = []
  control.errors = []
  control.writes = []
  control.options = {}
  control.invoke.mockReset()
  control.onExit.mockReset()
  vi.stubGlobal('document', { querySelector: () => null, documentElement: {} })
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('MutationObserver', observer)
  vi.stubGlobal('ResizeObserver', observer)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})
afterEach(() => {
  for (const cleanup of control.cleanups.reverse()) cleanup()
  vi.unstubAllGlobals()
})
async function mount() {
  TerminalView({
    taskId: 'task',
    repoId: null,
    label: 'Background command',
    active: false,
    viewId: 'view',
    backgroundId: 'command',
    onExit: control.onExit,
  })
  for (const effect of control.effects) {
    const cleanup = effect()
    if (typeof cleanup === 'function') control.cleanups.push(cleanup as () => void)
  }
  // Flush the actual asynchronous attachment chain without mounting an unrelated shell.
  await new Promise((resolve) => setTimeout(resolve, 0))
}

it('reattaches exact saved output read-only without launching a shell or forwarding keystrokes', async () => {
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'saved-tail', cursor: 500, exited: true }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: true, background: true }]
    throw new Error(`Unexpected ${method}`)
  })
  await mount()
  expect(control.writes.join('')).toContain('saved-tail')
  expect(control.writes.join('')).toContain('Older output was truncated')
  expect(control.writes.join('')).toContain('no live terminal is attached')
  expect(control.options.disableStdin).toBe(true)
  control.input('must-not-run\r')
  expect(control.invoke.mock.calls.some(([method]) => method === 'term.write' || method === 'term.open')).toBe(false)
})

it('does not replace a missing background command with a shell, including another thread’s ID', async () => {
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'do not show', cursor: 11, exited: true }
    if (method === 'term.list') return []
    throw new Error(`Unexpected ${method}`)
  })
  await mount()
  expect(control.errors.some((error) => String(error).includes('No shell was started'))).toBe(true)
  expect(control.writes.join('')).not.toContain('do not show')
  expect(control.invoke.mock.calls.some(([method]) => method === 'term.open')).toBe(false)
})

it('keeps a background command’s final output visible when its live process exits', async () => {
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'running', cursor: 7, exited: false }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: false, background: true }]
    return undefined
  })
  await mount()
  control.exit(0)
  expect(control.options.disableStdin).toBe(true)
  expect(control.onExit).not.toHaveBeenCalled()
  expect(control.writes.join('')).toContain('Exit code')
})
