// File storage on Supabase Storage, in the Supabase project Ramu made for the app's database, on the same Supabase
// access token. Ramu reads the project's secret key through the Management API and creates a private bucket named
// after the app through the project's own Storage API; the preview project gets its own bucket, so previews never
// touch production's files. The app reaches the bucket with the project's address and secret key, on the server only.
import { DeployError, platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

interface ApiKey {
  name?: string
  type?: string
  api_key?: string | null
}

interface SupabaseProject {
  id: string
  ref?: string
  name: string
}

/** A bucket id: lowercase letters, digits, dashes and underscores. */
const bucketOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63) || 'files'

/**
 * Supabase Storage, reached at `api` for the Management API and at `storage(ref)` for a project's Storage API (the
 * real ones unless a test points them at a fake server).
 */
export function supabaseStorageAdapter(
  options: { api?: string; storage?: (ref: string) => string; fetch?: typeof fetch } = {},
): ResourceAdapter {
  const api = options.api ?? 'https://api.supabase.com/v1'
  const storage = options.storage ?? ((ref: string) => `https://${ref}.supabase.co/storage/v1`)
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>('Supabase', fetcher, `${api}${path}`, { ...init, token: auth.token }, what)
  /** The project's secret key: a new-style secret key, else the legacy service_role key. */
  const secretKey = async (auth: HostingAuth, ref: string) => {
    const keys = await call<ApiKey[]>(
      `/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`,
      auth,
      'reading the project’s keys',
    )
    const key =
      keys.find((entry) => entry.type === 'secret' && entry.api_key)?.api_key ??
      keys.find((entry) => entry.name === 'service_role' && entry.api_key)?.api_key
    if (!key)
      throw new DeployError('Supabase did not reveal the project’s secret key to this token.', 'missing-permission')
    return key
  }
  /** Creates the bucket unless it exists, and returns the values the app reaches it with. */
  const bucket = async (auth: HostingAuth, ref: string, name: string) => {
    const key = await secretKey(auth, ref)
    const id = bucketOf(name)
    const response = await fetcher(`${storage(ref)}/bucket`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name: id, public: false }),
    })
    // A bucket made on an earlier try answers 409 (or 400 with "already exists"); it is used as it is.
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status !== 409 && !/already exists|Duplicate/i.test(text))
        throw new Error(`Supabase Storage refused the bucket (${response.status}).`)
    }
    return {
      SUPABASE_URL: `https://${ref}.supabase.co`,
      SUPABASE_SERVICE_ROLE_KEY: key,
      SUPABASE_STORAGE_BUCKET: id,
    }
  }
  const projects = (auth: HostingAuth) => call<SupabaseProject[]>('/projects', auth, 'listing projects')
  const refOf = (project: SupabaseProject) => project.ref ?? project.id
  return {
    id: 'supabase-storage',
    name: 'Supabase Storage',
    kind: 'storage',
    tokenPage: 'https://supabase.com/dashboard/account/tokens',
    plans: [
      {
        id: 'default',
        name: 'Your Supabase plan',
        summary: 'A private bucket in the app’s Supabase project, and one in its preview project.',
      },
    ],
    async account(auth) {
      const [first] = await call<{ id: string; slug?: string; name: string }[]>(
        '/organizations',
        auth,
        'reading the organizations',
      )
      if (!first) throw new Error('This Supabase account has no organization.')
      return { id: first.slug ?? first.id, name: first.name, defaultScope: null, broadScope: null, expiresAt: null }
    },
    async provision(auth, target) {
      if (target.database?.provider !== 'supabase')
        throw new Error('Provision a Supabase database for this app first; its storage goes in the same project.')
      return {
        id: target.database.id,
        name: target.name,
        variables: await bucket(auth, target.database.id, target.name),
      }
    },
    // The bucket is made again or reused by name, so a lost reply is recovered by provisioning again.
    find: async () => null,
    page: (id) => `https://supabase.com/dashboard/project/${encodeURIComponent(id)}/storage/buckets`,
    async branch(auth, id, name) {
      const all = await projects(auth)
      const main = all.find((entry) => refOf(entry) === id)
      const preview = main && all.find((entry) => entry.name === `${main.name}-${name}`)
      if (!main || !preview)
        throw new Error('The Supabase preview project is missing. Provision the database again to make it.')
      return bucket(auth, refOf(preview), main.name)
    },
  }
}

registerResourceAdapter(supabaseStorageAdapter())
