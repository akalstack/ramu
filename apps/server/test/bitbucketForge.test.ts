import { expect, it, vi } from 'vitest'
import {
  bitbucketApi,
  commentsPrompt,
  parseBitbucketRemote,
  parsePullRequest,
  parseRepositories,
  parseStatuses,
  pipelineNumber,
  pullRequestFeedback,
} from '../src/workspace/forge/bitbucket'
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

it('turns only open top-level comments into a review prompt', () => {
  const pr = parsePullRequest(
    {
      id: 3,
      title: 'Add search',
      state: 'OPEN',
      source: { branch: { name: 's' } },
      destination: { branch: { name: 'main' } },
      links: { html: { href: 'https://bitbucket.org/a/b/pull-requests/3' } },
    },
    [],
  )
  const prompt = commentsPrompt(pr, [
    { content: { raw: 'Handle empty input' }, inline: { path: 'src/search.ts', to: 12 }, user: { nickname: 'dana' } },
    { content: { raw: 'Done already' }, resolution: { type: 'resolved' } },
    { content: { raw: 'A reply' }, parent: { id: 1 } },
    { content: { raw: 'Gone' }, deleted: true },
  ])
  expect(prompt).toContain('src/search.ts:12: dana: Handle empty input')
  expect(prompt).not.toMatch(/Done already|A reply|Gone/)
  expect(commentsPrompt(pr, [])).toBeNull()
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
    const prompt = await pullRequestFeedback(dir, 'checks')
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
