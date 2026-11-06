import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { GitlabCredentials, configureGitlabCredentials } from '../src/workspace/forge/gitlabCredentials'
import {
  gitlabApi,
  gitlabMergeOptions,
  gitlabMergeability,
  gitlabSummary,
  gitlabToken,
  jobState,
  parseDiscussions,
  parseJobs,
  parseListMergeRequest,
  parseMergeRequest,
  parseProjects,
  pullRequestAction,
  readyTitle,
} from '../src/workspace/forge/gitlab'

it('reports the latest attempt of each pipeline job, and allowed failures do not fail the merge request', () => {
  expect(
    parseJobs([
      { id: 1, name: 'test', status: 'failed', web_url: 'https://gitlab.com/a/b/-/jobs/1' },
      { id: 3, name: 'test', status: 'success', web_url: 'https://gitlab.com/a/b/-/jobs/3' },
      { id: 2, name: 'lint', status: 'failed', allow_failure: true },
      { id: 4, name: 'deploy', status: 'manual' },
      { id: 5, name: 'build', status: 'running' },
    ]),
  ).toEqual([
    { name: 'build', state: 'pending', url: null },
    { name: 'deploy', state: 'skipped', url: null },
    { name: 'lint', state: 'skipped', url: null },
    { name: 'test', state: 'success', url: 'https://gitlab.com/a/b/-/jobs/3' },
  ])
  expect(jobState({ status: 'failed' })).toBe('failure')
})

it('maps a merge request onto the shared pull request shape', () => {
  const raw = {
    iid: 7,
    title: 'Add search',
    web_url: 'https://gitlab.com/a/b/-/merge_requests/7',
    state: 'opened' as const,
    draft: true,
    target_branch: 'main',
    source_branch: 'feature/search',
    sha: 'abc',
    detailed_merge_status: 'not_approved',
  }
  expect(parseMergeRequest(raw, false, [])).toEqual({
    number: 7,
    title: 'Add search',
    url: raw.web_url,
    state: 'open',
    draft: true,
    baseBranch: 'main',
    headBranch: 'feature/search',
    headCommit: 'abc',
    reviewDecision: 'review-required',
    checks: [],
  })
  expect(parseMergeRequest({ ...raw, state: 'merged' }, true, []).state).toBe('merged')
  expect(parseMergeRequest(raw, true, []).reviewDecision).toBe('approved')
  expect(parseMergeRequest({ ...raw, detailed_merge_status: 'requested_changes' }, true, []).reviewDecision).toBe(
    'changes-requested',
  )
})

it('lists merge requests with their author, reviewers and the viewer’s part in them', () => {
  const raw = {
    iid: 4,
    title: 'Draft: Add search',
    web_url: 'https://gitlab.com/a/b/-/merge_requests/4',
    state: 'opened' as const,
    draft: true,
    target_branch: 'main',
    source_branch: 'search',
    sha: 'abc',
    detailed_merge_status: 'need_rebase',
    author: { id: 1, username: 'Ana' },
    reviewers: [{ id: 2, username: 'bo' }],
    updated_at: '2026-01-02T00:00:00Z',
    source_project_id: 9,
    target_project_id: 9,
  }
  expect(parseListMergeRequest(raw, 'ana')).toMatchObject({
    number: 4,
    author: 'Ana',
    fork: false,
    checks: null,
    mergeable: 'behind',
    openThreads: null,
    requestedReviewers: ['bo'],
    group: 'mine',
    updatedAt: Date.parse('2026-01-02T00:00:00Z'),
  })
  expect(parseListMergeRequest(raw, 'bo').group).toBe('review')
  expect(parseListMergeRequest({ ...raw, source_project_id: 3 }, null)).toMatchObject({ group: 'other', fork: true })
  expect(gitlabMergeability({ has_conflicts: true, detailed_merge_status: 'mergeable' })).toBe('conflicts')
  expect(gitlabMergeability({ detailed_merge_status: 'checking' })).toBe('unknown')
  expect(gitlabMergeability({ detailed_merge_status: 'not_approved' })).toBe('blocked')
  expect(readyTitle('Draft: Add search')).toBe('Add search')
  expect(readyTitle('[WIP] Add search')).toBe('Add search')
  expect(readyTitle('Drafting docs')).toBe('Drafting docs')
})

it('offers the project’s merge method with squash, and explains what blocks the merge', () => {
  const mr = {
    iid: 4,
    title: 'Add search',
    web_url: 'u',
    state: 'opened' as const,
    target_branch: 'main',
    source_branch: 's',
    detailed_merge_status: 'mergeable',
    source_project_id: 1,
    target_project_id: 1,
    user: { can_merge: true },
  }
  expect(gitlabMergeOptions({ merge_method: 'merge', squash_option: 'default_off' }, mr)).toEqual({
    methods: ['squash', 'merge'],
    blockers: [],
    canDeleteBranch: true,
  })
  expect(gitlabMergeOptions({ merge_method: 'ff', squash_option: 'never' }, mr).methods).toEqual(['rebase'])
  expect(gitlabMergeOptions({ squash_option: 'always' }, mr).methods).toEqual(['squash'])
  const blocked = gitlabMergeOptions(
    {},
    {
      ...mr,
      draft: true,
      detailed_merge_status: 'discussions_not_resolved',
      head_pipeline: { status: 'failed' },
      user: { can_merge: false },
      force_remove_source_branch: true,
    },
  )
  expect(blocked.blockers).toEqual([
    'It is a draft. Mark it ready for review first.',
    'Every discussion must be resolved first.',
    'Some checks are failing.',
    'This account cannot merge into this project.',
  ])
  expect(blocked.canDeleteBranch).toBe(false)
})

