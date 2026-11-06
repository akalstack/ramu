import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import {
  azureApi,
  azureMergeOptions,
  htmlText,
  parseAzureRemote,
  parseChecks,
  parseListPullRequest,
  parsePullRequest,
  parseRepositories,
  parseThreads,
  pullRequestAction,
  reviewDecision,
} from '../src/workspace/forge/azure'
import { AzureCredentials, azureCredential } from '../src/workspace/forge/azureCredentials'
import { BitbucketCredentials } from '../src/workspace/forge/bitbucketCredentials'
import { HostCredentialStore } from '../src/credentials/store'
import { adapterFor, adapterForOrigin } from '../src/workspace/forge/route'

const repo = { organization: 'acme', project: 'Web App', repo: 'site' }
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

it('reads organization, project and repository from every Azure Repos remote form, and nothing else', () => {
  const expected = { organization: 'acme', project: 'Web App', repo: 'site' }
  expect(parseAzureRemote('https://dev.azure.com/acme/Web%20App/_git/site')).toEqual(expected)
  expect(parseAzureRemote('https://acme@dev.azure.com/acme/Web%20App/_git/site')).toEqual(expected)
  expect(parseAzureRemote('https://acme.visualstudio.com/Web%20App/_git/site')).toEqual(expected)
  expect(parseAzureRemote('https://acme.visualstudio.com/DefaultCollection/Web%20App/_git/site')).toEqual(expected)
  expect(parseAzureRemote('git@ssh.dev.azure.com:v3/acme/Web%20App/site')).toEqual(expected)
  expect(parseAzureRemote('ssh://git@ssh.dev.azure.com/v3/acme/Web%20App/site')).toEqual(expected)
  expect(parseAzureRemote('acme@vs-ssh.visualstudio.com:v3/acme/Web%20App/site')).toEqual(expected)
  // A repository named like its project may leave the project out.
  expect(parseAzureRemote('https://dev.azure.com/acme/_git/site')).toEqual({ ...expected, project: 'site' })
  expect(parseAzureRemote('https://user:secret@dev.azure.com/acme/p/_git/site')).toBeNull()
  expect(parseAzureRemote('https://github.com/acme/site.git')).toBeNull()
  expect(parseAzureRemote('https://dev.azure.com/acme/p')).toBeNull()
  expect(parseAzureRemote('https://dev.azure.com/acme/%2E%2E/_git/site')).toBeNull()
})

