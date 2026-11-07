// Fly.io with the person's own token: its GraphQL API for the account and deploy tokens, and its Machines API for
// apps, secrets and certificates. Fly has no Git integration, so deploys run in the repository's GitHub Actions
// (`flyctl deploy` with an app-scoped deploy token); Ramu reads those runs and dispatches the same job for a production
// deploy or a rollback, as for the person's own server.
import { apexOf, recordName } from '@ramu/shared/domains'
import { FLY_WORKFLOW } from '@ramu/shared/flyDeploy'
import { actionsDeploys } from './actionsDeploys'
import {
  DeployError,
  graphqlCall,
  platformCall,
  registerHostingAdapter,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
  type PlatformDomain,
} from './adapter'

/**
 * Fly tokens are a user token, macaroons (`fm1r_`, `fm1a_`, `fm2_`) or both, comma-separated and optionally after a
 * `FlyV1` or `Bearer` scheme, as flyctl writes them. GraphQL takes all of them; the Machines API takes the macaroons
 * when there are any.
 */
export function flyAuthorization(token: string, api: 'graphql' | 'machines'): string {
  const parts = token
    .trim()
    .replace(/^(?:(?:FlyV1|Bearer)\s+)+/i, '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const macaroons = parts.filter((part) => /^(fm1r|fm1a|fm2)_/.test(part))
  const users = parts.filter((part) => !macaroons.includes(part))
  if (api === 'machines' && macaroons.length) return `FlyV1 ${macaroons.join(',')}`
  return `${macaroons.length ? 'FlyV1' : 'Bearer'} ${(api === 'graphql' ? [...macaroons, ...users] : users).join(',')}`
}

const APP_NAME = /^[a-z0-9-]{1,63}$/

/** The app a binding names, checked before it goes into a URL. */
function appOf(site: HostingSite): string {
  if (!APP_NAME.test(site.siteName))
    throw new DeployError('This project’s Fly app is not one Ramu set up. Link the project again.', 'not-found')
  return site.siteName
}

interface FlyCertificate {
  hostname: string
  configured?: boolean
  dns_requirements?: { a?: string[]; cname?: string }
}

/** Domains read per app, so an app with many certificates cannot fan out into hundreds of calls. */
const DOMAINS_READ = 20

/** Fly's GraphQL and Machines APIs, reached at `graphql` and `machines` unless a test points them at a fake server. */
export function flyApi(options: { graphql?: string; machines?: string; fetch?: typeof fetch } = {}) {
  const graphql = options.graphql ?? 'https://api.fly.io/graphql'
  const machinesUrl = options.machines ?? 'https://api.machines.dev/v1'
  const fetcher = options.fetch ?? fetch
  const gql = <T>(auth: HostingAuth, query: string, variables: Record<string, unknown>, what: string) =>
    graphqlCall<T>(
      'Fly.io',
      fetcher,
      graphql,
      { token: auth.token, headers: { Authorization: flyAuthorization(auth.token, 'graphql') } },
      query,
      variables,
      what,
    )
  const machines = <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) =>
    platformCall<T>(
      'Fly.io',
      fetcher,
      `${machinesUrl}${path}`,
      { ...init, token: auth.token, headers: { Authorization: flyAuthorization(auth.token, 'machines') } },
      what,
    )
  return {
    gql,
    machines,
    /** Whether the account reaches an app of this name. */
    async appExists(auth: HostingAuth, app: string): Promise<boolean> {
      if (!APP_NAME.test(app)) return false
      return machines(auth, `/apps/${app}`, 'reading the app').then(
        () => true,
        (error: unknown) => {
          if (error instanceof DeployError && error.kind === 'not-found') return false
          throw error
        },
      )
    },
    /** Creates the app in the organization; app names are global on Fly, so a taken one gets a short suffix. */
    async createApp(auth: HostingAuth, name: string, organization: string): Promise<string> {
      for (const candidate of [name, `${name.slice(0, 56)}-${Date.now().toString(36).slice(-6)}`]) {
        const created = await machines(auth, '/apps', 'creating the app', {
          method: 'POST',
          body: JSON.stringify({ name: candidate, org_slug: organization }),
        }).then(
          () => true,
          (error: unknown) => {
            if (error instanceof DeployError && (error.status === 409 || error.status === 422) && candidate === name)
              return false
            throw error
          },
        )
        if (created) return candidate
      }
      throw new DeployError('Fly.io could not create the app.', null)
    },
    /**
     * A deploy token limited to one app, as `fly tokens create deploy` makes, for the repository's deploy job. A token
     * that cannot make tokens (some organization tokens) is refused with what to connect instead.
     */
    async deployToken(auth: HostingAuth, app: string): Promise<string> {
      const found = await gql<{ app: { organization: { id: string } } | null }>(
        auth,
        'query AppOrganization($name: String!) { app(name: $name) { organization { id } } }',
        { name: app },
        'reading the app',
      )
      if (!found.app) throw new DeployError(`Fly.io has no app named ${app} on this account.`, 'not-found')
      const { createLimitedAccessToken } = await gql<{
        createLimitedAccessToken: { limitedAccessToken: { tokenHeader: string } }
      }>(
        auth,
        'mutation DeployToken($input: CreateLimitedAccessTokenInput!) { createLimitedAccessToken(input: $input) { limitedAccessToken { tokenHeader } } }',
        {
          input: {
            name: `Ramu deploys of ${app} (GitHub Actions)`,
            organizationId: found.app.organization.id,
            profile: 'deploy',
            profileParams: { app_id: app },
            expiry: '',
          },
        },
        'creating the deploy token',
      ).catch((error: unknown) => {
        if (error instanceof DeployError && error.kind === 'missing-permission')
          throw new DeployError(
            'This Fly.io token cannot create deploy tokens. Sign in with Fly.io in Settings → Git → Hosting accounts, or use an organization token.',
            'missing-permission',
            error.status,
            { cause: error },
          )
        throw error
      })
      return createLimitedAccessToken.limitedAccessToken.tokenHeader
    },
  }
}

