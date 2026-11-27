import { expect, it } from 'vitest'
import {
  branchForTitle,
  resolveCheckoutMode,
  checkoutBusyForDefault,
  checkoutBusyNote,
  validBranchPrefix,
  validBranchName,
  parseWorkspaceChoice,
  readWorkspaceChoice,
} from '../src/workspaceDefaults'

it('builds deterministic fixed names, including blank/nested prefixes and non-ASCII titles', () => {
  expect(branchForTitle('Fix login timeout')).toBe('ramu/fix-login-timeout')
  expect(branchForTitle('Fix login timeout', '')).toBe('fix-login-timeout')
  expect(branchForTitle('Fix login timeout', 'team/feature/')).toBe('team/feature/fix-login-timeout')
  expect(branchForTitle('你好')).toBe('ramu/task')
})
it('rejects unsafe or invalid namespaces without rewriting them', () => {
  for (const prefix of ['-option', '../x', 'foo//bar', 'foo.lock', 'foo\nbar', 'a@{b}', '/absolute', 'foo.'])
    expect(validBranchPrefix(prefix)).toBe(false)
  for (const name of ['HEAD', 'a..b', 'a/', 'foo/.hidden', 'foo.lock', '-unsafe'])
    expect(validBranchName(name)).toBe(false)
  expect(() => branchForTitle('test', '../bad')).toThrow()
})
it('preserves manual and reused intent while resolving ineligible defaults explicitly', () => {
  expect(resolveCheckoutMode({ defaultMode: 'worktree', manual: 'current' })).toMatchObject({
    mode: 'current',
    source: 'manual',
  })
  expect(resolveCheckoutMode({ defaultMode: 'current', manual: 'current', workspaceId: 'w' })).toMatchObject({
    mode: 'worktree',
    source: 'workspace',
  })
  expect(resolveCheckoutMode({ defaultMode: 'worktree', worktreeUnavailable: 'No commits' })).toEqual({
    mode: 'current',
    source: 'default',
    reason: 'No commits',
    blocked: false,
  })
  expect(
    resolveCheckoutMode({ defaultMode: 'current', manual: 'worktree', worktreeUnavailable: 'No commits' }).blocked,
  ).toBe(true)
  expect(resolveCheckoutMode({ defaultMode: 'worktree', projectFree: true }).mode).toBe('current')
})

it('keeps existing workspace selection independent of whether the current checkout can create new worktrees', () => {
  expect(
    resolveCheckoutMode({
      defaultMode: 'current',
      workspaceId: 'existing',
      worktreeUnavailable: 'Current checkout has no commits',
    }),
  ).toEqual({ mode: 'worktree', source: 'workspace', reason: null, blocked: false })
})

it('validates shared versioned workspace intent without resolving defaults or trusting display metadata', () => {
  expect(readWorkspaceChoice('{"version":1,"mode":null}').mode).toBeNull()
  expect(parseWorkspaceChoice({ version: 1, mode: 'worktree', workspaceId: 'w', name: { unsafe: true } })).toEqual({
    mode: 'worktree',
    workspaceId: 'w',
    name: undefined,
  })
  for (const value of [
    null,
    [],
    { version: 2, mode: 'current' },
    { version: 1, mode: 'current', workspaceId: 'w' },
    { version: 1, mode: 'worktree', workspaceId: ' ' },
    { version: 1, mode: 'worktree', workspaceId: 'x'.repeat(101) },
  ])
    expect(parseWorkspaceChoice(value)).toBeNull()
})

