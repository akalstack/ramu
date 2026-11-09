import { expect, it, vi } from 'vitest'
import {
  bitbucketApi,
  bitbucketMergeOptions,
  parseBitbucketRemote,
  parseComments,
  parseListPullRequest,
  parsePullRequest,
  parseRepositories,
  parseStatuses,
  pipelineNumber,
  pullRequestAction,
  pullRequestFiles,
  pullRequestTimeline,
  checksFeedback,
  lineComment,
  rerunChecks,
  setThreadStatus,
  submitReview,
  updatePullRequest,
  withdrawReview,
} from '../src/workspace/forge/bitbucket'
import { forgeAdapter } from '../src/workspace/forge/adapter'
import { FILES_PAGE, PATCH_LIMIT } from '../src/workspace/forge/adapter'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { bitbucketCredential } from '../src/workspace/forge/bitbucketCredentials'
import { adapterForOrigin } from '../src/workspace/forge/route'

it('reads workspace and repository from every bitbucket.org remote form, and nothing else', () => {
  const expected = { workspace: 'acme', slug: 'app' }
  expect(parseBitbucketRemote('https://ahmad@bitbucket.org/acme/app.git')).toEqual(expected)
  expect(parseBitbucketRemote('git@bitbucket.org:acme/app.git')).toEqual(expected)
  expect(parseBitbucketRemote('ssh://git@bitbucket.org/acme/app')).toEqual(expected)
  expect(parseBitbucketRemote('https://github.com/acme/app.git')).toBeNull()
  expect(parseBitbucketRemote('https://bitbucket.org/acme')).toBeNull()
})

it('routes bitbucket.org to its own adapter', async () => {
  expect((await adapterForOrigin('bitbucket.org')).id).toBe('bitbucket')
})

it('maps build statuses and reviewers onto the shared pull request shape', () => {
  const checks = parseStatuses([
    { key: 'b', name: 'test', state: 'FAILED', url: 'https://ci/1' },
    { key: 'a', state: 'SUCCESSFUL' },
    { key: 'c', name: 'deploy', state: 'INPROGRESS' },
    { key: 'd', name: 'lint', state: 'STOPPED' },
  ])
  expect(checks.map((check) => [check.name, check.state])).toEqual([
    ['a', 'success'],
    ['deploy', 'pending'],
    ['lint', 'skipped'],
    ['test', 'failure'],
  ])
  const raw = {
    id: 7,
    title: 'Fix login',
    state: 'OPEN' as const,
    source: { branch: { name: 'fix' }, commit: { hash: 'abc123' } },
    destination: { branch: { name: 'main' } },
    links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } },
    participants: [
      { role: 'REVIEWER', approved: true, state: 'approved' },
      { role: 'REVIEWER', approved: false, state: 'changes_requested' },
    ],
  }
  expect(parsePullRequest(raw, checks)).toMatchObject({
    number: 7,
    state: 'open',
    baseBranch: 'main',
    headBranch: 'fix',
    headCommit: 'abc123',
    reviewDecision: 'changes-requested',
  })
  expect(parsePullRequest({ ...raw, state: 'MERGED', participants: [] }, []).reviewDecision).toBeNull()
})

const listRow = {
  id: 3,
  title: 'Add search',
  state: 'OPEN' as const,
  source: { branch: { name: 's' }, repository: { full_name: 'acme/app' } },
  destination: { branch: { name: 'main' }, repository: { full_name: 'acme/app' } },
  links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/3' } },
  author: { uuid: '{ana}', nickname: 'ana' },
  reviewers: [{ uuid: '{bo}', nickname: 'bo' }],
  participants: [{ role: 'REVIEWER', approved: true, user: { uuid: '{bo}', nickname: 'bo' } }],
  updated_on: '2026-01-02T00:00:00Z',
}

it('lists pull requests grouped by the viewer’s part in them, leaving unknown facts unknown', () => {
  expect(parseListPullRequest(listRow, { uuid: '{ana}' })).toMatchObject({
    number: 3,
    author: 'ana',
    fork: false,
    reviewDecision: 'approved',
    checks: null,
    mergeable: 'unknown',
    openThreads: null,
    requestedReviewers: ['bo'],
    group: 'mine',
    updatedAt: Date.parse('2026-01-02T00:00:00Z'),
  })
  expect(parseListPullRequest(listRow, { uuid: '{bo}' }).group).toBe('review')
  const fork = { ...listRow, source: { ...listRow.source, repository: { full_name: 'eve/app' } } }
  expect(parseListPullRequest(fork, null)).toMatchObject({ group: 'other', fork: true })
})

