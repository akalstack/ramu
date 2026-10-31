import { expect, it } from 'vitest'
import {
  discussionsPrompt,
  gitlabApi,
  gitlabToken,
  jobState,
  parseJobs,
  parseMergeRequest,
  parseProjects,
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

it('turns only unresolved, human review threads into a prompt', () => {
  const mr = parseMergeRequest(
    {
      iid: 7,
      title: 'Add search',
      web_url: 'u',
      state: 'opened',
      target_branch: 'main',
      source_branch: 's',
    },
    false,
    [],
  )
  expect(discussionsPrompt(mr, [{ notes: [{ body: 'Looks good', resolvable: true, resolved: true }] }])).toBeNull()
  const prompt = discussionsPrompt(mr, [
    { notes: [{ body: 'changed the title', system: true }] },
    {
      notes: [
        {
          body: 'Handle empty input',
          resolvable: true,
          resolved: false,
          author: { username: 'ana' },
          position: { new_path: 'src/search.ts', new_line: 12 },
        },
        { body: 'Agreed', author: { username: 'bo' } },
      ],
    },
  ])
  expect(prompt).toContain('merge request !7 (Add search)')
  expect(prompt).toContain('src/search.ts:12: ana: Handle empty input')
  expect(prompt).toContain('bo: Agreed')
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
