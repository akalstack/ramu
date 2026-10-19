import { expect, it } from 'vitest'
import { branchForTitle, resolveCheckoutMode, validBranchPrefix, validBranchName } from '../src/workspaceDefaults'

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
