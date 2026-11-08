// Supabase's Management API with the person's own access token. A Supabase project is the database. Branching needs a
// paid plan and its GitHub integration, so previews and development get a second project of their own,
// `<name>-preview`, and never touch production data. Pull requests share that project; there is no branch per pull
// request. Ramu sets each project's database password itself and keeps it only in this host's credential store.
import { randomBytes } from 'node:crypto'
import { DeployError, platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ProvisionedResource, type ResourceAdapter } from './resource'

interface SupabaseProject {
  /** The project ref, which names it in every path and host. */
  ref?: string
  id: string
  name: string
  organization_slug?: string
  organization_id?: string
  status?: string
  created_at?: string
}

interface Pooler {
  database_type?: string
  db_user: string
  db_host: string
  db_port: number
  db_name: string
}

/** The session pooler's port, which takes migrations and reaches the database over IPv4 on every plan. */
const SESSION_PORT = 5432
/**
 * How recently a project of the same name must have been made for Ramu to take it as its own unfinished one. An
 * older project is someone's existing database, whose password Ramu never changes.
 */
const OWN_WITHIN_MS = 60 * 60_000
/** A new project takes a minute or two before its database answers. */
const READY_TIMEOUT_MS = 5 * 60_000

const password = () => randomBytes(24).toString('base64url')
const refOf = (project: SupabaseProject) => project.ref ?? project.id

/** The request counts Supabase's usage endpoint reports, with the name the sheet shows for each. */
const SUPABASE_REQUESTS = [
  ['total_rest_requests', 'Database API requests'],
  ['total_auth_requests', 'Auth requests'],
  ['total_storage_requests', 'Storage requests'],
  ['total_realtime_requests', 'Realtime requests'],
] as const
type SupabaseRequestCount = (typeof SUPABASE_REQUESTS)[number][0]

