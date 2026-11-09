import { beforeEach, expect, it, vi } from 'vitest'
import { pullRequestFiles, submitReview } from '../src/workspace/forge/githubPulls'
import { forgeRemoteOf, githubGraphql, githubRest } from '../src/workspace/forge/github'

vi.mock('../src/workspace/forge/github', async (load) => ({
  ...(await load<typeof import('../src/workspace/forge/github')>()),
  forgeRemoteOf: vi.fn(),
  githubRest: vi.fn(),
  githubGraphql: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(forgeRemoteOf).mockResolvedValue({ origin: 'github.com', protocol: 'https', owner: 'o', repo: 'r' })
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

it('sends a comment on a block of lines with where the block starts, and a single line without it', async () => {
  vi.mocked(githubGraphql).mockResolvedValue({
    repository: { pullRequest: { number: 7, headRefOid: 'abc' } },
  } as never)
  vi.mocked(githubRest).mockResolvedValue(null)
  await submitReview('/repo', 'https://github.com/o/r/pull/7', {
    verdict: 'comment',
    body: '',
    comments: [
      { id: '1', path: 'a.ts', line: 12, startLine: 9, body: 'block' },
      { id: '2', path: 'a.ts', line: 20, body: 'one' },
    ],
  })
  const payload = vi.mocked(githubRest).mock.calls.at(-1)![3] as { comments: Record<string, unknown>[] }
  expect(payload.comments[0]).toMatchObject({ line: 12, start_line: 9, start_side: 'RIGHT', side: 'RIGHT' })
  expect(payload.comments[1]).not.toHaveProperty('start_line')
})

it('reads the repository the link names through the checkout, and refuses a link on another server', async () => {
  vi.mocked(githubRest).mockResolvedValue([])
  await pullRequestFiles('/repo', 'https://github.com/upstream/site/pull/3')
  expect(githubRest).toHaveBeenCalledWith('/repo', 'GET', '/repos/upstream/site/pulls/3/files?per_page=100')
  await expect(pullRequestFiles('/repo', 'https://ghe.example.com/o/r/pull/7')).rejects.toThrow('not on github.com')
})
