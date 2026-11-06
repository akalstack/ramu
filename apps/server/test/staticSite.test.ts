import { expect, it } from 'vitest'
import { cloudflareAssetHash, cloudflarePages, githubPages, netlify, vercel } from '../src/hosting/staticSite'

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

it('deploys to Netlify with digests, uploads what it asks for, and reuses the site next time', async () => {
  const { seen, fetcher } = platform([
    [/^POST .*\/sites$/, () => ({ body: { id: 'site1' } })],
    [
      /^POST .*\/sites\/site1\/deploys$/,
      (s) => ({ body: { id: 'd1', required: Object.values((s.body as { files: Record<string, string> }).files) } }),
    ],
    [/^PUT .*\/deploys\/d1\/files\/index.html$/, () => ({ body: {} })],
    [/^GET .*\/sites\/site1$/, () => ({ body: { ssl_url: 'https://trip.netlify.app' } })],
  ])
  expect(await netlify(fetcher).deploy(files, { name: 'Trip costs' }, 'tok')).toEqual({
    url: 'https://trip.netlify.app',
    siteId: 'site1',
  })
  expect(seen.every((entry) => entry.auth === 'Bearer tok')).toBe(true)
  seen.length = 0
  await netlify(fetcher).deploy(files, { name: 'Trip costs', siteId: 'site1' }, 'tok')
  expect(seen.some((entry) => entry.url.endsWith('/sites') && entry.method === 'POST')).toBe(false)
})

it('deploys to Vercel as a production deployment with inline files', async () => {
  const { seen, fetcher } = platform([
    [
      /deployments/,
      () => ({
        body: { id: 'x', url: 'trip-abc.vercel.app', alias: ['trip-costs-team-x.vercel.app'] },
      }),
    ],
    // The production domain appears on the project, not yet in the deployment's aliases.
    [
      /projects\/trip-costs\/domains/,
      () => ({ body: { domains: [{ name: 'trip-costs-team-x.vercel.app' }, { name: 'trip-costs.vercel.app' }] } }),
    ],
  ])
  expect(await vercel(fetcher).deploy(files, { name: 'Trip costs' }, 'tok')).toEqual({
    url: 'https://trip-costs.vercel.app',
    siteId: 'trip-costs',
  })
  expect(seen[0]!.body).toMatchObject({
    name: 'trip-costs',
    target: 'production',
    files: [{ file: 'index.html', encoding: 'base64' }],
  })
})

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

it('uploads to Cloudflare Pages by asset hash and deploys a manifest', async () => {
  const { seen, fetcher } = platform([
    [/^GET .*\/accounts$/, () => ({ body: { result: [{ id: 'acc' }] } })],
    [/^POST .*\/pages\/projects$/, () => ({ body: {} })],
    [/upload-token$/, () => ({ body: { result: { jwt: 'jwt' } } })],
    [/assets\/upload$/, () => ({ body: {} })],
    [/upsert-hashes$/, () => ({ body: {} })],
    [/deployments$/, () => ({ body: {} })],
  ])
  expect(await cloudflarePages(fetcher).deploy(files, { name: 'Trip costs' }, 'cf')).toEqual({
    url: 'https://trip-costs.pages.dev',
    siteId: 'trip-costs',
  })
  const hash = cloudflareAssetHash(files[0]!)
  expect(hash).toMatch(/^[0-9a-f]{32}$/)
  expect(seen.find((entry) => entry.url.endsWith('assets/upload'))?.auth).toBe('Bearer jwt')
  expect(JSON.parse((seen.at(-1)!.body as { manifest: string }).manifest)).toEqual({ '/index.html': hash })
})

it('says which step a refused token failed at, without echoing the platform', async () => {
  const { fetcher } = platform([[/sites$/, () => ({ status: 401, body: { message: 'secret detail' } })]])
  await expect(netlify(fetcher).deploy(files, { name: 'x' }, 'bad')).rejects.toThrow(
    'The token was refused while creating the site.',
  )
})

it('uses a saved Cloudflare account ID when the token cannot list accounts', async () => {
  const { seen, fetcher } = platform([
    [/^POST .*\/accounts\/acc2\/pages\/projects$/, () => ({ body: {} })],
    [/upload-token$/, () => ({ body: { result: { jwt: 'jwt' } } })],
    [/assets\/upload$/, () => ({ body: {} })],
    [/upsert-hashes$/, () => ({ body: {} })],
    [/deployments$/, () => ({ body: {} })],
  ])
  await cloudflarePages(fetcher).deploy(files, { name: 'Trip' }, 'acc2:cf')
  expect(seen.some((entry) => entry.url.endsWith('/accounts'))).toBe(false)
  expect(seen[0]!.auth).toBe('Bearer cf')
})
