import { beforeEach, expect, it, vi } from 'vitest'
import { pullRequestFiles } from '../src/workspace/forge/githubPulls'
import { forgeRemoteOf, githubRest } from '../src/workspace/forge/github'

vi.mock('../src/workspace/forge/github', async (load) => ({
  ...(await load<typeof import('../src/workspace/forge/github')>()),
  forgeRemoteOf: vi.fn(),
  githubRest: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(forgeRemoteOf).mockResolvedValue({ host: 'github.com', owner: 'o', repo: 'r' } as never)
})

it("lists a pull request's files with their patches, cutting a huge one and naming renames", async () => {
  vi.mocked(githubRest).mockResolvedValue([
    { filename: 'src/a.ts', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1,2 @@\n-a\n+b\n+c' },
    { filename: 'src/b.ts', previous_filename: 'src/old.ts', status: 'renamed', additions: 0, deletions: 0 },
    { filename: 'big.json', status: 'added', additions: 9000, deletions: 0, patch: `+${'x'.repeat(50_000)}` },
    { filename: 'odd', status: 'something-new', additions: 1, deletions: 0, patch: '+1' },
  ])
  const { files, more } = await pullRequestFiles('/repo', 'https://github.com/o/r/pull/7')
  expect(githubRest).toHaveBeenCalledWith('/repo', 'GET', '/repos/o/r/pulls/7/files?per_page=100')
  expect(more).toBe(false)
  expect(files[0]).toEqual({
    path: 'src/a.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    patch: '@@ -1 +1,2 @@\n-a\n+b\n+c',
  })
  expect(files[1]).toMatchObject({ path: 'src/b.ts', previousPath: 'src/old.ts', status: 'renamed', patch: null })
  expect(files[2]).toMatchObject({ truncated: true })
  expect(files[2]!.patch).toHaveLength(40_000)
  expect(files[3]!.status).toBe('changed')
})

it('says when there are more files than one page', async () => {
  vi.mocked(githubRest).mockResolvedValue(
    Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}`, status: 'added', additions: 1, deletions: 0 })),
  )
  expect((await pullRequestFiles('/repo', 'https://github.com/o/r/pull/7')).more).toBe(true)
})
