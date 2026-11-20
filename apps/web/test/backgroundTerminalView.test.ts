import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TerminalView } from '../src/views/TerminalView'

const control = vi.hoisted(() => ({
  viewer: false,
  status: 'connected',
  refs: [] as { current: unknown }[],
  cursor: 0,
  recovery: undefined as (() => unknown) | undefined,
  effects: [] as (() => unknown)[],
  cleanups: [] as (() => void)[],
  input: (_data: string) => {},
  data: (_chunk: { id: string; data: string; cursor: number }) => {},
  exit: (_code: number) => {},
  errors: [] as unknown[],
  writes: [] as string[],
  options: {} as { disableStdin?: boolean },
  invoke: vi.fn(),
  onExit: vi.fn(),
}))
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useRef: (current: unknown) => (control.refs[control.cursor++] ??= { current }),
  useState: (value: unknown) => [value, (next: unknown) => control.errors.push(next)],
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    control.effects.push(effect)
    if (deps.length === 2 && typeof deps[0] === 'boolean' && !control.recovery) control.recovery = effect
  },
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
    onSelectionChange() {
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
vi.mock('../src/composer/useHostWriteAccess', () => ({
  useHostWriteAccess: () => ({
    viewOnly: control.viewer,
    canWrite: () => !control.viewer && control.status === 'connected',
  }),
}))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { terminalFontSize: 13 } }) }))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ invoke: control.invoke, status: control.status }),
}))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({ workspaceOf: () => 'task' }),
  useHostRuntime: () => ({
    on: () => () => {},
    terminals: {
      allShells: () => [],
      beginOpening: () => () => {},
      forgetTerminal() {},
      shellOf() {},
      takeAdopted() {},
      trackTerminal() {},
      onData: (_id: string, callback: typeof control.data) => {
        control.data = callback
        return () => {}
      },
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
  control.viewer = false
  control.status = 'connected'
  control.refs = []
  control.cursor = 0
  control.recovery = undefined
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
function RenderTerminal() {
  control.cursor = 0
  TerminalView({
    taskId: 'task',
    repoId: null,
    label: 'Background command',
    active: false,
    viewId: 'view',
    backgroundId: 'command',
    onExit: control.onExit,
  })
}
async function mount() {
  RenderTerminal()
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

it('advances the replay cursor across live output and marks a stream gap instead of duplicating it', async () => {
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'ab', cursor: 2, exited: false }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: false, background: true }]
    return undefined
  })
  await mount()
  control.data({ id: 'command', data: 'cd', cursor: 4 })
  control.data({ id: 'command', data: 'cd', cursor: 4 })
  control.data({ id: 'command', data: 'gh', cursor: 8 })
  expect(control.writes.filter((chunk) => chunk === 'cd')).toHaveLength(1)
  expect(control.writes.some((chunk) => chunk.includes('Older output was truncated'))).toBe(true)
  expect(control.writes.at(-1)).toBe('gh')
})

it('refuses retained terminal input after viewer access replaces full access', async () => {
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'running', cursor: 7, exited: false }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: false, background: true }]
  })
  await mount()
  control.invoke.mockClear()
  control.viewer = true
  control.input('must-not-run\r')
  expect(control.invoke).not.toHaveBeenCalled()
})
it('does not read or attach a terminal when mounted as a viewer', async () => {
  control.viewer = true
  await mount()
  expect(control.invoke).not.toHaveBeenCalled()
})

it('attaches an initially restricted tab after full access returns', async () => {
  control.viewer = true
  await mount()
  expect(control.invoke).not.toHaveBeenCalled()
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'recovered', cursor: 9, exited: false }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: false, background: true }]
  })
  control.viewer = false
  control.recovery = undefined
  RenderTerminal()
  ;(control.recovery as (() => unknown) | undefined)?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(control.writes.join('')).toContain('recovered')
  expect(control.invoke.mock.calls.some(([method]) => method === 'term.open')).toBe(false)
})

it('waits for a disconnected host before attaching a restored terminal tab', async () => {
  control.status = 'disconnected'
  await mount()
  expect(control.invoke).not.toHaveBeenCalled()
  control.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.snapshot') return { output: 'after reconnect', cursor: 15, exited: false }
    if (method === 'term.list')
      return [{ id: 'command', taskId: 'task', repoId: null, cwd: '/checkout', exited: false, background: true }]
  })
  control.status = 'connected'
  control.recovery = undefined
  RenderTerminal()
  ;(control.recovery as (() => unknown) | undefined)?.()
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(control.writes.join('')).toContain('after reconnect')
})
