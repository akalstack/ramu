import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as forge from '../src/workspace/forge'

const pr = {
  number: 7,
  title: 'Bump types',
  url: 'https://github.com/o/r/pull/7',
  state: 'open' as const,
  draft: false,
  baseBranch: 'main',
  headBranch: 'feature/bump-types',
  reviewDecision: null,
  checks: [],
}

describe('suggested branch names', () => {
  it('uses the commit type and a short slug', () => {
    expect(forge.suggestBranch('fix(web): Retry the queue!')).toBe('fix/retry-the-queue')
    expect(forge.suggestBranch('Add a retry queue')).toBe('feature/add-a-retry-queue')
    expect(forge.suggestBranch('!!!')).toBe('feature/changes')
  })
})

describe('pull request parsing', () => {
  it('keeps the latest run of each check and maps check runs and commit statuses', () => {
    const checks = forge.parseChecks([
      {
        __typename: 'CheckRun',
        name: 'Check (macos)',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        startedAt: '2026-10-15T18:08:24Z',
        detailsUrl: 'https://github.com/o/r/actions/runs/1/job/11',
      },
      {
        __typename: 'CheckRun',
        name: 'Check (macos)',
        status: 'COMPLETED',
        conclusion: 'SUCCESS',
        startedAt: '2026-10-15T18:10:00Z',
        detailsUrl: 'https://github.com/o/r/actions/runs/2/job/22',
      },
      { __typename: 'CheckRun', name: 'Check (linux)', status: 'IN_PROGRESS', conclusion: null },
      { __typename: 'StatusContext', context: 'CodeRabbit', state: 'ERROR', targetUrl: '' },
      { __typename: 'CheckRun', name: 'Optional', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ])
    expect(checks).toEqual([
      { name: 'Check (linux)', state: 'pending', url: null },
      { name: 'Check (macos)', state: 'success', url: 'https://github.com/o/r/actions/runs/2/job/22' },
      { name: 'CodeRabbit', state: 'failure', url: null },
      { name: 'Optional', state: 'skipped', url: null },
    ])
  })

  it('normalizes state, draft and review decision', () => {
    const parsed = forge.parsePullRequest({
      number: 3,
      title: 'Fix',
      url: 'u',
      state: 'MERGED',
      isDraft: true,
      baseRefName: 'main',
      headRefName: 'fix',
      reviewDecision: 'CHANGES_REQUESTED',
      statusCheckRollup: null,
    })
    expect(parsed).toMatchObject({ state: 'merged', draft: true, reviewDecision: 'changes-requested', checks: [] })
    expect(
      forge.parsePullRequest({
        ...parsed,
        state: 'OPEN',
        isDraft: false,
        baseRefName: 'main',
        headRefName: 'fix',
        reviewDecision: '',
      }),
    ).toMatchObject({ state: 'open', reviewDecision: null })
  })

  it('recognizes signed-out and non-GitHub errors', () => {
    expect(forge.availabilityFromError('To get started with GitHub CLI, please run:  gh auth login')).toBe('signed-out')
    expect(
      forge.availabilityFromError(
        'none of the git remotes configured for this repository point to a known GitHub host',
      ),
    ).toBe('not-github')
    expect(forge.availabilityFromError('no pull requests found for branch "main"')).toBeNull()
  })

  it('finds the Actions job behind a check link', () => {
    expect(forge.actionsJobId('https://github.com/o/r/actions/runs/38783128581/job/116588192161')).toBe('116588192161')
    expect(forge.actionsJobId('https://ci.example.com/build/1')).toBeNull()
    expect(forge.actionsJobId(null)).toBeNull()
  })
})

describe('feedback prompts', () => {
  it('cuts a job log down to the lines before its first error, without timestamps or escapes', () => {
    const log = [
      ...Array.from({ length: 300 }, (_, i) => `2026-10-15T18:09:00.0000000Z noise ${i}`),
      '2026-10-15T18:09:56.3303440Z \x1b[31mFAIL\x1b[0m test/x.test.ts > adds',
      '2026-10-15T18:09:56.3303440Z ##[error]Process completed with exit code 1.',
    ].join('\n')
    const excerpt = forge.failureExcerpt(log)
    expect(excerpt).toContain('FAIL test/x.test.ts > adds')
    expect(excerpt).toContain('##[error]Process completed with exit code 1.')
    expect(excerpt).not.toContain('noise 100')
    expect(excerpt).not.toMatch(/2026-10-15T/)
    expect(excerpt).not.toContain('\x1b')
  })

  it('lists only open review threads and reviews with text', () => {
    const prompt = forge.reviewFeedbackPrompt(pr, {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  isResolved: false,
                  isOutdated: false,
                  path: 'src/a.ts',
                  line: 12,
                  comments: { nodes: [{ author: { login: 'ana' }, body: 'Handle null here.' }] },
                },
                {
                  isResolved: true,
                  isOutdated: false,
                  path: 'src/b.ts',
                  line: 3,
                  comments: { nodes: [{ author: { login: 'ana' }, body: 'Already fixed.' }] },
                },
              ],
            },
            reviews: {
              nodes: [
                { state: 'CHANGES_REQUESTED', body: 'Close, a few things.', author: { login: 'ana' } },
                { state: 'APPROVED', body: '', author: { login: 'ben' } },
              ],
            },
          },
        },
      },
    })
    expect(prompt).toContain('### src/a.ts:12')
    expect(prompt).toContain('- ana: Handle null here.')
    expect(prompt).toContain('- ana (changes requested): Close, a few things.')
    expect(prompt).not.toContain('Already fixed.')
    expect(prompt).not.toContain('ben')
  })

  it('has nothing to hand off when every thread is resolved', () => {
    const empty = { data: { repository: { pullRequest: { reviewThreads: { nodes: [] }, reviews: { nodes: [] } } } } }
    expect(forge.reviewFeedbackPrompt(pr, empty)).toBeNull()
  })

  it('writes an issue as an opening message with its comments', () => {
    const prompt = forge.issuePrompt({
      number: 42,
      title: 'Crash on save',
      url: 'https://github.com/o/r/issues/42',
      body: 'Steps: open, save.',
      labels: [{ name: 'bug' }],
      comments: [{ author: { login: 'cy' }, body: 'Also on Linux.' }],
    })
    expect(prompt.split('\n')[0]).toBe('Work on issue #42: Crash on save')
    expect(prompt).toContain('Steps: open, save.')
    expect(prompt).toContain('Labels: bug')
    expect(prompt).toContain('- cy: Also on Linux.')
  })
})

