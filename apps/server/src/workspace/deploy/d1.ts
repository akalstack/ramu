// Cloudflare D1 for a project deployed to Cloudflare Workers, on the same Cloudflare account and token as Pages and
// Workers. A Worker reaches D1 through a binding in its wrangler config rather than a connection address, so the
// resource sets no variables: Ramu makes a production database and a `<name>-preview` one for `wrangler dev`, and a
// pull request adds the binding. The token needs D1 edit.
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

interface D1Database {
  uuid: string
  name: string
}

/** D1, reached at `api` (the real API unless a test points it at a fake server). */
export function d1Adapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter & {
  /** The production and preview databases of a project's D1, for the wrangler binding. */
  databases(auth: HostingAuth, id: string): Promise<{ name: string; id: string; previewId: string }>
} {
  const api = options.api ?? 'https://api.cloudflare.com/client/v4'
  const fetcher = options.fetch ?? fetch
  const call = async <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) =>
    (await platformCall<{ result: T }>('Cloudflare', fetcher, `${api}${path}`, { ...init, token: auth.token }, what))
      .result
  const account = async (auth: HostingAuth) => {
    const [first] = await call<{ id: string; name: string }[]>(auth, '/accounts', 'reading the account')
    if (!first) throw new Error('This Cloudflare token reaches no account.')
    return first
  }
  const path = async (auth: HostingAuth, rest = '') =>
    `/accounts/${encodeURIComponent((await account(auth)).id)}/d1/database${rest}`
  const named = async (auth: HostingAuth, name: string) =>
    (
      await call<D1Database[]>(
        auth,
        await path(auth, `?${new URLSearchParams({ name }).toString()}`),
        'listing D1 databases',
      )
    ).find((entry) => entry.name === name) ?? null
  const ensure = async (auth: HostingAuth, name: string) =>
    (await named(auth, name)) ??
    (await call<D1Database>(auth, await path(auth), 'creating the D1 database', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }))
  const byId = async (auth: HostingAuth, id: string) =>
    call<D1Database>(auth, await path(auth, `/${encodeURIComponent(id)}`), 'reading the D1 database')
  return {
    id: 'cloudflare-d1',
    name: 'Cloudflare D1',
    kind: 'database',
    tokenPage: 'https://dash.cloudflare.com/profile/api-tokens',
    plans: [
      {
        id: 'default',
        name: 'Your Cloudflare plan',
        summary:
          'SQLite on your Cloudflare account, bound to the Worker as DB, with a second database for wrangler dev.',
      },
    ],
    async account(auth) {
      const found = await account(auth)
      return { id: found.id, name: found.name, defaultScope: found.id, broadScope: null, expiresAt: null }
    },
    async provision(auth, target) {
      const made = await ensure(auth, target.name)
      return { id: made.uuid, name: made.name, variables: {} }
    },
    async find(auth, name) {
      const found = await named(auth, name)
      return found ? { id: found.uuid, name: found.name, variables: {} } : null
    },
    page: (id) => `https://dash.cloudflare.com/?to=/:account/workers/d1/databases/${encodeURIComponent(id)}`,
    async branch(auth, id, name) {
      await ensure(auth, `${(await byId(auth, id)).name}-${name}`)
      return {}
    },
    async databases(auth, id) {
      const main = await byId(auth, id)
      const preview = await ensure(auth, `${main.name}-preview`)
      return { name: main.name, id: main.uuid, previewId: preview.uuid }
    },
  }
}

export const d1 = registerResourceAdapter(d1Adapter()) as ReturnType<typeof d1Adapter>
