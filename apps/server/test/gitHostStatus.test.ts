import { beforeEach, expect, it, vi } from 'vitest'
import { latestDeployChecks } from '../src/workspace/deploy/gitHostStatus'
import { commitChecks } from '../src/workspace/forge'
import { commitBranchInfo, git } from '../src/workspace/git'

vi.mock('../src/workspace/git', () => ({ commitBranchInfo: vi.fn(), git: vi.fn() }))
vi.mock('../src/workspace/forge', () => ({ commitChecks: vi.fn() }))

const repository = { id: 'r1', name: 'shop', root: '/repo' }
const sha = 'a'.repeat(40)

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(commitBranchInfo).mockResolvedValue({ branch: 'feature', defaultBranch: 'main' })
  vi.mocked(git).mockResolvedValue(`${sha}\trefs/heads/main\n`)
})

it('reads the checks on the newest default-branch commit on the remote, deploys included', async () => {
  vi.mocked(commitChecks).mockResolvedValue([{ name: 'Vercel', state: 'success', url: 'https://vercel.com/o/r/1' }])
  expect(await latestDeployChecks(repository)).toEqual({
    repoId: 'r1',
    name: 'shop',
    branch: 'main',
    commit: sha,
    checks: [{ name: 'Vercel', state: 'success', url: 'https://vercel.com/o/r/1' }],
  })
  expect(vi.mocked(git)).toHaveBeenCalledWith('/repo', ['ls-remote', '--heads', 'origin', 'refs/heads/main'])
  expect(vi.mocked(commitChecks)).toHaveBeenCalledWith('/repo', sha)
})

it('answers null for a branch not on the remote, a service it cannot read, or a failed read', async () => {
  vi.mocked(git).mockResolvedValueOnce('')
  expect(await latestDeployChecks(repository)).toBeNull()
  vi.mocked(commitChecks).mockResolvedValueOnce(null)
  expect(await latestDeployChecks(repository)).toBeNull()
  vi.mocked(commitChecks).mockRejectedValueOnce(new Error('HTTP 401'))
  expect(await latestDeployChecks(repository)).toBeNull()
  expect(vi.mocked(commitChecks)).toHaveBeenCalledTimes(2)
})
