import { beforeEach, expect, it, vi } from 'vitest'
import { resolveCheckoutMode } from '@ramu/shared/workspaceDefaults'

const harness = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  callbacks: [] as { callback: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  valueIndex: 0,
  refIndex: 0,
  callbackIndex: 0,
  effectIndex: 0,
  data: new Map<string, string>(),
  readDenied: false,
  writeDenied: false,
}))
vi.mock('react', () => ({
  useRef(initial: unknown) {
    const index = harness.refIndex++
    return (harness.refs[index] ??= { current: initial })
  },
  useState(initial: unknown) {
    const index = harness.valueIndex++
    if (!(index in harness.values)) harness.values[index] = typeof initial === 'function' ? initial() : initial
    return [
      harness.values[index],
      (next: unknown) => {
        harness.values[index] = next
      },
    ]
  },
  useCallback(callback: unknown, deps: unknown[]) {
    const index = harness.callbackIndex++,
      old = harness.callbacks[index]
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) harness.callbacks[index] = { callback, deps }
    return harness.callbacks[index]!.callback
  },
  useEffect(run: () => void | (() => void), deps: unknown[]) {
    const index = harness.effectIndex++,
      old = harness.effects[index]
    if (!old || deps.some((value, i) => !Object.is(value, old.deps[i]))) {
      harness.pending.push(() => {
        old?.cleanup?.()
        const cleanup = run()
        harness.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
      })
    }
  },
}))
vi.mock('../src/composer/drafts', () => ({
  draftStore: (host: string) => ({
    getItem: (key: string) => {
      if (harness.readDenied) throw new Error('Denied')
      return harness.data.get(`${host}:${key}`) ?? null
    },
    setItem: (key: string, value: string) => {
      if (harness.writeDenied) throw new Error('Quota')
      harness.data.set(`${host}:${key}`, value)
    },
  }),
}))
import { useWorkspaceDraft } from '../src/composer/useWorkspaceDraft'

function RenderDraft(host = 'a', project = 'p', explicit: string | null = null) {
  harness.valueIndex = harness.refIndex = harness.callbackIndex = harness.effectIndex = 0
  const result = useWorkspaceDraft(host, project, explicit)
  while (harness.pending.length) harness.pending.shift()!()
  return result
}
function remount() {
  harness.values = []
  harness.refs = []
  harness.callbacks = []
  harness.effects = []
  harness.pending = []
}
beforeEach(() => {
  remount()
  harness.data.clear()
  harness.readDenied = harness.writeDenied = false
})

it('retains manual/default provenance after reopening and follows changed defaults only after Use default', () => {
  let draft = RenderDraft()
  draft.choose({ mode: 'current' })
  remount()
  draft = RenderDraft()
  expect(resolveCheckoutMode({ defaultMode: 'worktree', manual: draft.choice.mode })).toMatchObject({
    mode: 'current',
    source: 'manual',
  })
  draft.choose({ mode: null })
  remount()
  draft = RenderDraft()
  expect(resolveCheckoutMode({ defaultMode: 'worktree', manual: draft.choice.mode })).toMatchObject({
    mode: 'worktree',
    source: 'default',
  })
})

it('restores an exact reused workspace, honors explicit scoped entries and isolates colliding host/project IDs', () => {
  RenderDraft().choose({ mode: 'worktree', workspaceId: 'w', name: 'Login' })
  remount()
  expect(RenderDraft().choice.workspaceId).toBe('w')
  expect(RenderDraft('b').choice).toEqual({ mode: null })
  RenderDraft('b').choose({ mode: 'current' })
  expect(RenderDraft('a', 'other').choice).toEqual({ mode: null })
  expect(RenderDraft('a', 'p', 'scoped-workspace').choice.workspaceId).toBe('scoped-workspace')
  remount()
  expect(RenderDraft().choice.workspaceId).toBe('scoped-workspace')
})

it('keeps an explicit choice in memory when persistence fails and retries the same choice without clearing work', () => {
  let draft = RenderDraft()
  harness.writeDenied = true
  draft.choose({ mode: 'worktree', workspaceId: 'w' })
  draft = RenderDraft()
  expect(draft).toMatchObject({ confirmed: true, problem: 'storage', choice: { workspaceId: 'w' } })
  harness.writeDenied = false
  draft.retry()
  remount()
  expect(RenderDraft()).toMatchObject({ confirmed: true, choice: { workspaceId: 'w' } })
  expect(RenderDraft().problem).toBeUndefined()
})

it('requires a fresh workspace choice after an unreadable or unsupported saved record', () => {
  harness.data.set('a:ramu.new-thread-workspace:p', '{"version":9,"mode":"current"}')
  let draft = RenderDraft()
  expect(draft.confirmed).toBe(false)
  expect(harness.data.get('a:ramu.new-thread-workspace:p')).toContain('"version":9')
  draft.choose({ mode: null })
  expect(RenderDraft().confirmed).toBe(true)
  remount()
  harness.readDenied = true
  draft = RenderDraft()
  expect(draft.confirmed).toBe(false)
  draft.choose({ mode: 'current' })
  expect(RenderDraft().confirmed).toBe(true)
})

it('ignores an old scope action without losing the new scope’s unsaved in-memory choice', () => {
  const previous = RenderDraft('a')
  RenderDraft('b')
  harness.writeDenied = true
  RenderDraft('b').choose({ mode: 'worktree', workspaceId: 'new-host-workspace' })
  previous.choose({ mode: 'current' })
  expect(RenderDraft('b').choice.workspaceId).toBe('new-host-workspace')
})

it('restores branch edits within their host/project and retries the complete naming snapshot after storage failure', () => {
  const branch = {
    title: 'Login',
    intent: { strategy: 'semantic' as const, instructions: '', prompt: 'Fix login' },
    choice: { name: 'mine/login', source: 'manual' as const },
  }
  RenderDraft().choose({ mode: 'worktree', branch })
  remount()
  expect(RenderDraft().choice.branch).toEqual(branch)
  expect(RenderDraft('b').choice.branch).toBeUndefined()
  expect(RenderDraft('a', 'other').choice.branch).toBeUndefined()
  expect(RenderDraft('a', 'p', 'existing').choice.branch).toBeUndefined()
  RenderDraft('a')
  harness.writeDenied = true
  RenderDraft().choose({ mode: null, branch })
  expect(RenderDraft()).toMatchObject({ problem: 'storage', choice: { branch } })
  harness.writeDenied = false
  RenderDraft().retry()
  remount()
  expect(RenderDraft().choice.branch).toEqual(branch)
})