/** Supabase, reached at `api` (the real API unless a test points it at a fake server). */
export function supabaseAdapter(
  options: { api?: string; fetch?: typeof fetch; pause?: (ms: number) => Promise<void> } = {},
): ResourceAdapter {
  const api = options.api ?? 'https://api.supabase.com/v1'
  const fetcher = options.fetch ?? fetch
  const pause = options.pause ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>('Supabase', fetcher, `${api}${path}`, { ...init, token: auth.token }, what)
  const project = (ref: string) => `/projects/${encodeURIComponent(ref)}`
  const organization = async (auth: HostingAuth) => {
    const [first] = await call<{ id: string; slug?: string; name: string }[]>(
      '/organizations',
      auth,
      'reading the organizations',
    )
    if (!first) throw new Error('This Supabase account has no organization. Create one on Supabase, then try again.')
    return { slug: first.slug ?? first.id, name: first.name }
  }
  const ready = async (auth: HostingAuth, ref: string) => {
    const deadline = Date.now() + READY_TIMEOUT_MS
    for (;;) {
      const { status } = await call<SupabaseProject>(project(ref), auth, 'reading the project')
      if (status === 'ACTIVE_HEALTHY') return
      if (status && /FAILED|REMOVED/.test(status))
        throw new Error(`The Supabase project is ${status.toLowerCase().replace(/_/g, ' ')}. Open it on Supabase.`)
      if (Date.now() > deadline)
        throw new Error('The Supabase project is still starting. Provision again in a few minutes to finish.')
      await pause(5_000)
    }
  }
  /** The pooled address for the app (transaction mode) and the session pooler's for migrations. */
  const connection = async (auth: HostingAuth, ref: string, secret: string) => {
    await ready(auth, ref)
    const poolers = await call<Pooler[]>(`${project(ref)}/config/database/pooler`, auth, 'reading the pooler')
    const pooler = poolers.find((entry) => entry.database_type === 'PRIMARY') ?? poolers[0]
    if (!pooler) throw new Error('Supabase reported no connection pooler for the project. Try again in a moment.')
    const address = (port: number) =>
      `postgresql://${encodeURIComponent(pooler.db_user)}:${encodeURIComponent(secret)}@${pooler.db_host}:${port}/${encodeURIComponent(pooler.db_name)}`
    return { DATABASE_URL: address(pooler.db_port), DATABASE_URL_UNPOOLED: address(SESSION_PORT) }
  }
  /** A project of that name that Ramu made in the last hour; an older one of that name is refused. */
  const named = async (auth: HostingAuth, name: string) => {
    const found = (await call<SupabaseProject[]>('/projects', auth, 'listing projects')).find(
      (entry) => entry.name === name,
    )
    if (!found) return null
    const made = Date.parse(found.created_at ?? '')
    if (!(Date.now() - made < OWN_WITHIN_MS))
      throw new Error(
        `A Supabase project named ${name} already exists. Ramu does not take over a database it did not make: rename that project on Supabase, or set its connection values yourself in Environment variables.`,
      )
    return found
  }
  /** An existing project's values: its password is set anew, since Supabase never shows it again. */
  const reuse = async (auth: HostingAuth, found: SupabaseProject): Promise<ProvisionedResource> => {
    const secret = password()
    await call(`${project(refOf(found))}/database/password`, auth, 'setting the database password', {
      method: 'PATCH',
      body: JSON.stringify({ password: secret }),
    })
    return { id: refOf(found), name: found.name, variables: await connection(auth, refOf(found), secret) }
  }
  const create = async (auth: HostingAuth, name: string): Promise<ProvisionedResource> => {
    const { slug } = await organization(auth)
    const secret = password()
    const created = await call<SupabaseProject>('/projects', auth, 'creating the database', {
      method: 'POST',
      body: JSON.stringify({ name, organization_slug: slug, db_pass: secret }),
    })
    return { id: refOf(created), name: created.name, variables: await connection(auth, refOf(created), secret) }
  }
  /** A project of that name is used instead of a second one, so a provision that stopped part way can finish. */
  const ensure = async (auth: HostingAuth, name: string) => {
    const found = await named(auth, name)
    return found ? reuse(auth, found) : create(auth, name)
  }
  return {
    id: 'supabase',
    name: 'Supabase',
    kind: 'database',
    tokenPage: 'https://supabase.com/dashboard/account/tokens',
    plans: [
      {
        id: 'default',
        name: 'Your Supabase plan',
        summary:
          'Postgres on your organization’s plan, with a second project for previews; the free plan allows two projects and pauses them after a week without use.',
      },
    ],
    async account(auth) {
      const { slug, name } = await organization(auth)
      // Supabase access tokens reach every organization of the account; Ramu creates projects in the first one.
      return { id: slug, name, defaultScope: null, broadScope: null, expiresAt: null }
    },
    provision: (auth, target) => ensure(auth, target.name),
    async find(auth, name) {
      const found = await named(auth, name)
      return found ? reuse(auth, found) : null
    },
    page: (id) => `https://supabase.com/dashboard/project/${encodeURIComponent(id)}`,
    async usage(auth, id) {
      // Supabase's API counts requests over at most the last seven days, so the figures cover that span, not the
      // billing period, and its plan quotas are not in the API, so none is shown or guessed.
      const counts = await call<{ result?: Partial<Record<SupabaseRequestCount, number>>[]; error?: unknown }>(
        `${project(id)}/analytics/endpoints/usage.api-counts?interval=7day`,
        auth,
        'reading usage',
      )
      if (counts.error) throw new DeployError('Supabase did not report usage for this project.', 'not-found')
      const rows = counts.result ?? []
      const end = Date.now()
      return {
        period: { start: end - 7 * 24 * 60 * 60_000, end },
        figures: SUPABASE_REQUESTS.map(([key, service]) => ({
          metric: 'service' as const,
          service,
          used: rows.reduce((sum, row) => sum + (row[key] ?? 0), 0),
          unit: 'requests',
          limit: null,
        })),
        billingPage: 'https://supabase.com/dashboard/org/_/usage',
      }
    },
    async branch(auth, id, name) {
      const { name: main } = await call<SupabaseProject>(project(id), auth, 'reading the project')
      return (await ensure(auth, `${main}-${name}`)).variables
    },
  }
}

registerResourceAdapter(supabaseAdapter())
