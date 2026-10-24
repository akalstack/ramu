import { describe, expect, it } from 'vitest'
import {
  GithubApiError,
  apiPages,
  apiRequest,
  clearEtagCache,
  nextPageUrl,
  findPullRequest,
  jobLog,
  listIssuesDirect,
  reviewDecisionOf,
  type ApiAccess,
  type ApiFetch,
} from '../src/workspace/forge/githubApi'
import { parsePullRequest } from '../src/workspace/forge'

const access: ApiAccess = { origin: 'github.com', token: 'ghp_' + 'a'.repeat(30), owner: 'o', repo: 'r' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('direct GitHub API access', () => {
  it('sends the token only to the origin API and never follows redirects', async () => {
    const seen: { url: string; init: RequestInit }[] = []
    const fetchImpl: ApiFetch = async (url, init) => {
      seen.push({ url, init })
      return json({ ok: true })
    }
    await apiRequest(access, '/repos/o/r', { fetch: fetchImpl })
    expect(seen[0]!.url).toBe('https://api.github.com/repos/o/r')
    expect(seen[0]!.init.redirect).toBe('error')
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${access.token}`)
    await apiRequest({ ...access, origin: 'ghe.example.com' }, '/repos/o/r', { fetch: fetchImpl })
    expect(seen[1]!.url).toBe('https://ghe.example.com/api/v3/repos/o/r')
  })

  it('reports a rejected token as unauthorized and redacts provider text', async () => {
    const fetchImpl: ApiFetch = async () => json({ message: `bad ${access.token}` }, 401)
    const error = await apiRequest(access, '/user', { fetch: fetchImpl }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(GithubApiError)
    expect((error as GithubApiError).unauthorized).toBe(true)
    const forbidden: ApiFetch = async () => new Response(`limit for ${access.token}`, { status: 403 })
    const failed = (await apiRequest(access, '/user', { fetch: forbidden }).catch((e: unknown) => e)) as Error
    expect(failed.message).not.toContain(access.token)
  })

  it('maps pull request, checks and reviews to the shape the CLI path produces', async () => {
    const routes: Record<string, unknown> = {
      '/repos/o/r/pulls?head=o%3Afix&state=open&per_page=1&sort=updated&direction=desc': [
        {
          number: 7,
          title: 'Fix',
          html_url: 'https://github.com/o/r/pull/7',
          state: 'open',
          draft: false,
          base: { ref: 'main' },
          head: { ref: 'fix', sha: 'sha1' },
        },
      ],
      '/repos/o/r/pulls/7/reviews?per_page=100': [
        { state: 'APPROVED', user: { login: 'a' }, submitted_at: '2026-01-01' },
        { state: 'CHANGES_REQUESTED', user: { login: 'b' }, submitted_at: '2026-01-02' },
      ],
      '/repos/o/r/commits/sha1/check-runs?per_page=100': {
        check_runs: [
          {
            name: 'Build',
            status: 'completed',
            conclusion: 'failure',
            details_url: 'https://github.com/o/r/actions/runs/1/job/9',
          },
        ],
      },
      '/repos/o/r/commits/sha1/status?per_page=100': { statuses: [{ context: 'ci/legacy', state: 'success' }] },
    }
    const fetchImpl: ApiFetch = async (url) => {
      const path = url.replace('https://api.github.com', '')
      return path in routes ? json(routes[path]) : json({}, 404)
    }
    const raw = await findPullRequest(access, { branch: 'fix' }, fetchImpl)
    const parsed = parsePullRequest(raw as never)
    expect(parsed).toMatchObject({
      number: 7,
      state: 'open',
      baseBranch: 'main',
      headCommit: 'sha1',
      reviewDecision: 'changes-requested',
    })
    expect(parsed.checks).toEqual([
      { name: 'Build', state: 'failure', url: 'https://github.com/o/r/actions/runs/1/job/9' },
      { name: 'ci/legacy', state: 'success', url: null },
    ])
  })

  it('returns null for a branch with no pull request and fails loudly when checks cannot be read', async () => {
    const none: ApiFetch = async () => json([])
    expect(await findPullRequest(access, { branch: 'x' }, none)).toBeNull()
    const pull = {
      number: 1,
      title: 't',
      html_url: 'https://github.com/o/r/pull/1',
      state: 'open',
      base: { ref: 'main' },
      head: { ref: 'x', sha: 's' },
    }
    const broken: ApiFetch = async (url) =>
      url.includes('/pulls/1') || url.includes('pulls?') ? json(url.includes('?') ? [pull] : pull) : json({}, 500)
    await expect(findPullRequest(access, { branch: 'x' }, broken)).rejects.toBeInstanceOf(GithubApiError)
  })

  it('decides reviews per reviewer and lets a dismissal clear a request', () => {
    expect(reviewDecisionOf([])).toBeNull()
    expect(
      reviewDecisionOf([
        { state: 'CHANGES_REQUESTED', user: { login: 'a' }, submitted_at: '1' },
        { state: 'APPROVED', user: { login: 'a' }, submitted_at: '2' },
      ]),
    ).toBe('APPROVED')
    expect(
      reviewDecisionOf([
        { state: 'CHANGES_REQUESTED', user: { login: 'a' }, submitted_at: '1' },
        { state: 'DISMISSED', user: { login: 'a' }, submitted_at: '2' },
      ]),
    ).toBeNull()
  })

  it('drops pull requests from the issue list', async () => {
    const fetchImpl: ApiFetch = async () =>
      json([
        { number: 1, title: 'Bug', html_url: 'u1', labels: [{ name: 'bug' }], updated_at: '2026-01-01' },
        { number: 2, title: 'A PR', html_url: 'u2', pull_request: {} },
      ])
    expect(await listIssuesDirect(access, '', fetchImpl)).toEqual([
      { number: 1, title: 'Bug', url: 'u1', labels: ['bug'], updatedAt: '2026-01-01' },
    ])
  })

  it('fetches a job log from its signed location without the token', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl: ApiFetch = async (url, init) => {
      calls.push({ url, init })
      return url.startsWith('https://api.github.com')
        ? new Response(null, { status: 302, headers: { location: 'https://blob.example.com/log?sig=1' } })
        : new Response('log text')
    }
    expect(await jobLog(access, '9', fetchImpl)).toBe('log text')
    expect(calls[1]!.url).toBe('https://blob.example.com/log?sig=1')
    expect(calls[1]!.init.headers).toBeUndefined()
    const insecure: ApiFetch = async () =>
      new Response(null, { status: 302, headers: { location: 'http://blob.example.com/x' } })
    await expect(jobLog(access, '9', insecure)).rejects.toBeInstanceOf(GithubApiError)
  })
})

describe('paged GitHub lists', () => {
  const link = (next: string) => ({ link: `<${next}>; rel="next", <${next}>; rel="last"` })

  it('follows next links so a failing check on a later page is not missed', async () => {
    const calls: string[] = []
    const fetchImpl: ApiFetch = async (url) => {
      calls.push(url)
      return url.includes('page=2')
        ? json({ check_runs: [{ name: 'Late', status: 'completed', conclusion: 'failure' }] })
        : new Response(
            JSON.stringify({ check_runs: [{ name: 'Early', status: 'completed', conclusion: 'success' }] }),
            {
              headers: link('https://api.github.com/repos/o/r/commits/s/check-runs?per_page=100&page=2'),
            },
          )
    }
    const result = await apiPages<{ check_runs: { name: string }[] }, { name: string }>(
      access,
      '/repos/o/r/commits/s/check-runs?per_page=100',
      (page) => page.check_runs,
      { fetch: fetchImpl },
    )
    expect(result.items.map((i) => i.name)).toEqual(['Early', 'Late'])
    expect(result.truncated).toBe(false)
    expect(calls).toHaveLength(2)
  })

  it('never sends the token to a host the API did not name, and says when it stopped at the page limit', async () => {
    expect(nextPageUrl(link('https://evil.example.com/x?page=2').link!, access)).toBeNull()
    expect(nextPageUrl('<https://api.github.com.evil.example/x>; rel="next"', access)).toBeNull()
    expect(nextPageUrl('<http://api.github.com/x>; rel="next"', access)).toBeNull()
    expect(nextPageUrl(null, access)).toBeNull()
    const endless: ApiFetch = async () =>
      new Response('[1]', { headers: link('https://api.github.com/user/repos?page=9') })
    const result = await apiPages<number[], number>(access, '/user/repos', (page) => page, {
      fetch: endless,
      maxPages: 3,
    })
    expect(result).toEqual({ items: [1, 1, 1], truncated: true })
  })
})

describe('conditional reads', () => {
  it('asks again with If-None-Match and serves the saved answer on a 304, keeping its paging', async () => {
    clearEtagCache()
    const seen: (string | undefined)[] = []
    const fetchImpl: ApiFetch = async (_url, init) => {
      const sent = (init.headers as Record<string, string>)['If-None-Match']
      seen.push(sent)
      return sent
        ? new Response(null, { status: 304 })
        : new Response(JSON.stringify([{ id: 1 }]), {
            headers: {
              etag: 'W/"v1"',
              link: '<https://api.github.com/user/repos?page=2>; rel="next"',
            },
          })
    }
    const first = await apiRequest<{ id: number }[]>(access, '/user/repos', { fetch: fetchImpl })
    const second = await apiRequest<{ id: number }[]>(access, '/user/repos', { fetch: fetchImpl })
    expect(first).toEqual([{ id: 1 }])
    expect(second).toEqual([{ id: 1 }])
    expect(seen).toEqual([undefined, 'W/"v1"'])
  })

  it('keeps answers apart per account, never caches writes, and replaces a changed answer', async () => {
    clearEtagCache()
    let body = 'one'
    const sent: (string | undefined)[] = []
    const fetchImpl: ApiFetch = async (_url, init) => {
      sent.push((init.headers as Record<string, string>)['If-None-Match'])
      return new Response(JSON.stringify(body), { headers: { etag: `"${body}"` } })
    }
    await apiRequest(access, '/x', { fetch: fetchImpl })
    await apiRequest({ ...access, token: 'ghp_' + 'b'.repeat(30) }, '/x', { fetch: fetchImpl })
    expect(sent).toEqual([undefined, undefined])
    body = 'two'
    expect(await apiRequest(access, '/x', { fetch: fetchImpl })).toBe('two')
    expect(await apiRequest(access, '/x', { fetch: fetchImpl })).toBe('two')
    expect(sent.slice(2)).toEqual(['"one"', '"two"'])
    await apiRequest(access, '/x', { method: 'POST', body: {}, fetch: fetchImpl })
    expect(sent.at(-1)).toBeUndefined()
  })
})