it('retains bounded manual branch edits but scopes generated names to their original request', async () => {
  const { currentBranchChoice, parseBranchNameDraft } = await import('../src/workspaceDefaults')
  const intent = { strategy: 'semantic' as const, instructions: '', prompt: 'Fix login' }
  const generated = { title: 'Login', intent, choice: { name: 'fix/login', source: 'generated' as const } }
  expect(currentBranchChoice(generated, 'Login', { ...intent })).toEqual(generated.choice)
  expect(currentBranchChoice(generated, 'Other', intent)).toBeUndefined()
  expect(currentBranchChoice(generated, 'Login', { ...intent, instructions: 'New policy' })).toBeUndefined()
  expect(currentBranchChoice(generated, 'Login', { ...intent, prompt: 'Another prompt' })).toBeUndefined()
  const manual = { ...generated, choice: { name: 'unfinished/', source: 'manual' as const } }
  expect(currentBranchChoice(manual, 'Other', intent)).toEqual(manual.choice)
  expect(parseBranchNameDraft(manual)).toEqual(manual)
  for (const value of [
    { ...generated, intent: { ...intent, prompt: 'x'.repeat(6001) } },
    { ...generated, choice: { name: 'bad..name', source: 'generated' } },
    { ...generated, choice: { name: 'a'.repeat(161), source: 'manual' } },
    { ...generated, intent: { ...intent, secret: 'never retain' } },
    { ...generated, choice: { ...generated.choice, secret: 'never retain' } },
  ])
    expect(parseBranchNameDraft(value)).toBeUndefined()
  expect(readWorkspaceChoice(JSON.stringify({ version: 1, mode: null, branch: manual })).branch).toEqual(manual)
})

it('counts running threads in the checkout only when the default puts a new thread beside them', () => {
  const threads = [
    { projectId: 'p', mode: 'current', status: 'running' },
    { projectId: 'p', mode: 'current', status: 'running' },
    { projectId: 'p', mode: 'current', status: 'idle' },
    { projectId: 'p', mode: 'worktree', status: 'running' },
    { projectId: 'other', mode: 'current', status: 'running' },
  ] as const
  const byDefault = resolveCheckoutMode({ defaultMode: 'current' })
  expect(checkoutBusyForDefault({ resolution: byDefault, projectId: 'p', threads })).toEqual({ working: 2, changed: 0 })
  // The person chose this checkout, or it cannot branch: nothing to suggest.
  const chosen = resolveCheckoutMode({ defaultMode: 'current', manual: 'current' })
  const none = { working: 0, changed: 0 }
  expect(checkoutBusyForDefault({ resolution: chosen, projectId: 'p', threads })).toEqual(none)
  expect(
    checkoutBusyForDefault({ resolution: byDefault, projectId: 'p', threads, worktreeUnavailable: 'No commits' }),
  ).toEqual(none)
  const worktree = resolveCheckoutMode({ defaultMode: 'worktree' })
  expect(checkoutBusyForDefault({ resolution: worktree, projectId: 'p', threads })).toEqual(none)
})

it('counts a finished thread that left uncommitted changes in the checkout, and says working first', () => {
  const threads = [
    { id: 'a', projectId: 'p', mode: 'current', status: 'ready-for-review' },
    { id: 'b', projectId: 'p', mode: 'current', status: 'idle' },
    { id: 'c', projectId: 'p', mode: 'current', status: 'archived' },
  ] as const
  const byDefault = resolveCheckoutMode({ defaultMode: 'current' })
  const busy = checkoutBusyForDefault({
    resolution: byDefault,
    projectId: 'p',
    threads,
    leftChanges: (thread) => thread.id !== 'b',
  })
  expect(busy).toEqual({ working: 0, changed: 1 })
  expect(checkoutBusyNote(busy)?.text).toBe('Another thread left uncommitted changes in this checkout.')
  expect(checkoutBusyNote({ working: 1, changed: 3 })?.text).toBe('Another thread is working in this checkout.')
  expect(checkoutBusyNote({ working: 0, changed: 2 })).toEqual({
    text: '{0} threads left uncommitted changes in this checkout.',
    values: { 0: 2 },
  })
  expect(checkoutBusyNote({ working: 0, changed: 0 })).toBeNull()
})