it('reads discussions as threads, trusting the author, reviewers, developers and bots only', () => {
  const threads = parseDiscussions(
    [
      { id: 'sys', notes: [{ id: 1, body: 'changed the title', system: true }] },
      {
        id: 'd1',
        notes: [
          {
            id: 2,
            body: ' Handle empty input ',
            resolvable: true,
            resolved: true,
            author: { id: 10, username: 'bo' },
            position: { new_path: 'src/search.ts', new_line: 12 },
            created_at: '2026-01-02T00:00:00Z',
          },
          { id: 3, body: 'Fixed', resolvable: true, resolved: true, author: { id: 11, username: 'ana' } },
        ],
      },
      {
        id: 'd2',
        notes: [
          { id: 4, body: 'Please also do X', resolvable: true, resolved: false, author: { id: 20, username: 'eve' } },
          { id: 5, body: 'Seconded', resolvable: true, resolved: false, author: { id: 21, username: 'dev' } },
          { id: 6, body: 'Coverage 80%', author: { id: 22, username: 'project_9_bot_1a2b' } },
        ],
      },
      { id: 'd3', notes: [{ id: 7, body: 'Nice', author: { id: 20, username: 'eve' } }] },
    ],
    { author: { id: 11, username: 'ana' }, reviewers: [{ id: 10, username: 'bo' }] },
    new Set([21]),
  )
  expect(threads.map((thread) => [thread.id, thread.resolved, thread.resolvable, thread.outdated])).toEqual([
    ['d1', true, true, false],
    ['d2', false, true, false],
    ['d3', false, false, false],
  ])
  expect(threads[0]).toMatchObject({ path: 'src/search.ts', line: 12 })
  expect(threads[0]!.comments[0]).toEqual({
    id: '2',
    author: 'bo',
    bot: false,
    trusted: true,
    body: 'Handle empty input',
    createdAt: Date.parse('2026-01-02T00:00:00Z'),
  })
  expect(threads[1]!.comments.map((comment) => [comment.author, comment.trusted, comment.bot])).toEqual([
    ['eve', false, false],
    ['dev', true, false],
    ['project_9_bot_1a2b', true, true],
  ])
})

it('treats a merge whose reply was lost as done when GitLab shows it merged, and fails otherwise', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-gitlab-merge-'))
  execFileSync('git', ['init', '-q', '-b', 'search'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.com:a/b.git'], { cwd: dir })
  vi.stubEnv('GLAB_CONFIG_DIR', '/nonexistent')
  vi.stubEnv('GITLAB_HOST', 'gitlab.com')
  vi.stubEnv('GITLAB_TOKEN', 'glpat-test')
  let mergedAfter = true
  let reads = 0
  const merges: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === 'https://gitlab.com/api/v4/projects/a%2Fb/merge_requests/4/merge') {
        merges.push(JSON.parse(String(init?.body)))
        return new Response('', { status: 502 })
      }
      if (url === 'https://gitlab.com/api/v4/projects/a%2Fb/merge_requests/4') {
        reads++
        const state = reads > 1 && mergedAfter ? 'merged' : 'opened'
        return new Response(
          JSON.stringify({
            iid: 4,
            title: 't',
            web_url: 'u',
            state,
            sha: 'abc',
            target_branch: 'main',
            source_branch: 'search',
            source_project_id: 1,
            target_project_id: 1,
          }),
        )
      }
      return new Response('', { status: 404 })
    }),
  )
  const url = 'https://gitlab.com/a/b/-/merge_requests/4'
  try {
    await expect(
      pullRequestAction(dir, url, { kind: 'merge', method: 'squash', deleteBranch: true }),
    ).resolves.toBeUndefined()
    expect(merges[0]).toEqual({
      squash: true,
      should_remove_source_branch: true,
      merge_when_pipeline_succeeds: false,
      sha: 'abc',
    })
    mergedAfter = false
    reads = 0
    await expect(pullRequestAction(dir, url, { kind: 'merge', method: 'merge', deleteBranch: false })).rejects.toThrow(
      'GitLab answered 502',
    )
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('lists only HTTPS clone addresses and treats internal projects as private', () => {
  expect(
    parseProjects([
      {
        path_with_namespace: 'team/app',
        description: '',
        visibility: 'internal',
        http_url_to_repo: 'https://gitlab.com/team/app.git',
        last_activity_at: '2026-01-02T00:00:00Z',
      },
      { path_with_namespace: 'team/odd', description: null, visibility: 'public', http_url_to_repo: 'http://x/y.git' },
    ]),
  ).toEqual([
    {
      fullName: 'team/app',
      description: null,
      private: true,
      cloneUrl: 'https://gitlab.com/team/app.git',
      updatedAt: Date.parse('2026-01-02T00:00:00Z'),
    },
  ])
})

it('sends the token only to the project origin and never echoes a failed response', async () => {
  const seen: { url: string; headers: Record<string, string>; redirect?: string }[] = []
  const reply = (status: number, body: string): typeof fetch =>
    (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string>, redirect: init.redirect })
      return new Response(body, { status })
    }) as typeof fetch
  await expect(
    gitlabApi({ origin: 'gitlab.com', token: 't', fetch: reply(200, '{"username":"ana"}') }, '/user'),
  ).resolves.toEqual({ username: 'ana' })
  expect(seen[0]).toEqual({
    url: 'https://gitlab.com/api/v4/user',
    headers: { 'PRIVATE-TOKEN': 't', Accept: 'application/json' },
    redirect: 'error',
  })
  await expect(
    gitlabApi({ origin: 'gitlab.com', token: 't', fetch: reply(401, 'token t is bad') }, '/user'),
  ).rejects.toMatchObject({ availability: 'signed-out', message: expect.not.stringContaining('token t') })
  await expect(gitlabApi({ origin: 'gitlab.com', token: 't', fetch: reply(500, 'secret') }, '/user')).rejects.toThrow(
    'GitLab answered 500',
  )
})