it('routes Azure DevOps origins and checkouts to their own adapter', async () => {
  expect((await adapterForOrigin('dev.azure.com')).id).toBe('azure')
  expect((await adapterForOrigin('acme.visualstudio.com')).id).toBe('azure')
  const dir = mkdtempSync(join(tmpdir(), 'ramu-azure-route-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'git@ssh.dev.azure.com:v3/acme/web/site'], { cwd: dir })
  expect((await adapterFor(dir)).id).toBe('azure')
})

it('reads the latest status per context and every build policy as checks', () => {
  const checks = parseChecks(
    [
      { id: 1, state: 'pending', context: { name: 'lint', genre: 'ci' } },
      { id: 2, state: 'failed', context: { name: 'lint', genre: 'ci' }, targetUrl: 'https://ci/2' },
      { id: 3, state: 'succeeded', context: { name: 'scan' } },
    ],
    [
      {
        status: 'rejected',
        configuration: { type: { id: '0609b952-1397-4640-95ec-e00a01b2c241' }, settings: { displayName: 'PR build' } },
        context: { buildId: 42 },
      },
      {
        status: 'notApplicable',
        configuration: { type: { id: '0609b952-1397-4640-95ec-e00a01b2c241' } },
      },
      // Reviewer counts and other policies are not builds.
      { status: 'rejected', configuration: { type: { id: 'reviewers', displayName: 'Minimum reviewers' } } },
    ],
    repo,
  )
  expect(checks).toEqual([
    { name: 'ci/lint', state: 'failure', url: 'https://ci/2' },
    { name: 'PR build', state: 'failure', url: 'https://dev.azure.com/acme/Web%20App/_build/results?buildId=42' },
    { name: 'scan', state: 'success', url: null },
  ])
})

it('maps votes and required reviewers onto the shared review decision and pull request shape', () => {
  expect(reviewDecision([{ vote: 10 }, { vote: -5 }])).toBe('changes-requested')
  expect(reviewDecision([{ vote: 10 }, { vote: 0, isRequired: true }])).toBe('review-required')
  expect(reviewDecision([{ vote: 5 }, { vote: 0 }])).toBe('approved')
  expect(reviewDecision([{ vote: 0 }])).toBe('review-required')
  expect(reviewDecision([])).toBeNull()
  const pr = parsePullRequest(
    {
      pullRequestId: 7,
      title: 'Fix login',
      status: 'completed',
      isDraft: false,
      sourceRefName: 'refs/heads/fix/login',
      targetRefName: 'refs/heads/main',
      lastMergeSourceCommit: { commitId: 'abc123' },
    },
    [],
    repo,
  )
  expect(pr).toMatchObject({
    number: 7,
    url: 'https://dev.azure.com/acme/Web%20App/_git/site/pullrequest/7',
    state: 'merged',
    baseBranch: 'main',
    headBranch: 'fix/login',
    headCommit: 'abc123',
    reviewDecision: null,
  })
})

const listRow = {
  pullRequestId: 7,
  title: 'Fix login',
  status: 'active' as const,
  sourceRefName: 'refs/heads/fix/login',
  targetRefName: 'refs/heads/main',
  lastMergeSourceCommit: { commitId: 'abc123' },
  createdBy: { id: 'u-ana', displayName: 'Ana' },
  reviewers: [
    { id: 'u-bo', displayName: 'Bo', vote: 10 },
    { id: 'g-team', displayName: 'Web Team', vote: 0, isContainer: true },
  ],
  mergeStatus: 'conflicts' as const,
  creationDate: '2026-01-02T00:00:00Z',
}

it('lists pull requests grouped by the viewer’s part in them, with their merge status', () => {
  expect(parseListPullRequest(listRow, repo, 'u-ana')).toMatchObject({
    number: 7,
    url: 'https://dev.azure.com/acme/Web%20App/_git/site/pullrequest/7',
    author: 'Ana',
    fork: false,
    reviewDecision: 'approved',
    checks: null,
    mergeable: 'conflicts',
    openThreads: null,
    requestedReviewers: ['Bo', 'Web Team'],
    group: 'mine',
    updatedAt: Date.parse('2026-01-02T00:00:00Z'),
  })
  expect(parseListPullRequest(listRow, repo, 'u-bo').group).toBe('review')
  expect(parseListPullRequest({ ...listRow, forkSource: {}, mergeStatus: 'queued' }, repo, null)).toMatchObject({
    group: 'other',
    fork: true,
    mergeable: 'unknown',
  })
})

it('offers the merge types branch policy allows and explains what blocks completion', () => {
  const limit = {
    status: 'approved' as const,
    configuration: {
      type: { id: 'FA4E907D-C16B-4A4C-9DFA-4916E5D171AB' },
      isBlocking: true,
      settings: { allowSquash: true, allowNoFastForward: false, allowRebase: true },
    },
  }
  const clean = { ...listRow, mergeStatus: 'succeeded' as const }
  expect(azureMergeOptions(clean, [], [limit])).toEqual({
    methods: ['squash', 'rebase'],
    blockers: [],
    canDeleteBranch: true,
  })
  expect(azureMergeOptions(clean, [], []).methods).toEqual(['squash', 'merge', 'rebase'])
  const options = azureMergeOptions(
    { ...listRow, isDraft: true },
    [{ name: 'Build', state: 'failure', url: null }],
    [
      limit,
      { status: 'queued', configuration: { type: { id: 'fd2167ab-b0be-447a-8ec8-39368250530e' }, isBlocking: true } },
      { status: 'running', configuration: { type: { id: '0609b952-1397-4640-95ec-e00a01b2c241' }, isBlocking: true } },
      { status: 'queued', configuration: { type: { id: 'optional-policy' }, isBlocking: false } },
    ],
  )
  expect(options.blockers).toEqual([
    'It is a draft. Publish it for review first.',
    'It has conflicts with its target branch.',
    'Some checks are failing.',
    'Branch policies are blocking it: required reviewers or comments are missing.',
    'Required builds are still running.',
  ])
})

it('reads threads without system notes, resolved by status, with every member’s comment trusted', () => {
  const threads = parseThreads([
    {
      id: 1,
      status: 'fixed',
      threadContext: { filePath: '/src/a.ts', rightFileStart: { line: 12 } },
      comments: [
        { id: 1, content: ' Handle null ', author: { displayName: 'Rina' }, publishedDate: '2026-01-02T00:00:00Z' },
        { id: 2, content: 'Done', author: { displayName: 'Ana' } },
      ],
    },
    { id: 2, status: 'active', comments: [{ id: 1, content: 'Ahmad voted 10', commentType: 'system' }] },
    { id: 3, status: 'active', isDeleted: true, comments: [{ id: 1, content: 'gone' }] },
    { id: 4, status: 'active', comments: [{ id: 1, content: 'Why?', author: { displayName: 'Eve' } }] },
    {
      id: 5,
      comments: [{ id: 1, content: 'Build passed', author: { displayName: 'Web App Build Service (acme)' } }],
    },
  ])
  expect(threads.map((thread) => [thread.id, thread.resolved, thread.resolvable, thread.outdated])).toEqual([
    ['1', true, true, false],
    ['4', false, true, false],
    ['5', false, false, false],
  ])
  expect(threads[0]).toMatchObject({ path: 'src/a.ts', line: 12 })
  expect(threads[0]!.comments[0]).toEqual({
    id: '1/1',
    author: 'Rina',
    bot: false,
    trusted: true,
    body: 'Handle null',
    createdAt: Date.parse('2026-01-02T00:00:00Z'),
  })
  expect(threads[2]!.comments[0]!.bot).toBe(true)
})

it('treats a completion whose reply was lost as done when Azure DevOps shows it completed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-azure-merge-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q', '-b', 'fix/login'], { cwd: dir })
  execFileSync('git', ['remote', 'add', 'origin', 'https://dev.azure.com/acme/Web%20App/_git/site'], { cwd: dir })
  vi.stubEnv('AZURE_DEVOPS_EXT_PAT', 'pat')
  let completedAfter = true
  let reads = 0
  const patches: unknown[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://dev.azure.com/acme/Web%20App/_apis/git/repositories/site/pullrequests/7?')) {
        if (init?.method === 'PATCH') {
          patches.push(JSON.parse(String(init.body)))
          return new Response('', { status: 502 })
        }
        reads++
        return new Response(
          JSON.stringify({ ...listRow, status: reads > 1 && completedAfter ? 'completed' : 'active' }),
        )
      }
      return new Response('', { status: 404 })
    }),
  )
  const url = 'https://dev.azure.com/acme/Web%20App/_git/site/pullrequest/7'
  try {
    await expect(
      pullRequestAction(dir, url, { kind: 'merge', method: 'squash', deleteBranch: true }),
    ).resolves.toBeUndefined()
    expect(patches[0]).toEqual({
      status: 'completed',
      lastMergeSourceCommit: { commitId: 'abc123' },
      completionOptions: { mergeStrategy: 'squash', deleteSourceBranch: true },
    })
    completedAfter = false
    reads = 0
    await expect(pullRequestAction(dir, url, { kind: 'merge', method: 'merge', deleteBranch: false })).rejects.toThrow(
      'Azure DevOps answered 502',
    )
    await expect(pullRequestAction(dir, url, { kind: 'update-branch' })).rejects.toThrow('cannot update')
  } finally {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

it('never keeps the organization Azure puts in clone addresses, and skips disabled repositories', () => {
  const repos = parseRepositories([
    {
      name: 'site',
      remoteUrl: 'https://acme@dev.azure.com/acme/Web%20App/_git/site',
      project: { name: 'Web App', visibility: 'private', lastUpdateTime: '2026-10-01T00:00:00Z' },
    },
    { name: 'old', remoteUrl: 'https://dev.azure.com/acme/x/_git/old', isDisabled: true, project: { name: 'x' } },
  ])
  expect(repos).toEqual([
    {
      fullName: 'Web App/site',
      description: null,
      private: true,
      cloneUrl: 'https://dev.azure.com/acme/Web%20App/_git/site',
      updatedAt: Date.parse('2026-10-01T00:00:00Z'),
    },
  ])
})

it('reads work item descriptions as text', () => {
  expect(htmlText('<div>Steps:<br>1. Open &amp; log in</div><p>Expect &lt;ok&gt;</p>')).toBe(
    'Steps:\n1. Open & log in\nExpect <ok>',
  )
})

it('signs requests with the token only, to dev.azure.com with an API version, and explains a refused token', async () => {
  const seen: { url: string; auth: string }[] = []
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    seen.push({ url, auth: String((init?.headers as Record<string, string>).Authorization) })
    // A refused token gets a sign-in page with 203.
    return seen.length === 2 ? new Response('<html>', { status: 203 }) : new Response('{"value":[]}')
  }) as unknown as typeof globalThis.fetch
  await azureApi({ token: 'pat', fetch }, '/acme/_apis/git/repositories?$top=1')
  expect(seen[0]).toEqual({
    url: 'https://dev.azure.com/acme/_apis/git/repositories?$top=1&api-version=7.1',
    auth: `Basic ${Buffer.from(':pat').toString('base64')}`,
  })
  await expect(azureApi({ token: 'old', fetch }, '/acme/_apis/connectionData')).rejects.toThrow(/did not accept/)
})

