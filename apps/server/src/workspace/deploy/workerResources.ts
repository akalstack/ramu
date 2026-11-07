// Cloudflare's own resources for a project deployed to Cloudflare Workers: D1 (SQLite), KV and R2 buckets, on the
// same Cloudflare account and token as Pages and Workers. A Worker reaches each through a binding in its wrangler
// config rather than an address, so these resources set no variables: Ramu makes the resource and a `<name>-preview`
// copy for `wrangler dev`, and a pull request adds the binding. The token needs D1, Workers KV Storage or R2 edit.
import type { WorkerBindingType, WorkerPair } from '@ramu/shared/cloudflareDeploy'
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

export type WorkerProvider = 'cloudflare-d1' | 'cloudflare-kv' | 'cloudflare-r2'

/** The Worker type each provider binds as. */
export const WORKER_TYPE: Record<WorkerProvider, WorkerBindingType> = {
  'cloudflare-d1': 'D1Database',
  'cloudflare-kv': 'KVNamespace',
  'cloudflare-r2': 'R2Bucket',
}

export const isWorkerProvider = (provider: string): provider is WorkerProvider => provider in WORKER_TYPE

/** One resource as each API names it: its id (an R2 bucket's is its name) and its name. */
interface Found {
  id: string
  name: string
}

/** How one kind of resource is listed, made and read at Cloudflare. */
interface Kind {
  path: string
  list(result: unknown): Found[]
  one(result: unknown): Found
  body(name: string): unknown
}

const KINDS: Record<WorkerProvider, Kind> = {
  'cloudflare-d1': {
    path: 'd1/database',
    list: (result) =>
      (result as { uuid: string; name: string }[]).map((entry) => ({ id: entry.uuid, name: entry.name })),
    one: (result) => ({ id: (result as { uuid: string }).uuid, name: (result as { name: string }).name }),
    body: (name) => ({ name }),
  },
  'cloudflare-kv': {
    path: 'storage/kv/namespaces',
    list: (result) => (result as { id: string; title: string }[]).map((entry) => ({ id: entry.id, name: entry.title })),
    one: (result) => ({ id: (result as { id: string }).id, name: (result as { title: string }).title }),
    body: (name) => ({ title: name }),
  },
  'cloudflare-r2': {
    path: 'r2/buckets',
    list: (result) =>
      ((result as { buckets?: { name: string }[] }).buckets ?? []).map((entry) => ({
        id: entry.name,
        name: entry.name,
      })),
    one: (result) => ({ id: (result as { name: string }).name, name: (result as { name: string }).name }),
    body: (name) => ({ name }),
  },
}

const NAMES: Record<WorkerProvider, { name: string; summary: string; kind: ResourceAdapter['kind'] }> = {
  'cloudflare-d1': {
    name: 'Cloudflare D1',
    kind: 'database',
    summary: 'SQLite on your Cloudflare account, bound to the Worker, with a second database for wrangler dev.',
  },
  'cloudflare-kv': {
    name: 'Cloudflare KV',
    kind: 'cache',
    summary: 'A KV namespace on your Cloudflare account, bound to the Worker, with a second one for wrangler dev.',
  },
  'cloudflare-r2': {
    name: 'Cloudflare R2',
    kind: 'storage',
    summary: 'An R2 bucket on your Cloudflare account, bound to the Worker, with a second one for wrangler dev.',
  },
}

export type WorkerResourceAdapter = ResourceAdapter & {
  /** The resource and its preview copy, for the Worker's binding. */
  pair(auth: HostingAuth, id: string): Promise<WorkerPair>
}

/** One provider, reached at `api` (the real API unless a test points it at a fake server). */
export function workerResourceAdapter(
  provider: WorkerProvider,
  options: { api?: string; fetch?: typeof fetch } = {},
): WorkerResourceAdapter {
  const api = options.api ?? 'https://api.cloudflare.com/client/v4'
  const fetcher = options.fetch ?? fetch
  const kind = KINDS[provider]
  const call = async <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) =>
    (await platformCall<{ result: T }>('Cloudflare', fetcher, `${api}${path}`, { ...init, token: auth.token }, what))
      .result
  const account = async (auth: HostingAuth) => {
    const [first] = await call<{ id: string; name: string }[]>(auth, '/accounts', 'reading the account')
    if (!first) throw new Error('This Cloudflare token reaches no account.')
    return first
  }
  const path = async (auth: HostingAuth, rest = '') =>
    `/accounts/${encodeURIComponent((await account(auth)).id)}/${kind.path}${rest}`
  const named = async (auth: HostingAuth, name: string) =>
    kind
      .list(await call<unknown>(auth, await path(auth, '?per_page=100'), `listing ${NAMES[provider].name}`))
      .find((entry) => entry.name === name) ?? null
  const ensure = async (auth: HostingAuth, name: string) =>
    (await named(auth, name)) ??
    kind.one(
      await call<unknown>(auth, await path(auth), `creating the ${NAMES[provider].name} resource`, {
        method: 'POST',
        body: JSON.stringify(kind.body(name)),
      }),
    )
  const byId = async (auth: HostingAuth, id: string) =>
    kind.one(await call<unknown>(auth, await path(auth, `/${encodeURIComponent(id)}`), 'reading the resource'))
  return {
    id: provider,
    name: NAMES[provider].name,
    kind: NAMES[provider].kind,
    tokenPage: 'https://dash.cloudflare.com/profile/api-tokens',
    plans: [{ id: 'default', name: 'Your Cloudflare plan', summary: NAMES[provider].summary }],
    async account(auth) {
      const found = await account(auth)
      return { id: found.id, name: found.name, defaultScope: found.id, broadScope: null, expiresAt: null }
    },
    async provision(auth, target) {
      const made = await ensure(auth, target.name)
      return { id: made.id, name: made.name, variables: {} }
    },
    async find(auth, name) {
      const found = await named(auth, name)
      return found ? { id: found.id, name: found.name, variables: {} } : null
    },
    page: () => 'https://dash.cloudflare.com/',
    async branch(auth, id, name) {
      await ensure(auth, `${(await byId(auth, id)).name}-${name}`)
      return {}
    },
    async pair(auth, id) {
      const main = await byId(auth, id)
      const preview = await ensure(auth, `${main.name}-preview`)
      return { name: main.name, id: main.id, previewId: preview.id }
    },
  }
}

const registered = Object.fromEntries(
  (Object.keys(KINDS) as WorkerProvider[]).map((provider) => [
    provider,
    registerResourceAdapter(workerResourceAdapter(provider)) as WorkerResourceAdapter,
  ]),
) as Record<WorkerProvider, WorkerResourceAdapter>

/** The registered adapter for a provider. */
export const workerResource = (provider: WorkerProvider): WorkerResourceAdapter => registered[provider]
