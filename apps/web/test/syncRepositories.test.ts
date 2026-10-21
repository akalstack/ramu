import { beforeEach, expect, it, vi } from 'vitest'
import type { RamuBridge } from '@ramu/shared/api'
import { syncConfirmationMessage } from '@ramu/shared/protectedBranch'
import { syncRepositories } from '../src/git/syncRepositories'
const state = vi.hoisted(() => ({ confirm: vi.fn() }))
vi.mock('../src/git/ProtectedSyncDialog', () => ({ confirmProtectedSync: state.confirm }))
const approval = { branch: 'main', targetBranch: 'main', oid: 'a'.repeat(40) }
const repositories = [
  { repoId: 'api', repoName: 'API' },
  { repoId: 'web', repoName: 'Web' },
]
beforeEach(() => vi.clearAllMocks())
it('does not prompt when the server completes a pull-only or feature-branch sync', async () => {
  const invoke = vi.fn().mockResolvedValue(undefined)
  await syncRepositories(invoke as RamuBridge['invoke'], 'thread', repositories)
  expect(state.confirm).not.toHaveBeenCalled()
  expect(invoke.mock.calls).toEqual([
    ['git.sync', 'thread', 'api'],
    ['git.sync', 'thread', 'web'],
  ])
})
it('groups protected pushes into one confirmation and retries only those repositories with their approvals', async () => {
  const invoke = vi.fn().mockImplementation(async (_method, _task, repo, confirmed) => {
    if (repo === 'api' && !confirmed) throw new Error(syncConfirmationMessage(approval))
  })
  state.confirm.mockResolvedValue(true)
  await syncRepositories(invoke as RamuBridge['invoke'], 'thread', repositories)
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith([{ repoName: 'API', branch: 'main' }])
  expect(invoke.mock.calls).toEqual([
    ['git.sync', 'thread', 'api'],
    ['git.sync', 'thread', 'web'],
    ['git.sync', 'thread', 'api', approval],
  ])
})
it('does not retry a protected push when the user cancels', async () => {
  const invoke = vi.fn().mockRejectedValue(new Error(syncConfirmationMessage(approval)))
  state.confirm.mockResolvedValue(false)
  await expect(syncRepositories(invoke as RamuBridge['invoke'], 'thread', repositories.slice(0, 1))).rejects.toThrow(
    'Sync cancelled',
  )
  expect(invoke).toHaveBeenCalledOnce()
})
it('reports failed retries and never treats a changed branch or commit as approved', async () => {
  const invoke = vi
    .fn()
    .mockRejectedValueOnce(new Error(syncConfirmationMessage(approval)))
    .mockRejectedValueOnce(new Error('Branch changed'))
  state.confirm.mockResolvedValue(true)
  await expect(syncRepositories(invoke as RamuBridge['invoke'], 'thread', repositories.slice(0, 1))).rejects.toThrow(
    'API: Error: Branch changed',
  )
  expect(invoke).toHaveBeenCalledTimes(2)
})
