import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  viewer: false,
  target: null as any,
  removed: vi.fn(),
  refs: [] as any[],
  cursor: 0,
  cleanup: undefined as (() => void) | undefined,
  deps: [] as unknown[],
}))
vi.mock('react', () => ({
  useRef: (value: unknown) => (state.refs[state.cursor++] ??= { current: value }),
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    if (state.deps.length === deps.length && deps.every((dep, i) => dep === state.deps[i])) return
    state.cleanup?.()
    state.cleanup = run() || undefined
    state.deps = deps
  },
}))
vi.mock('../src/composer/useHostWriteAccess', () => {
  const canWrite = () => !state.viewer
  return { useHostWriteAccess: () => ({ viewOnly: state.viewer, canWrite }) }
})
vi.mock('../src/git/commitShortcut', () => ({
  registerCommitTarget: (target: unknown) => {
    state.target = target
    return state.removed
  },
}))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
import { useCommitShortcut } from '../src/sidebar/scm/useCommitShortcut'
beforeEach(() => {
  state.viewer = false
  state.refs = []
  state.cursor = 0
  state.cleanup = undefined
  state.deps = []
  state.removed.mockReset()
})
it('unregisters a viewer repository and refuses a previously captured commit shortcut', async () => {
  const commit = vi.fn(),
    reportError = vi.fn()
  const RenderShortcut = () => {
    state.cursor = 0
    return useCommitShortcut({
      taskId: 'task',
      repoId: 'repo',
      staged: 1,
      unstaged: [],
      publishable: true,
      commit,
      reportError,
    })
  }
  RenderShortcut()
  const retained = state.target
  state.viewer = true
  RenderShortcut()
  expect(state.removed).toHaveBeenCalledOnce()
  await retained.commitAndPush()
  expect(commit).not.toHaveBeenCalled()
  expect(reportError).not.toHaveBeenCalled()
})
