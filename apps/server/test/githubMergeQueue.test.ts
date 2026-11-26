import { beforeEach, describe, expect, it, vi } from 'vitest'
import { forgeRemoteOf, githubGraphql } from '../src/workspace/forge/github'
import { mergeOptions, pullRequestAction } from '../src/workspace/forge/githubPulls'

// Only what the pull request adapter takes from its sibling, which would otherwise load the adapter back.
vi.mock('../src/workspace/forge/github', () => ({
  ForgeError: class extends Error {},
  forgeRemoteOf: vi.fn(),
  githubAvailability: vi.fn(),
  githubGraphql: vi.fn(),
  githubRest: vi.fn(),
}))

const URL = 'https://github.com/o/r/pull/12'
const one = {
  repository: {
    mergeCommitAllowed: true,
    squashMergeAllowed: true,
    rebaseMergeAllowed: false,
    deleteBranchOnMerge: false,
    viewerPermission: 'WRITE',
    pullRequest: {
      id: 'PR_1',
      body: '',
      number: 12,
      title: 'Add export',
      url: URL,
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'main',
      headRefName: 'export',
      headRefOid: 'abc',
      updatedAt: '2026-11-01T10:00:00Z',
      isCrossRepository: false,
      reviewDecision: 'APPROVED',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      author: { login: 'me' },
    },
  },
}

/** GitHub as the adapter sees it: one pull request, on a branch with or without a merge queue. */
function github(queue: boolean | 'unknown') {
  const sent: string[] = []
  vi.mocked(forgeRemoteOf).mockResolvedValue({ origin: 'github.com', owner: 'o', repo: 'r' } as never)
  vi.mocked(githubGraphql).mockImplementation(async (_cwd, query) => {
    sent.push(query)
    if (query.includes('isMergeQueueEnabled')) {
      if (queue === 'unknown') throw new Error("Field 'isMergeQueueEnabled' doesn't exist on type 'PullRequest'")
      return { node: { isMergeQueueEnabled: queue } }
    }
    return query.startsWith('query') ? one : {}
  })
  return sent
}

beforeEach(() => vi.clearAllMocks())

describe('a GitHub branch with a merge queue', () => {
  it('says so and leaves the method and the branch to the queue', async () => {
    github(true)
    expect(await mergeOptions('/repo', URL)).toEqual({ methods: [], blockers: [], canDeleteBranch: false, queue: true })
    github(false)
    expect(await mergeOptions('/repo', URL)).toEqual({
      methods: ['squash', 'merge'],
      blockers: [],
      canDeleteBranch: true,
    })
  })

  it('adds the pull request to the queue instead of merging it directly', async () => {
    const sent = github(true)
    await pullRequestAction('/repo', URL, { kind: 'merge', method: 'squash', deleteBranch: true })
    expect(sent.some((query) => query.includes('enablePullRequestAutoMerge'))).toBe(true)
    expect(sent.some((query) => query.includes('mergePullRequest('))).toBe(false)
  })

  it('merges directly where there is no queue, or the service is too old to have one', async () => {
    for (const queue of [false, 'unknown'] as const) {
      const sent = github(queue)
      await pullRequestAction('/repo', URL, { kind: 'merge', method: 'squash', deleteBranch: false })
      expect(sent.some((query) => query.includes('mergePullRequest('))).toBe(true)
    }
  })
})