it('offers the target branch’s merge strategies and explains what blocks the merge', () => {
  const pr = {
    ...listRow,
    destination: { ...listRow.destination, branch: { name: 'main', merge_strategies: ['squash', 'fast_forward'] } },
  }
  const clean = { checks: [], conflicts: false, permission: 'write' }
  expect(bitbucketMergeOptions(pr, clean)).toEqual({
    methods: ['squash', 'rebase'],
    blockers: [],
    canDeleteBranch: true,
  })
  expect(bitbucketMergeOptions(listRow, clean).methods).toEqual(['squash', 'merge', 'rebase'])
  expect(
    bitbucketMergeOptions(
      { ...pr, draft: true, close_source_branch: true },
      { checks: [{ name: 'ci', state: 'failure', url: null }], conflicts: true, permission: 'read' },
    ),
  ).toEqual({
    methods: ['squash', 'rebase'],
    blockers: [
      'It is a draft. Mark it ready for review first.',
      'It has conflicts with its base branch.',
      'Some checks are failing.',
      'This account cannot merge into this repository.',
    ],
    canDeleteBranch: false,
  })
})

it('threads replies under their top-level comment and trusts only the author, reviewers, the viewer and apps', () => {
  const threads = parseComments(
    [
      {
        id: 1,
        content: { raw: 'Handle empty input' },
        inline: { path: 'src/search.ts', to: 12, outdated: true },
        user: { uuid: '{bo}', nickname: 'bo' },
        resolution: { type: 'resolved' },
        created_on: '2026-01-02T00:00:00Z',
      },
      { id: 2, content: { raw: 'Done' }, parent: { id: 1 }, user: { uuid: '{ana}', nickname: 'ana' } },
      { id: 3, content: { raw: 'Deep reply' }, parent: { id: 2 }, user: { uuid: '{eve}', nickname: 'eve' } },
      { id: 4, content: { raw: 'Why?' }, user: { uuid: '{eve}', nickname: 'eve' } },
      { id: 5, content: { raw: 'Gone' }, deleted: true },
      { id: 6, content: { raw: 'Draft' }, pending: true },
      { id: 7, content: { raw: 'Scan passed' }, user: { uuid: '{app}', nickname: 'scanner', type: 'app_user' } },
      { id: 8, content: { raw: 'Note to self' }, user: { uuid: '{me}', nickname: 'me' } },
    ],
    listRow,
    { uuid: '{me}' },
  )
  expect(threads.map((thread) => [thread.id, thread.resolved, thread.outdated])).toEqual([
    ['1', true, true],
    ['4', false, false],
    ['7', false, false],
    ['8', false, false],
  ])
  expect(threads[0]).toMatchObject({ path: 'src/search.ts', line: 12 })
  expect(threads[0]!.comments.map((comment) => [comment.id, comment.author, comment.trusted])).toEqual([
    ['1', 'bo', true],
    ['2', 'ana', true],
    ['3', 'eve', false],
  ])
  expect(threads[2]!.comments[0]).toMatchObject({ bot: true, trusted: true })
  expect(threads[3]!.comments[0]!.trusted).toBe(true)
})

