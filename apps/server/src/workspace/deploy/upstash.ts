// Upstash Redis through its Developer API, with the person's account email and a Developer API key saved together as
// `email:key` (the API takes them as Basic authentication). A database is the cache; previews and development get a
// second database, `<name>-preview`, so they never read or clear production's keys.
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ProvisionedResource, type ResourceAdapter } from './resource'

interface UpstashDatabase {
  database_id: string
  database_name: string
  endpoint: string
  port: number
  password?: string
  rest_token?: string
  /** Seconds since 1970. */
  creation_time?: number
}

/** How recently a database of the same name must have been made for Ramu to take it as its own unfinished one. */
const OWN_WITHIN_MS = 60 * 60_000

/** The Basic credentials from a saved `email:key`; refused in any other shape, so a bare key fails plainly. */
function basic(auth: HostingAuth): string {
  const separator = auth.token.indexOf(':')
  if (separator < 1 || separator === auth.token.length - 1)
    throw new Error(
      'Save the Upstash account as your email and Developer API key, joined by a colon (you@example.com:key).',
    )
  return `Basic ${Buffer.from(auth.token).toString('base64')}`
}

/** Upstash, reached at `api` (the real API unless a test points it at a fake server). */
export function upstashAdapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter {
  const api = options.api ?? 'https://api.upstash.com/v2'
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>(
      'Upstash',
      fetcher,
      `${api}${path}`,
      { ...init, token: '', headers: { ...(init.headers as Record<string, string>), Authorization: basic(auth) } },
      what,
    )
  const variables = (database: UpstashDatabase) => {
    if (!database.password || !database.rest_token)
      throw new Error(
        'Upstash did not return the database’s credentials. Turn off credential protection, or use a key with write access.',
      )
    return {
      REDIS_URL: `rediss://default:${encodeURIComponent(database.password)}@${database.endpoint}:${database.port}`,
      UPSTASH_REDIS_REST_URL: `https://${database.endpoint}`,
      UPSTASH_REDIS_REST_TOKEN: database.rest_token,
    }
  }
  const resource = (database: UpstashDatabase): ProvisionedResource => ({
    id: database.database_id,
    name: database.database_name,
    variables: variables(database),
  })
  /** A database of that name that Ramu made in the last hour, read with its credentials; an older one is refused. */
  const named = async (auth: HostingAuth, name: string) => {
    const found = (await call<UpstashDatabase[]>('/redis/databases', auth, 'listing databases')).find(
      (entry) => entry.database_name === name,
    )
    if (!found) return null
    if (!(Date.now() - (found.creation_time ?? 0) * 1000 < OWN_WITHIN_MS))
      throw new Error(
        `An Upstash database named ${name} already exists. Ramu does not take over a database it did not make: rename that one on Upstash, or set its values yourself in Environment variables.`,
      )
    return resource(
      await call<UpstashDatabase>(
        `/redis/database/${encodeURIComponent(found.database_id)}`,
        auth,
        'reading the database',
      ),
    )
  }
  const ensure = async (auth: HostingAuth, name: string) =>
    (await named(auth, name)) ??
    resource(
      await call<UpstashDatabase>('/redis/database', auth, 'creating the cache', {
        method: 'POST',
        body: JSON.stringify({ database_name: name, platform: 'aws', primary_region: 'us-east-1', tls: true }),
      }),
    )
  return {
    id: 'upstash',
    name: 'Upstash',
    kind: 'cache',
    tokenPage: 'https://console.upstash.com/account/api',
    plans: [
      {
        id: 'default',
        name: 'Your Upstash plan',
        summary: 'Redis in us-east-1 on your account’s plan, with a second database for previews.',
      },
    ],
    async account(auth) {
      await call('/redis/databases', auth, 'reading the account')
      const email = auth.token.slice(0, auth.token.indexOf(':'))
      // A Developer API key reaches every database of the account.
      return { id: email, name: email, defaultScope: null, broadScope: null, expiresAt: null }
    },
    provision: (auth, target) => ensure(auth, target.name),
    find: (auth, name) => named(auth, name),
    page: (id) => `https://console.upstash.com/redis/${encodeURIComponent(id)}`,
    async branch(auth, id, name) {
      const main = await call<UpstashDatabase>(`/redis/database/${encodeURIComponent(id)}`, auth, 'reading the cache')
      return (await ensure(auth, `${main.database_name}-${name}`)).variables
    },
  }
}

registerResourceAdapter(upstashAdapter())