it("uses the Azure CLI's token from the environment, with its organization", async () => {
  expect(await azureCredential({ AZURE_DEVOPS_EXT_PAT: 'p', AZURE_DEVOPS_ORG: 'acme' })).toEqual({
    token: 'p',
    organization: 'acme',
    source: 'environment',
  })
  expect(await azureCredential({})).toBeNull()
})

it('keeps hosting secrets in the credential store and only the shown field in state', async () => {
  const secrets = new Map<string, string>()
  const store = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => void secrets.set(key, value),
    getPassword: async () => secrets.get(key) ?? null,
    deletePassword: async () => secrets.delete(key),
  }))
  store.verify = async () => {}
  const state = new Map<string, unknown>()
  const get = (key: string, fallback: unknown) => (state.get(key) ?? fallback) as never
  const set = (key: string, value: unknown) => void state.set(key, value)
  const azure = new AzureCredentials(get, set, store)
  expect(azure.saved()).toBeNull()
  await azure.save({ organization: 'acme', token: 'secret-pat' })
  expect(azure.saved()).toEqual({ organization: 'acme' })
  expect(JSON.stringify([...state.values()])).not.toContain('secret-pat')
  expect(await new AzureCredentials(get, set, store).read()).toEqual({ organization: 'acme', token: 'secret-pat' })
  await azure.remove()
  expect(azure.saved()).toBeNull()
  // A Bitbucket credential saved before keeps its email under the same key.
  const bitbucket = new BitbucketCredentials(get, set, store)
  await bitbucket.save({ email: 'a@b.co', token: 'tok' })
  expect(state.get('bitbucket-credential')).toMatchObject({ email: 'a@b.co' })
  expect(bitbucket.saved()).toEqual({ email: 'a@b.co' })
})