it('treats a merge whose reply was lost as done when Bitbucket shows it merged, and refuses to reopen', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-bitbucket-merge-'))
  execFileSync('git', ['init', '-q', '-b', 's'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:acme/app.git'], { cwd: dir })
  vi.stubEnv('BITBUCKET_ACCESS_TOKEN', 'workspace-token')
  let mergedAfter = true
  let reads = 0
  const merges: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace('https://api.bitbucket.org/2.0/repositories/acme/app', '')
      if (path === '/pullrequests/3/merge') {
        merges.push(JSON.parse(String(init?.body)))
        return new Response('', { status: 502 })
      }
      if (path === '/pullrequests/3') {
        reads++
        return new Response(JSON.stringify({ ...listRow, state: reads > 1 && mergedAfter ? 'MERGED' : 'OPEN' }))
      }
      return new Response('', { status: 404 })
    }),
  )
  const url = 'https://bitbucket.org/acme/app/pull-requests/3'
  try {
    await expect(
      pullRequestAction(dir, url, { kind: 'merge', method: 'rebase', deleteBranch: true }),
    ).resolves.toBeUndefined()
    expect(merges[0]).toEqual({ type: 'pullrequest', merge_strategy: 'fast_forward', close_source_branch: true })
    mergedAfter = false
    reads = 0
    await expect(pullRequestAction(dir, url, { kind: 'merge', method: 'merge', deleteBranch: false })).rejects.toThrow(
      'Bitbucket answered 502',
    )
    await expect(pullRequestAction(dir, url, { kind: 'reopen' })).rejects.toThrow('cannot reopen')
    await expect(pullRequestAction(dir, url, { kind: 'update-branch' })).rejects.toThrow('cannot update')
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('never keeps the account name Bitbucket puts in clone addresses', () => {
  const [repo] = parseRepositories([
    {
      full_name: 'acme/app',
      is_private: true,
      links: { clone: [{ name: 'https', href: 'https://ahmad@bitbucket.org/acme/app.git' }] },
    },
  ])
  expect(repo).toMatchObject({ fullName: 'acme/app', private: true, cloneUrl: 'https://bitbucket.org/acme/app.git' })
})

it('signs API tokens with the account email and access tokens as bearer, and explains a refused credential', async () => {
  const seen: string[] = []
  const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    seen.push(String((init?.headers as Record<string, string>).Authorization))
    return seen.length === 3 ? new Response('', { status: 401 }) : new Response('{"username":"ahmad"}')
  }) as unknown as typeof globalThis.fetch
  await bitbucketApi({ email: 'a@b.co', token: 'tok', fetch }, '/user')
  await bitbucketApi({ token: 'workspace-token', fetch }, '/user')
  expect(seen[0]).toBe(`Basic ${Buffer.from('a@b.co:tok').toString('base64')}`)
  expect(seen[1]).toBe('Bearer workspace-token')
  await expect(bitbucketApi({ token: 'old', fetch }, '/user')).rejects.toThrow(/did not accept/)
})

it('uses an API token from the environment, else an access token', async () => {
  expect(await bitbucketCredential({ BITBUCKET_EMAIL: 'a@b.co', BITBUCKET_API_TOKEN: 't' })).toEqual({
    email: 'a@b.co',
    token: 't',
    source: 'environment',
  })
  expect(await bitbucketCredential({ BITBUCKET_ACCESS_TOKEN: 'w' })).toEqual({ token: 'w', source: 'environment' })
  expect(await bitbucketCredential({})).toBeNull()
})

it('reads the build number of a Pipelines result from its status link only', () => {
  expect(pipelineNumber('https://bitbucket.org/acme/app/pipelines/results/12')).toBe(12)
  expect(pipelineNumber('https://ci.example.com/acme/app/pipelines/results/12')).toBeNull()
  expect(pipelineNumber(null)).toBeNull()
})