/** Fly.io, with GitHub at `github` for the deploy job (the real services unless a test points them elsewhere). */
export function flyAdapter(
  options: { graphql?: string; machines?: string; github?: string; fetch?: typeof fetch; pollMs?: number } = {},
): HostingAdapter {
  const fly = flyApi(options)
  const job = actionsDeploys({
    workflow: FLY_WORKFLOW,
    api: options.github ?? 'https://api.github.com',
    fetch: options.fetch ?? fetch,
    pollMs: options.pollMs ?? 2_000,
  })
  const certificate = (auth: HostingAuth, app: string, hostname: string) =>
    fly.machines<FlyCertificate>(
      auth,
      `/apps/${app}/certificates/${encodeURIComponent(hostname)}`,
      'reading the certificate',
    )
  return {
    id: 'fly',
    name: 'Fly.io',
    tokenPage: 'https://fly.io/dashboard/personal/tokens',
    async account(auth) {
      const { viewer, organizations } = await fly.gql<{
        viewer: { __typename?: string; id?: string | null; email?: string; name?: string | null }
        organizations: { nodes: { id: string; slug: string; type?: string }[] }
      }>(
        auth,
        'query Viewer { viewer { __typename id email name } organizations(first: 20) { nodes { id slug type } } }',
        {},
        'reading the account',
      )
      const orgs = organizations.nodes
      const home = orgs.find((org) => org.type === 'PERSONAL') ?? orgs[0]
      const user = viewer.__typename === 'User'
      return {
        id: (user ? viewer.id : null) ?? `org:${home?.slug ?? viewer.email ?? 'fly'}`,
        name: viewer.name || viewer.email || home?.slug || 'Fly.io',
        defaultScope: home?.slug ?? null,
        broadScope: user
          ? 'This sign-in reaches every Fly.io organization you belong to. An organization token is enough for deploys.'
          : null,
        expiresAt: null,
      }
    },
    listDeployments: (auth, site, limit) => job.list(auth, site, limit),
    deploymentStatus: (auth, site, id) => job.status(auth, site, id),
    deploymentLogs: (auth, site, id, lines) => job.log(auth, site, id, lines),
    async productionUrl(_auth, site) {
      return `https://${appOf(site)}.fly.dev`
    },
    capabilities: {
      deployProduction: (auth, site, ref) => job.deploy(auth, site, ref),
      rollback: (auth, site, id) => job.rollback(auth, site, id),
      environment: {
        environments: ['production'],
        async list(auth, site) {
          const { secrets } = await fly.machines<{ secrets?: { name: string }[] }>(
            auth,
            `/apps/${appOf(site)}/secrets`,
            'reading the secrets',
          )
          return { production: (secrets ?? []).map((secret) => secret.name) }
        },
        async set(auth, site, _environment, values) {
          if (!Object.keys(values).length) return
          // Fly gives running machines new secrets on the next deploy.
          await fly.machines(auth, `/apps/${appOf(site)}/secrets`, 'setting the secrets', {
            method: 'POST',
            body: JSON.stringify({ values }),
          })
        },
      },
      domains: {
        async list(auth, site) {
          const app = appOf(site)
          const { certificates } = await fly.machines<{ certificates?: FlyCertificate[] }>(
            auth,
            `/apps/${app}/certificates`,
            'reading the certificates',
          )
          const custom = (certificates ?? []).filter((entry) => !entry.hostname.endsWith('.fly.dev'))
          return Promise.all(
            custom.slice(0, DOMAINS_READ).map(async (entry): Promise<PlatformDomain> => {
              const detail = await certificate(auth, app, entry.hostname)
              const zone = apexOf(entry.hostname)
              const needs = detail.dns_requirements
              const records =
                entry.hostname === zone
                  ? needs?.a?.[0]
                    ? [{ type: 'A' as const, host: zone, name: '@', value: needs.a[0] }]
                    : []
                  : [
                      {
                        type: 'CNAME' as const,
                        host: entry.hostname,
                        name: recordName(entry.hostname, zone),
                        value: (needs?.cname ?? `${app}.fly.dev`).replace(/\.$/, ''),
                      },
                    ]
              return {
                name: entry.hostname,
                records,
                configured: detail.configured ?? null,
                // Fly issues the certificate once the DNS points at the app; the service checks HTTPS itself.
                certificate: null,
                managedDns: false,
                zone,
              }
            }),
          )
        },
        async add(auth, site, name) {
          await fly.machines(auth, `/apps/${appOf(site)}/certificates/acme`, 'adding the domain', {
            method: 'POST',
            body: JSON.stringify({ hostname: name }),
          })
        },
        async createRecords() {
          throw new Error('Fly.io does not host this domain’s DNS. Add the records at your domain provider.')
        },
      },
    },
  }
}

registerHostingAdapter(flyAdapter())