it('uses GITLAB_TOKEN only for gitlab.com or the server GITLAB_HOST names', async () => {
  const env = { GLAB_CONFIG_DIR: '/nonexistent', XDG_CONFIG_HOME: '/nonexistent', GITLAB_TOKEN: 'env-token' }
  expect(await gitlabToken('gitlab.com', env)).toEqual({ token: 'env-token', source: 'environment' })
  expect(await gitlabToken('code.example.com', env)).toBeNull()
  expect(await gitlabToken('code.example.com', { ...env, GITLAB_HOST: 'https://code.example.com/' })).toEqual({
    token: 'env-token',
    source: 'environment',
  })
})

it('lists the GitLab servers a host can use and checks who each sign-in is without returning tokens', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-glab-'))
  try {
    writeFileSync(join(dir, 'config.yml'), 'hosts:\n  gitlab.example.com:\n    token: glpat-secret\n')
    const env = { GLAB_CONFIG_DIR: dir, GITLAB_TOKEN: 'glpat-env' }
    const listed = await gitlabSummary(false, { env, hasCli: true })
    expect(listed).toEqual({
      cli: 'installed',
      accounts: [
        { origin: 'gitlab.example.com', source: 'cli', login: null, state: 'unchecked' },
        { origin: 'gitlab.com', source: 'environment', login: null, state: 'unchecked' },
      ],
    })
    const fetch = vi.fn(async (url: string) =>
      url.startsWith('https://gitlab.com/')
        ? new Response('', { status: 401 })
        : new Response(JSON.stringify({ username: 'ahxar' }), { status: 200 }),
    )
    const checked = await gitlabSummary(true, {
      env,
      hasCli: false,
      fetch: fetch as unknown as typeof globalThis.fetch,
    })
    expect(checked.cli).toBe('no-cli')
    expect(checked.accounts[0]).toMatchObject({ login: 'ahxar', state: 'ok' })
    expect(checked.accounts[1]).toMatchObject({ state: 'failed', error: expect.stringContaining('expired') })
    expect(JSON.stringify(checked)).not.toContain('glpat')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('uses a token saved in Settings for its own server first, and lists it without the secret', async () => {
  const secrets = new Map<string, string>()
  const store = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => void secrets.set(key, value),
    getPassword: async () => secrets.get(key) ?? null,
    deletePassword: async () => secrets.delete(key),
  }))
  store.verify = async () => {}
  const state = new Map<string, unknown>()
  const saved = new GitlabCredentials(
    (key, fallback) => (state.get(key) ?? fallback) as never,
    (key, value) => void state.set(key, value),
    store,
  )
  configureGitlabCredentials(saved)
  try {
    await saved.save({ origin: 'code.example.com', token: 'glpat-saved' })
    const env = { GLAB_CONFIG_DIR: '/nonexistent', GITLAB_TOKEN: 'env-token', GITLAB_HOST: 'code.example.com' }
    expect(await gitlabToken('code.example.com', env)).toEqual({ token: 'glpat-saved', source: 'saved' })
    // Another server never gets it.
    expect(await gitlabToken('gitlab.com', { GLAB_CONFIG_DIR: '/nonexistent', GITLAB_TOKEN: 'e' })).toEqual({
      token: 'e',
      source: 'environment',
    })
    const listed = await gitlabSummary(false, { env, hasCli: false })
    expect(listed.accounts).toEqual([{ origin: 'code.example.com', source: 'saved', login: null, state: 'unchecked' }])
    expect(JSON.stringify(listed)).not.toContain('glpat')
    await saved.remove()
    expect(await gitlabToken('code.example.com', env)).toEqual({ token: 'env-token', source: 'environment' })
  } finally {
    configureGitlabCredentials(null)
  }
})
