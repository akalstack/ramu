import { expect, it } from 'vitest'
import { githubPages } from '../src/hosting/staticSite'

type Seen = { method: string; url: string; auth: string | null; body: unknown }
/** A fake platform: answers by URL pattern and records every request. */
function platform(routes: [RegExp, (seen: Seen) => { status?: number; body?: unknown }][]) {
  const seen: Seen[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body =
      typeof init?.body === 'string'
        ? JSON.parse(init.body)
        : init?.body instanceof FormData
          ? Object.fromEntries([...(init.body as unknown as Iterable<[string, unknown]>)])
          : (init?.body ?? null)
    const entry = {
      method: init?.method ?? 'GET',
      url,
      auth: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
      body,
    }
    seen.push(entry)
    const route = routes.find(([pattern]) => pattern.test(`${entry.method} ${url}`))
    const answer = route ? route[1](entry) : { status: 404 }
    return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), { status: answer.status ?? 200 })
  }) as typeof fetch
  return { seen, fetcher }
}
const files = [{ path: 'index.html', content: Buffer.from('<p>Trip</p>') }]

it('publishes to GitHub Pages through a repository and turns Pages on once', async () => {
  const { seen, fetcher } = platform([
    [/^GET .*\/user$/, () => ({ body: { login: 'Ahxar' } })],
    [/^POST .*\/user\/repos$/, () => ({ body: {} })],
    [/^GET .*\/contents\/index.html$/, () => ({ status: 404 })],
    [/^PUT .*\/contents\/index.html$/, () => ({ body: {} })],
    [/^GET .*\/pages$/, () => ({ status: 404 })],
    [/^POST .*\/pages$/, () => ({ body: {} })],
  ])
  expect(await githubPages(fetcher).deploy(files, { name: 'Trip costs' }, 'gh')).toEqual({
    url: 'https://ahxar.github.io/trip-costs/',
    siteId: 'trip-costs',
  })
  expect(seen.find((entry) => entry.method === 'POST' && entry.url.endsWith('/pages'))?.body).toEqual({
    source: { branch: 'main', path: '/' },
  })
  expect(seen[0]!.auth).toBe('token gh')
})

it('says which step a refused token failed at, without echoing the platform', async () => {
  const { fetcher } = platform([[/user$/, () => ({ status: 401, body: { message: 'secret detail' } })]])
  await expect(githubPages(fetcher).deploy(files, { name: 'x' }, 'bad')).rejects.toThrow(
    'The token was refused while reading the account.',
  )
})

it('leaves a file alone when the site already has the same bytes', async () => {
  const { createHash } = await import('node:crypto')
  const content = Buffer.from('<p>Trip</p>')
  const sha = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex')
  const { seen, fetcher } = platform([
    [/^GET .*\/user$/, () => ({ body: { login: 'me' } })],
    [/^GET .*\/contents\/index.html$/, () => ({ body: { sha } })],
    [/^GET .*\/contents\/sw.js$/, () => ({ body: { sha: 'old' } })],
    [/^PUT /, () => ({ body: {} })],
    [/^GET .*\/pages$/, () => ({ body: {} })],
  ])
  await githubPages(fetcher).deploy(
    [
      { path: 'index.html', content },
      { path: 'sw.js', content: Buffer.from('new') },
    ],
    { name: 'Trip costs', siteId: 'trip-costs' },
    'gh',
  )
  expect(seen.filter((entry) => entry.method === 'PUT').map((entry) => entry.url.split('/').pop())).toEqual(['sw.js'])
})