it('carries the end of each failed Pipelines step log, fetched from storage without the credential', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-bitbucket-logs-'))
  const run = (...args: string[]) => execFileSync('git', args, { cwd: dir })
  run('init', '-q', '-b', 'fix')
  run('-c', 'user.email=a@b.co', '-c', 'user.name=A', 'commit', '-q', '--allow-empty', '-m', 'start')
  run('remote', 'add', 'origin', 'git@bitbucket.org:acme/app.git')
  vi.stubEnv('BITBUCKET_ACCESS_TOKEN', 'workspace-token')
  const storage: (string | undefined)[] = []
  const log = [
    ...Array.from({ length: 100 }, (_, i) => `line ${i}`),
    '\u001b[31mError: expected 2, got 3\u001b[0m',
  ].join('\n')
  const json = (value: unknown) => new Response(JSON.stringify(value))
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://logs.example/')) {
        storage.push((init?.headers as Record<string, string> | undefined)?.Authorization)
        return new Response(log)
      }
      const path = url.replace('https://api.bitbucket.org/2.0/repositories/acme/app', '')
      if (path.startsWith('/pullrequests?'))
        return json({
          values: [
            {
              id: 7,
              title: 'Fix login',
              state: 'OPEN',
              source: { branch: { name: 'fix' } },
              destination: { branch: { name: 'main' } },
              links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/7' } },
            },
          ],
        })
      if (path.startsWith('/pullrequests/7/statuses'))
        return json({
          values: [
            {
              key: 'p',
              name: 'Pipeline #12',
              state: 'FAILED',
              url: 'https://bitbucket.org/acme/app/pipelines/results/12',
            },
          ],
        })
      if (path === '/pipelines/12') return json({ uuid: '{p-1}' })
      if (path.startsWith('/pipelines/%7Bp-1%7D/steps/?'))
        return json({
          values: [
            { uuid: '{s-1}', name: 'Test', state: { result: { name: 'FAILED' } } },
            { uuid: '{s-2}', name: 'Lint', state: { result: { name: 'SUCCESSFUL' } } },
          ],
        })
      if (path === '/pipelines/%7Bp-1%7D/steps/%7Bs-1%7D/log')
        return new Response(null, { status: 302, headers: { location: 'https://logs.example/s1' } })
      return new Response('', { status: 404 })
    }),
  )
  try {
    const prompt = await checksFeedback(dir)
    expect(prompt).toContain('- Pipeline #12 (https://bitbucket.org/acme/app/pipelines/results/12)')
    expect(prompt).toContain('Test (pipeline #12):\n```\n')
    expect(prompt).toContain('Error: expected 2, got 3\n```')
    expect(prompt).not.toContain('line 0\n')
    expect(prompt).not.toContain('\u001b')
    expect(storage).toEqual([undefined])
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('lists a pull request’s files from its diffstat with each file’s hunks from the diff, following its redirect', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-bitbucket-files-'))
  execFileSync('git', ['init', '-q', '-b', 's'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:acme/app.git'], { cwd: dir })
  vi.stubEnv('BITBUCKET_ACCESS_TOKEN', 'workspace-token')
  const base = 'https://api.bitbucket.org/2.0/repositories/acme/app'
  const huge = `+${'x'.repeat(PATCH_LIMIT)}`
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1..2 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    'diff --git a/lib/old.ts b/lib/new.ts',
    'similarity index 90%',
    'rename from lib/old.ts',
    'rename to lib/new.ts',
    '--- a/lib/old.ts',
    '+++ b/lib/new.ts',
    '@@ -2 +2 @@',
    '+more',
    'diff --git a/gone.ts b/gone.ts',
    'deleted file mode 100644',
    '--- a/gone.ts',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-bye',
    'diff --git a/gen.json b/gen.json',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/gen.json',
    '@@ -0,0 +1 @@',
    huge,
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    '',
  ].join('\n')
  let next: string | undefined
  const seen: { url: string; auth: string | null }[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') })
      if (url === `${base}/pullrequests/3/diffstat?pagelen=${FILES_PAGE}`)
        return new Response(
          JSON.stringify({
            values: [
              {
                status: 'modified',
                lines_added: 1,
                lines_removed: 1,
                old: { path: 'src/a.ts' },
                new: { path: 'src/a.ts' },
              },
              {
                status: 'renamed',
                lines_added: 1,
                lines_removed: 0,
                old: { path: 'lib/old.ts' },
                new: { path: 'lib/new.ts' },
              },
              { status: 'removed', lines_added: 0, lines_removed: 1, old: { path: 'gone.ts' }, new: null },
              { status: 'added', lines_added: 1, lines_removed: 0, old: null, new: { path: 'gen.json' } },
              { status: 'merge conflict', old: { path: 'logo.png' }, new: { path: 'logo.png' } },
            ],
            ...(next ? { next } : {}),
          }),
        )
      if (url === `${base}/pullrequests/3/diff`)
        return new Response('', { status: 302, headers: { location: `${base}/diff/acme/app:abc%0Ddef` } })
      if (url === `${base}/diff/acme/app:abc%0Ddef`) return new Response(diff)
      return new Response('', { status: 404 })
    }),
  )
  const url = 'https://bitbucket.org/acme/app/pull-requests/3'
  try {
    const { files, more } = await pullRequestFiles(dir, url)
    expect(more).toBe(false)
    expect(files.slice(0, 3)).toEqual([
      { path: 'src/a.ts', status: 'modified', additions: 1, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' },
      {
        path: 'lib/new.ts',
        previousPath: 'lib/old.ts',
        status: 'renamed',
        additions: 1,
        deletions: 0,
        patch: '@@ -2 +2 @@\n+more',
      },
      { path: 'gone.ts', status: 'removed', additions: 0, deletions: 1, patch: '@@ -1 +0,0 @@\n-bye' },
    ])
    expect(files[3]).toMatchObject({ path: 'gen.json', status: 'added', truncated: true })
    expect(files[3]!.patch).toHaveLength(PATCH_LIMIT)
    expect(files[4]).toEqual({ path: 'logo.png', status: 'changed', additions: 0, deletions: 0, patch: null })
    // The redirect stays on the API, so the credential goes with it.
    expect(seen.find((entry) => entry.url.includes('/diff/acme'))?.auth).toBe('Bearer workspace-token')
    next = `${base}/pullrequests/3/diffstat?page=2`
    expect((await pullRequestFiles(dir, url)).more).toBe(true)
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('reads a pull request’s activity as its timeline, oldest first, with state changes and pushes against the update before', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-bitbucket-timeline-'))
  execFileSync('git', ['init', '-q', '-b', 's'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:acme/app.git'], { cwd: dir })
  vi.stubEnv('BITBUCKET_ACCESS_TOKEN', 'workspace-token')
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 10, minute)).toISOString()
  const ana = { username: 'ana' }
  const bo = { nickname: 'bo' }
  const update = (minute: number, state: string, hash: string) => ({
    update: { state, date: at(minute), author: ana, source: { commit: { hash } } },
  })
  // Newest first, as Bitbucket lists it.
  let activity: unknown[] = [
    update(9, 'MERGED', 'b2'),
    update(8, 'OPEN', 'b2'),
    update(7, 'DECLINED', 'b2'),
    update(6, 'OPEN', 'b2'),
    { changes_request: { date: at(5), user: bo } },
    { approval: { date: at(4), user: bo } },
    { comment: { id: 3, deleted: true, content: { raw: 'gone' }, user: bo, created_on: at(3) } },
    {
      comment: {
        id: 2,
        content: { raw: `${'Please rename this. '.repeat(20)}\nMore` },
        user: bo,
        created_on: at(2),
        links: { html: { href: 'https://bitbucket.org/acme/app/pull-requests/3/_/diff#comment-2' } },
      },
    },
    update(1, 'OPEN', 'a1'),
  ]
  const requested: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url)
      return new Response(JSON.stringify({ values: activity }))
    }),
  )
  try {
    const events = await pullRequestTimeline(dir, 'https://bitbucket.org/acme/app/pull-requests/3')
    expect(requested).toEqual([
      'https://api.bitbucket.org/2.0/repositories/acme/app/pullrequests/3/activity?pagelen=50',
    ])
    expect(events.map((event) => [event.kind, event.actor, event.verdict ?? null])).toEqual([
      ['comment', 'bo', null],
      ['review', 'bo', 'approved'],
      ['review', 'bo', 'changes-requested'],
      ['commit', 'ana', null],
      ['closed', 'ana', null],
      ['reopened', 'ana', null],
      ['merged', 'ana', null],
    ])
    expect(events[0]).toMatchObject({
      at: Date.parse(at(2)),
      url: 'https://bitbucket.org/acme/app/pull-requests/3/_/diff#comment-2',
    })
    expect(events[0]!.text).toHaveLength(200)
    expect(events[0]!.text?.endsWith('…')).toBe(true)
    expect(events[3]!.at).toBe(Date.parse(at(6)))
    // The oldest update read is only the baseline, so an unchanged one shows nothing.
    activity = [update(2, 'OPEN', 'a1'), update(1, 'OPEN', 'a1')]
    expect(await pullRequestTimeline(dir, 'https://bitbucket.org/acme/app/pull-requests/3')).toEqual([])
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

/** A checkout on bitbucket.org/acme/app and a fake Bitbucket that records every request. */
function fakeBitbucket(answer: (method: string, path: string) => Response | undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-bitbucket-write-'))
  execFileSync('git', ['init', '-q', '-b', 's'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@bitbucket.org:acme/app.git'], { cwd: dir })
  vi.stubEnv('BITBUCKET_ACCESS_TOKEN', 'workspace-token')
  const calls: [string, string, unknown][] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      const path = url.replace('https://api.bitbucket.org/2.0/repositories/acme/app', '')
      calls.push([method, path, init?.body ? JSON.parse(String(init.body)) : undefined])
      return answer(method, path) ?? new Response(JSON.stringify({ id: 1 }))
    }),
  )
  return {
    dir,
    calls,
    done: () => {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

const prUrl = 'https://bitbucket.org/acme/app/pull-requests/3'

it('takes back whichever verdict the account gave, and says when it gave none', async () => {
  let approved = true
  const fake = fakeBitbucket((method, path) => {
    if (method !== 'DELETE') return undefined
    if (path === '/pullrequests/3/approve' && approved) return new Response(null, { status: 204 })
    return new Response('', { status: 404 })
  })
  try {
    await expect(withdrawReview(fake.dir, prUrl)).resolves.toBeUndefined()
    expect(fake.calls.map((call) => call[1]).sort()).toEqual([
      '/pullrequests/3/approve',
      '/pullrequests/3/request-changes',
    ])
    approved = false
    await expect(withdrawReview(fake.dir, prUrl)).rejects.toThrow('nothing to take back')
  } finally {
    fake.done()
  }
})

it('comments on the old version from its line, reopens by removing the resolution, and refuses what Bitbucket lacks', async () => {
  const fake = fakeBitbucket((method, path) =>
    path === '/pullrequests/3' ? new Response(JSON.stringify(listRow)) : undefined,
  )
  try {
    await expect(lineComment(fake.dir, prUrl, { path: 'a.ts', line: 4, side: 'old', body: 'Why?' })).resolves.toBe('1')
    expect(fake.calls.at(-1)).toEqual([
      'POST',
      '/pullrequests/3/comments',
      { content: { raw: 'Why?' }, inline: { path: 'a.ts', from: 4 } },
    ])
    await setThreadStatus(fake.dir, prUrl, '12', 'active')
    expect(fake.calls.at(-1)).toEqual(['DELETE', '/pullrequests/3/comments/12/resolve', undefined])
    await pullRequestAction(fake.dir, prUrl, { kind: 'draft' })
    expect(fake.calls.at(-1)).toEqual(['PUT', '/pullrequests/3', { title: 'Add search', draft: true }])
    await updatePullRequest(fake.dir, prUrl, { body: 'New', base: 'next' })
    expect(fake.calls.at(-1)).toEqual([
      'PUT',
      '/pullrequests/3',
      { title: 'Add search', description: 'New', destination: { branch: { name: 'next' } } },
    ])
    const before = fake.calls.length
    const review = {
      verdict: 'approve' as const,
      body: '',
      comments: [{ id: 'c', path: 'a.ts', line: 2, body: 'x', suggestion: 'y' }],
    }
    await expect(submitReview(fake.dir, prUrl, review)).rejects.toThrow('Bitbucket has no suggested changes.')
    await expect(updatePullRequest(fake.dir, prUrl, { labels: { add: ['bug'], remove: [] } })).rejects.toThrow(
      'Bitbucket has no labels.',
    )
    await expect(forgeAdapter('bitbucket').react(fake.dir, prUrl, '1', 'heart', false)).rejects.toThrow(
      'Bitbucket has no reactions.',
    )
    await expect(
      pullRequestAction(fake.dir, prUrl, { kind: 'auto-merge', method: 'merge', deleteBranch: false }),
    ).rejects.toThrow('Bitbucket has no merging automatically')
    await expect(setThreadStatus(fake.dir, prUrl, '12', 'by-design')).rejects.toThrow('thread statuses')
    // Only the auto-merge read the pull request; nothing was written.
    expect(fake.calls.slice(before).filter((call) => call[0] !== 'GET')).toEqual([])
  } finally {
    fake.done()
  }
})

it('starts the source branch’s pipeline again only when its latest run failed', async () => {
  let result = 'FAILED'
  const fake = fakeBitbucket((method, path) => {
    if (path === '/pullrequests/3') return new Response(JSON.stringify(listRow))
    if (method === 'GET' && path.startsWith('/pipelines/?'))
      return new Response(
        JSON.stringify({ values: [{ uuid: '{p}', state: { name: 'COMPLETED', result: { name: result } } }] }),
      )
    return undefined
  })
  try {
    await expect(rerunChecks(fake.dir, prUrl)).resolves.toBe(1)
    expect(fake.calls.find((call) => call[1].startsWith('/pipelines/?'))?.[1]).toBe(
      '/pipelines/?target.branch=s&sort=-created_on&pagelen=1',
    )
    expect(fake.calls.at(-1)).toEqual([
      'POST',
      '/pipelines/',
      { target: { type: 'pipeline_ref_target', ref_type: 'branch', ref_name: 's' } },
    ])
    result = 'SUCCESSFUL'
    await expect(rerunChecks(fake.dir, prUrl)).resolves.toBe(0)
    expect(fake.calls.at(-1)?.[0]).toBe('GET')
  } finally {
    fake.done()
  }
})
