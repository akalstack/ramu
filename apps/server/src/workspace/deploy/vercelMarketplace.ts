// A database from the Vercel Marketplace for a project deployed to Vercel, on the same Vercel sign-in. Vercel bills it
// and keeps its connection values: Ramu creates the store on a database integration the team installed (Neon,
// Supabase, Prisma Postgres and others), on the integration's free plan, and connects it to the project for
// production, preview and development, where Vercel sets the variables itself. Ramu never sees the values.
import { platformCall, type HostingAuth } from './adapter'
import { registerResourceAdapter, type ResourceAdapter } from './resource'

interface Configuration {
  id: string
  slug?: string
  integrationId?: string
}

interface Product {
  id: string
  slug?: string
  name?: string
  protocols?: Record<string, unknown>
}

interface Store {
  id?: string
  externalResourceId?: string
  name?: string
  directPartnerConsoleUrl?: string
  secrets?: { name: string }[]
}

const MARKETPLACE = 'https://vercel.com/marketplace?category=storage'

/** The Vercel Marketplace, reached at `api` (the real API unless a test points it at a fake server). */
export function vercelMarketplaceAdapter(options: { api?: string; fetch?: typeof fetch } = {}): ResourceAdapter {
  const api = options.api ?? 'https://api.vercel.com'
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}, query = {}) => {
    const params = new URLSearchParams({ ...query, ...(auth.scope ? { teamId: auth.scope } : {}) })
    return platformCall<T>(
      'Vercel',
      fetcher,
      `${api}${path}${params.size ? `?${params.toString()}` : ''}`,
      { ...init, token: auth.token },
      what,
    )
  }
  /** The first installed integration product that is a database (its storage protocol), with its configuration. */
  const database = async (auth: HostingAuth) => {
    const configurations = await call<Configuration[]>(
      '/v1/integrations/configurations',
      auth,
      'listing Marketplace integrations',
      {},
      { view: 'account', installationType: 'marketplace' },
    )
    for (const configuration of configurations) {
      const { products } = await call<{ products?: Product[] }>(
        `/v1/integrations/configuration/${encodeURIComponent(configuration.id)}/products`,
        auth,
        'listing the integration’s products',
      )
      const product = products?.find(
        (entry) => !!entry.protocols?.storage && /postgres|sql|database/i.test(`${entry.slug} ${entry.name}`),
      )
      if (product) return { configuration, product }
    }
    throw new Error(
      `Install a database integration from the Vercel Marketplace (such as Neon or Supabase) on this team first: ${MARKETPLACE}`,
    )
  }
  return {
    id: 'vercel-marketplace',
    name: 'Vercel Marketplace',
    kind: 'database',
    tokenPage: 'https://vercel.com/account/settings/tokens',
    plans: [
      {
        id: 'default',
        name: 'The integration’s free plan',
        summary:
          'Postgres from a database integration your Vercel team installed, billed through Vercel; Vercel sets its variables on the project.',
      },
    ],
    async account(auth) {
      const { user } = await call<{ user: { id: string; username?: string; email?: string } }>(
        '/v2/user',
        auth,
        'reading the account',
      )
      return {
        id: user.id,
        name: user.username ?? user.email ?? user.id,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    async provision(auth, target) {
      if (!target.site) throw new Error('Link the project to Vercel first.')
      const { configuration, product } = await database(auth)
      const { store } = await call<{ store: Store }>(
        '/v1/storage/stores/integration/direct',
        auth,
        'creating the database',
        {
          method: 'POST',
          body: JSON.stringify({
            name: target.name,
            integrationConfigurationId: configuration.id,
            integrationProductIdOrSlug: product.id,
            source: 'external',
          }),
        },
      )
      const id = store.id ?? store.externalResourceId
      if (!id) throw new Error('Vercel did not report the database it created. Check the team’s Storage page.')
      await call(
        `/v1/integrations/installations/${encodeURIComponent(configuration.id)}/resources/${encodeURIComponent(id)}/connections`,
        auth,
        'connecting the database to the project',
        {
          method: 'POST',
          body: JSON.stringify({
            projectId: target.site,
            envVarEnvironments: ['production', 'preview', 'development'],
            makeEnvVarsSensitive: true,
          }),
        },
      )
      return { id, name: store.name ?? target.name, variables: {} }
    },
    // Without the values, a store whose reply was lost cannot be taken over; it is removed on Vercel's Storage page.
    find: async () => null,
    page: () => 'https://vercel.com/dashboard/stores',
  }
}

registerResourceAdapter(vercelMarketplaceAdapter())
