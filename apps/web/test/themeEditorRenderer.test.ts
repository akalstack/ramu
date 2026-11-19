import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
const h = vi.hoisted(() => ({
  callbacks: new Map<string, (event: unknown) => void>(),
  define: vi.fn(),
  send: vi.fn(),
  setTheme: vi.fn(),
  code: { dispose: vi.fn(), saveViewState: vi.fn(() => ({ cursor: 3 })), restoreViewState: vi.fn() },
  diff: {
    dispose: vi.fn(),
    saveViewState: vi.fn(() => ({ scroll: 4 })),
    restoreViewState: vi.fn(),
    setModel: vi.fn(),
    updateOptions: vi.fn(),
  },
  create: vi.fn(),
  createDiff: vi.fn(),
  createModel: vi.fn(),
  models: [] as { dispose: ReturnType<typeof vi.fn> }[],
}))
vi.mock('../src/editor/monacoCore', () => ({
  monaco: {
    editor: {
      createModel: h.createModel,
      create: h.create,
      createDiffEditor: h.createDiff,
      setTheme: h.setTheme,
    },
  },
}))
vi.mock('../src/editor/shiki', () => ({ loadShikiLanguage: async () => {}, defineEditorTheme: h.define }))
const parentFrame = { postMessage: h.send }
async function boot() {
  await import('../src/theme/editorRenderer')
}
function update(request: number, view: 'code' | 'diff' = 'code', split = false, source: unknown = parentFrame) {
  h.callbacks.get('message')!({
    source,
    data: {
      ramuThemePreview: 1,
      type: 'update',
      instance: 'one',
      request,
      appearance: 'light',
      variant: DEFAULT_THEME.light,
      view,
      split,
    },
  })
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.clearAllMocks()
  h.callbacks.clear()
  h.models = []
  h.define.mockReset().mockResolvedValue(undefined)
  h.create.mockReturnValue(h.code)
  h.createDiff.mockReturnValue(h.diff)
  h.createModel.mockImplementation(() => {
    const model = { dispose: vi.fn() }
    h.models.push(model)
    return model
  })
  vi.stubGlobal('parent', parentFrame)
  vi.stubGlobal('location', { hash: '#one' })
  vi.stubGlobal('document', {
    getElementById: () => ({ replaceChildren() {} }),
    documentElement: { style: {} },
    body: { style: {} },
  })
  vi.stubGlobal('window', {
    addEventListener: (name: string, callback: (event: unknown) => void) => h.callbacks.set(name, callback),
  })
})
afterEach(() => {
  h.callbacks.get('pagehide')?.({})
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
it('rejects foreign senders and lets only the latest asynchronous palette update select the editor theme', async () => {
  let first!: () => void, second!: () => void
  h.define
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          first = resolve
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          second = resolve
        }),
    )
  await boot()
  update(1, 'code', false, {})
  await vi.advanceTimersByTimeAsync(150)
  expect(h.define).not.toHaveBeenCalled()
  update(1)
  await vi.advanceTimersByTimeAsync(150)
  update(2)
  await vi.advanceTimersByTimeAsync(150)
  second()
  await flush()
  first()
  await flush()
  expect(h.setTheme.mock.calls).toEqual([['ramu-preview-2']])
  expect(h.send.mock.calls.filter(([m]) => m.type === 'applied').map(([m]) => m.request)).toEqual([2])
  expect(h.create).toHaveBeenCalledOnce()
})
it('preserves selection models across palette changes and restores code/diff view state when switching', async () => {
  await boot()
  update(1)
  await vi.advanceTimersByTimeAsync(150)
  update(2)
  await vi.advanceTimersByTimeAsync(150)
  expect(h.create).toHaveBeenCalledOnce()
  expect(h.code.dispose).not.toHaveBeenCalled()
  update(3, 'diff')
  await vi.advanceTimersByTimeAsync(150)
  expect(h.code.dispose).toHaveBeenCalledOnce()
  expect(h.createDiff).toHaveBeenCalledOnce()
  expect(h.diff.setModel).toHaveBeenCalledWith({ original: h.models[0], modified: h.models[1] })
  update(4, 'diff', true)
  await vi.advanceTimersByTimeAsync(150)
  expect(h.diff.updateOptions).toHaveBeenCalledWith({ renderSideBySide: true })
  expect(h.createDiff).toHaveBeenCalledOnce()
  update(5)
  await vi.advanceTimersByTimeAsync(150)
  expect(h.code.restoreViewState).toHaveBeenCalledWith({ cursor: 3 })
  expect(h.createModel).toHaveBeenCalledTimes(2)
})
it('disposes local models and refuses a pending result after the preview closes', async () => {
  let finish!: () => void
  h.define.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  await boot()
  update(1)
  await vi.advanceTimersByTimeAsync(150)
  h.callbacks.get('pagehide')!({})
  finish()
  await flush()
  expect(h.create).not.toHaveBeenCalled()
  expect(h.models.every((model) => model.dispose.mock.calls.length === 1)).toBe(true)
  h.callbacks.delete('pagehide')
})