describe('pull request drafts', () => {
  let tmp: string
  let repo: string
  const sh = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const commit = (file: string, message: string) => {
    writeFileSync(join(repo, file), file)
    sh('add', '.')
    sh('commit', '-q', '-m', message)
  }
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'ramu-forge-'))
    repo = join(tmp, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    sh('config', 'user.email', 'test@example.com')
    sh('config', 'user.name', 'Test Author')
    sh('config', 'commit.gpgsign', 'false')
    commit('base.txt', 'Initial commit')
  })
  afterEach(() => rmSync(tmp, { recursive: true, force: true }))

  it('uses a single commit as title and body and closes the linked issue', async () => {
    sh('checkout', '-q', '-b', 'fix/save')
    commit('a.txt', 'Fix crash on save\n\nGuard the empty buffer.')
    const issue = { repoId: 'r', number: 42, title: 'Crash on save', url: 'https://github.com/o/r/issues/42' }
    expect(await forge.pullRequestDraft(repo, issue)).toEqual({
      title: 'Fix crash on save',
      body: 'Guard the empty buffer.\n\nCloses #42',
      base: 'main',
      branch: null,
      issue,
    })
  })

  it('names several commits after the branch and lists them', async () => {
    sh('checkout', '-q', '-b', 'feature/pull-request_flow')
    commit('a.txt', 'Add forge wrapper')
    commit('b.txt', 'Show checks')
    const draft = await forge.pullRequestDraft(repo, null)
    expect(draft.title).toBe('Pull request flow')
    expect(draft.body).toBe('- Add forge wrapper\n- Show checks')
  })

  it('refuses a base branch or a branch without new commits', async () => {
    await expect(forge.pullRequestDraft(repo, null)).rejects.toThrow(/no commits/)
    sh('checkout', '-q', '-b', 'empty')
    await expect(forge.pullRequestDraft(repo, null)).rejects.toThrow(/no commits/)
  })

  it('drafts from commits on the base branch and suggests a branch for them', async () => {
    const remote = join(tmp, 'remote.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
    sh('remote', 'add', 'origin', remote)
    sh('push', '-q', '-u', 'origin', 'main')
    commit('a.txt', 'fix(web): Retry the queue')
    sh('branch', 'fix/retry-the-queue')
    const draft = await forge.pullRequestDraft(repo, null)
    expect(draft).toMatchObject({ title: 'fix(web): Retry the queue', base: 'main', branch: 'fix/retry-the-queue-2' })
  })
})

describe('publishing a repository', () => {
  let dir: string
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ramu-publish-'))
    run('init', '-b', 'main')
    run('config', 'user.email', 't@example.com')
    run('config', 'user.name', 'T')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))
  const input = { name: 'demo', visibility: 'private' as const }

  it('asks for a first commit instead of calling GitHub', async () => {
    await expect(forge.publishRepository(dir, input)).rejects.toThrow('Commit your changes first')
  })

  it('leaves a repository that already has a remote to Publish branch', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a')
    run('add', '.')
    run('commit', '-m', 'first')
    run('remote', 'add', 'origin', 'https://github.com/o/r.git')
    await expect(forge.publishRepository(dir, input)).rejects.toThrow('already has a remote')
  })
})

describe('detected GitHub sign-ins', () => {
  const status = (text: string) => async () => text
  it('reports no CLI, signed-out and signed-in without ever exposing a token', async () => {
    expect(await forge.forgeConnections({ executable: null, now: 1 })).toEqual({
      cli: 'no-cli',
      accounts: [],
      checkedAt: 1,
    })
    expect(
      await forge.forgeConnections({ executable: '/gh', status: status('You are not logged in'), now: 2 }),
    ).toMatchObject({
      cli: 'signed-out',
      accounts: [],
    })
    const signedIn = await forge.forgeConnections({
      executable: '/gh',
      status: status(
        "github.com\n  ✓ Logged in to github.com account me (keyring)\n  - Active account: true\n  - Git operations protocol: https\n  - Token: gho_SECRET\n  - Token scopes: 'repo'\n",
      ),
      now: 3,
    })
    expect(signedIn).toMatchObject({ cli: 'signed-in', accounts: [{ login: 'me', host: 'github.com', state: 'ok' }] })
    expect(JSON.stringify(signedIn)).not.toContain('SECRET')
  })
})
