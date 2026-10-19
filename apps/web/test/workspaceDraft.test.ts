import { expect, it } from 'vitest'
import { hostStore } from '../src/hostStorage'
import { clearWorkspaceDraft, loadWorkspaceDraft, saveWorkspaceDraft } from '../src/composer/workspaceDraft'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
    removeItem: (key: string) => {
      data.delete(key)
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}

it('restores unresolved defaults, explicit modes and exact reused workspace identities independently of text drafts', () => {
  const store = memory()
  store.setItem('ramu.draft.new:p', 'Existing text and context')
  for (const choice of [
    { mode: null },
    { mode: 'current' },
    { mode: 'worktree' },
    { mode: 'worktree', workspaceId: 'removed-workspace', name: 'Login' },
  ] as const) {
    expect(saveWorkspaceDraft('p', choice, store)).toBe(true)
    expect(loadWorkspaceDraft('p', store)).toEqual({ choice: { workspaceId: undefined, name: undefined, ...choice } })
  }
  expect(store.getItem('ramu.draft.new:p')).toBe('Existing text and context')
  expect(clearWorkspaceDraft('p', store)).toBe(true)
  expect(loadWorkspaceDraft('p', store)).toEqual({ choice: { mode: null } })
  expect(store.getItem('ramu.draft.new:p')).toBe('Existing text and context')
})

it('isolates colliding project/workspace IDs by host and keeps other projects intact', () => {
  const base = memory(),
    a = hostStore(base, 'a'),
    b = hostStore(base, 'b')
  saveWorkspaceDraft('p', { mode: 'current' }, a)
  saveWorkspaceDraft('p', { mode: 'worktree', workspaceId: 'w' }, b)
  saveWorkspaceDraft('q', { mode: 'worktree' }, a)
  expect(loadWorkspaceDraft('p', a).choice.mode).toBe('current')
  expect(loadWorkspaceDraft('p', b).choice.workspaceId).toBe('w')
  clearWorkspaceDraft('p', a)
  expect(loadWorkspaceDraft('q', a).choice.mode).toBe('worktree')
  expect(loadWorkspaceDraft('p', b).choice.workspaceId).toBe('w')
})

it('preserves unknown/corrupt records for recovery and expires automatic metadata without erasing message content', () => {
  const store = memory()
  for (const raw of [
    '{',
    '{"version":2,"mode":"current","at":1}',
    '{"version":1,"mode":"current","workspaceId":"wrong","at":1}',
    'x'.repeat(64 * 1024 + 1),
  ]) {
    store.setItem('ramu.new-thread-workspace:p', raw)
    expect(loadWorkspaceDraft('p', store).problem).toBeTruthy()
    expect(store.getItem('ramu.new-thread-workspace:p')).toBe(raw)
  }
  saveWorkspaceDraft('p', { mode: 'worktree' }, store, 1)
  expect(loadWorkspaceDraft('p', store, 32 * 86_400_000)).toEqual({ choice: { mode: null } })
})

it('reports storage denial and failed writes while retaining the last committed choice', () => {
  const store = memory()
  saveWorkspaceDraft('p', { mode: 'current' }, store)
  const denied = {
    ...store,
    setItem: () => {
      throw new Error('Quota')
    },
    removeItem: () => {
      throw new Error('Denied')
    },
  }
  expect(saveWorkspaceDraft('p', { mode: 'worktree' }, denied)).toBe(false)
  expect(clearWorkspaceDraft('p', denied)).toBe(false)
  expect(loadWorkspaceDraft('p', store).choice.mode).toBe('current')
  expect(loadWorkspaceDraft('p', null).problem).toBe('storage')
  expect(
    loadWorkspaceDraft('p', {
      ...store,
      getItem: () => {
        throw new Error('Denied')
      },
    }).problem,
  ).toBe('storage')
})

it('a late send acknowledgement consumes only its unchanged workspace choice', () => {
  const store = memory()
  const sent = { mode: 'worktree', workspaceId: 'original' } as const
  saveWorkspaceDraft('p', sent, store)
  saveWorkspaceDraft('p', { mode: 'current' }, store)
  expect(clearWorkspaceDraft('p', store, sent)).toBe(false)
  expect(loadWorkspaceDraft('p', store).choice.mode).toBe('current')
  expect(clearWorkspaceDraft('p', store, { mode: 'current' })).toBe(true)
  expect(loadWorkspaceDraft('p', store).choice).toEqual({ mode: null })
})

it('restores complete naming intent beyond the old small metadata limit and guards late cleanup after branch edits', () => {
  const store = memory()
  const branch = {
    title: 'Fix login',
    intent: { strategy: 'custom' as const, instructions: 'Use team/', prompt: '\u0000'.repeat(6000) },
    choice: { name: 'team/unfinished/', source: 'manual' as const },
  }
  const choice = { mode: 'worktree' as const, branch }
  expect(saveWorkspaceDraft('p', choice, store)).toBe(true)
  expect(loadWorkspaceDraft('p', store).choice.branch).toEqual(branch)
  const newer = { ...choice, branch: { ...branch, choice: { ...branch.choice, name: 'team/reviewed' } } }
  expect(saveWorkspaceDraft('p', newer, store)).toBe(true)
  expect(clearWorkspaceDraft('p', store, choice)).toBe(false)
  expect(loadWorkspaceDraft('p', store).choice.branch?.choice.name).toBe('team/reviewed')
  expect(clearWorkspaceDraft('p', store, newer)).toBe(true)
  const raw = JSON.stringify({
    version: 1,
    mode: 'worktree',
    at: Date.now(),
    branch: { ...branch, intent: { ...branch.intent, prompt: 'x'.repeat(6001) } },
  })
  store.setItem('ramu.new-thread-workspace:p', raw)
  expect(loadWorkspaceDraft('p', store).problem).toBe('invalid')
  expect(store.getItem('ramu.new-thread-workspace:p')).toBe(raw)
})
