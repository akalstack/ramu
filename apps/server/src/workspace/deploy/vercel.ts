// Vercel's REST API with the person's own token. Linking uses Vercel's GitHub integration, so every pull request gets
// a preview and the default branch deploys to production without a token in CI.
import { recordName } from '@ramu/shared/domains'
import type { Deployment, DeploymentState, DnsRecord, UsageFigure } from '@ramu/shared/types/deploy'
import {
  DeployError,
  platformCall,
  platformRequest,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
  type PlatformDomain,
} from './adapter'

/** One FOCUS charge row from Vercel's billing API. */
interface VercelCharge {
  ChargeCategory?: string
  ConsumedQuantity?: number | null
  ConsumedUnit?: string | null
  ServiceName?: string
}

/** Rows read from one charges reply: a month of daily rows per service, with room to spare. */
const CHARGE_ROWS = 20_000
const MAX_SERVICES = 20

interface VercelDeployment {
  uid?: string
  id?: string
  url?: string | null
  state?: string
  readyState?: string
  target?: string | null
  created?: number
  createdAt?: number
  meta?: { githubCommitRef?: string; githubCommitSha?: string; githubCommitMessage?: string }
}

interface VercelDomain {
  name: string
  apexName?: string
  verified?: boolean
  verification?: { type?: string; domain?: string; value?: string }[]
}

interface VercelDomainConfig {
  misconfigured?: boolean
  recommendedIPv4?: { rank?: number; value?: string[] }[]
  recommendedCNAME?: { rank?: number; value?: string }[]
}

/** Vercel's documented defaults, used when its recommendation is missing from the reply. */
const VERCEL_A = '76.76.21.21'
const VERCEL_CNAME = 'cname.vercel-dns.com'
/** Domains read per project, so a project with many aliases cannot fan out into hundreds of calls. */
const DOMAINS_READ = 20

const STATES: Record<string, DeploymentState> = {
  QUEUED: 'queued',
  INITIALIZING: 'queued',
  BUILDING: 'building',
  READY: 'ready',
  ERROR: 'failed',
  CANCELED: 'canceled',
}

function deployment(raw: VercelDeployment): Deployment {
  const state = raw.readyState ?? raw.state ?? 'QUEUED'
  return {
    id: raw.uid ?? raw.id ?? '',
    state: STATES[state] ?? 'queued',
    url: raw.url ? `https://${raw.url}` : null,
    production: raw.target === 'production',
    ref: raw.meta?.githubCommitRef ?? null,
    commit: raw.meta?.githubCommitSha ?? null,
    message: raw.meta?.githubCommitMessage?.split('\n')[0] ?? null,
    createdAt: raw.createdAt ?? raw.created ?? 0,
  }
}

/** Vercel, reached at `api` (the real API unless a test points it at a fake server). */
export function vercelAdapter(options: { api?: string; fetch?: typeof fetch } = {}): HostingAdapter {
  const api = options.api ?? 'https://api.vercel.com'
  const fetcher = options.fetch ?? fetch
  const url = (path: string, auth: HostingAuth, query: Record<string, string> = {}) => {
    const params = new URLSearchParams({ ...query, ...(auth.scope ? { teamId: auth.scope } : {}) })
    const search = params.toString()
    return `${api}${path}${search ? `?${search}` : ''}`
  }
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}, query = {}) =>
    platformCall<T>('Vercel', fetcher, url(path, auth, query), { ...init, token: auth.token }, what)
  const project = (site: HostingSite) => encodeURIComponent(site.siteId)
  const deploy = async (
    auth: HostingAuth,
    site: HostingSite & { repository: string },
    ref: string,
    production: boolean,
  ) => {
    const [org, repo] = site.repository.split('/') as [string, string]
    const created = await call<VercelDeployment>('/v13/deployments', auth, 'starting the deployment', {
      method: 'POST',
      body: JSON.stringify({
        name: site.siteName,
        project: site.siteId,
        ...(production ? { target: 'production' } : {}),
        gitSource: { type: 'github', org, repo, ref },
      }),
    })
    return deployment(created)
  }
  const readDomain = async (auth: HostingAuth, domain: VercelDomain): Promise<PlatformDomain> => {
    const apex = domain.apexName ?? domain.name
    const [config, owned] = await Promise.all([
      call<VercelDomainConfig>(`/v6/domains/${encodeURIComponent(domain.name)}/config`, auth, 'reading the domain'),
      // A domain bought elsewhere is not in the account at all; that only means its DNS is elsewhere.
      call<{ domain?: { serviceType?: string } }>(
        `/v5/domains/${encodeURIComponent(apex)}`,
        auth,
        'reading the domain',
      ).catch((error: unknown) => {
        if (error instanceof DeployError && (error.kind === 'not-found' || error.kind === 'missing-permission'))
          return null
        throw error
      }),
    ])
    const best = <T extends { rank?: number }>(list: T[] | undefined) =>
      [...(list ?? [])].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]
    const pointing: DnsRecord =
      domain.name === apex
        ? { type: 'A', host: apex, name: '@', value: best(config.recommendedIPv4)?.value?.[0] ?? VERCEL_A }
        : {
            type: 'CNAME',
            host: domain.name,
            name: recordName(domain.name, apex),
            value: (best(config.recommendedCNAME)?.value ?? VERCEL_CNAME).replace(/\.$/, ''),
          }
    const ownership: DnsRecord[] = domain.verified
      ? []
      : (domain.verification ?? [])
          .filter((entry) => entry.type === 'TXT' && entry.domain && entry.value)
          .map((entry) => ({
            type: 'TXT' as const,
            host: entry.domain!,
            name: recordName(entry.domain!, apex),
            value: entry.value!,
          }))
    return {
      name: domain.name,
      records: [pointing, ...ownership],
      configured: domain.verified !== false && config.misconfigured === false,
      // Vercel issues the certificate on its own once the DNS is right, and does not report it per domain.
      certificate: null,
      managedDns: owned?.domain?.serviceType === 'zeit.world',
      zone: apex,
    }
  }
  return {
    id: 'vercel',
    name: 'Vercel',
    tokenPage: 'https://vercel.com/account/settings/tokens',
    async account(auth) {
      const { user } = await call<{
        user: { id: string; username?: string; name?: string | null; email?: string; defaultTeamId?: string | null }
      }>('/v2/user', { token: auth.token }, 'reading the account')
      // A token's scope is a team or the whole account; reading it is optional, so a refusal says nothing.
      const current = await call<{ token?: { scopes?: { type?: string }[]; expiresAt?: number | null } }>(
        '/v5/user/tokens/current',
        { token: auth.token },
        'reading the token',
      ).catch(() => null)
      const whole = current?.token?.scopes?.some((scope) => scope.type === 'user') ?? false
      return {
        id: user.id,
        name: user.username ?? user.name ?? user.email ?? user.id,
        defaultScope: user.defaultTeamId ?? null,
        broadScope: whole
          ? 'This token reaches your whole Vercel account. A token limited to the team your projects are in is enough.'
          : null,
        expiresAt: current?.token?.expiresAt ?? null,
      }
    },
    async listDeployments(auth, site, limit) {
      const { deployments } = await call<{ deployments?: VercelDeployment[] }>(
        '/v6/deployments',
        auth,
        'listing deployments',
        {},
        { projectId: site.siteId, limit: String(limit) },
      )
      return (deployments ?? []).map(deployment).sort((a, b) => b.createdAt - a.createdAt)
    },
    async deploymentStatus(auth, _site, deploymentId) {
      return deployment(
        await call<VercelDeployment>(
          `/v13/deployments/${encodeURIComponent(deploymentId)}`,
          auth,
          'reading the deployment',
        ),
      )
    },
    async deploymentLogs(auth, _site, deploymentId, lines) {
      const events = await call<{ type?: string; text?: string; payload?: { text?: string } }[]>(
        `/v3/deployments/${encodeURIComponent(deploymentId)}/events`,
        auth,
        'reading the build log',
        {},
        { limit: '-1' },
      )
      return tail(
        (Array.isArray(events) ? events : []).map((event) => event.payload?.text ?? event.text ?? '').join('\n'),
        lines,
      )
    },
    async productionUrl(auth, site) {
      const { domains } = await call<{ domains?: { name: string; verified?: boolean }[] }>(
        `/v9/projects/${project(site)}/domains`,
        auth,
        'reading the project domains',
      )
      // The shortest verified domain is the one a person would type; Vercel always adds `<name>.vercel.app`.
      const names = (domains ?? []).filter((domain) => domain.verified !== false).map((domain) => domain.name)
      const shortest = names.sort((a, b) => a.length - b.length)[0]
      return shortest ? `https://${shortest}` : null
    },
    capabilities: {
      async linkRepository(auth, name, repository) {
        const repo = `${repository.owner}/${repository.name}`
        const existing = await call<{ id: string; name: string }>(
          `/v9/projects/${encodeURIComponent(name)}`,
          auth,
          'reading the project',
        ).catch((error: unknown) => {
          if (error instanceof DeployError && error.kind === 'not-found') return null
          throw error
        })
        // Vercel's GitHub app must be installed for the account; without it Vercel refuses the link.
        const linkFailed = (error: unknown): never => {
          if (error instanceof DeployError && (error.status === 400 || error.kind === 'missing-permission'))
            throw new DeployError(
              `Vercel cannot reach ${repo}. Install Vercel's GitHub app for that repository (https://github.com/apps/vercel) and link again.`,
              'missing-permission',
              error.status,
            )
          throw error
        }
        if (existing) {
          await call(`/v9/projects/${encodeURIComponent(existing.id)}/link`, auth, 'linking the repository', {
            method: 'POST',
            body: JSON.stringify({ type: 'github', repo, productionBranch: repository.productionBranch }),
          }).catch(linkFailed)
          return { siteId: existing.id, siteName: existing.name }
        }
        const created = await call<{ id: string; name: string }>('/v11/projects', auth, 'creating the project', {
          method: 'POST',
          body: JSON.stringify({ name, gitRepository: { type: 'github', repo } }),
        }).catch(linkFailed)
        return { siteId: created.id, siteName: created.name }
      },
      deployPreview: (auth, site, ref) => deploy(auth, site, ref, false),
      deployProduction: (auth, site, ref) => deploy(auth, site, ref, true),
      environment: {
        async list(auth, site) {
          const { envs } = await call<{ envs?: { key: string; target?: string[] | string }[] }>(
            `/v10/projects/${project(site)}/env`,
            auth,
            'reading the environment variables',
          )
          const named = (target: string) =>
            (envs ?? [])
              .filter((env) => (Array.isArray(env.target) ? env.target : [env.target]).includes(target))
              .map((env) => env.key)
          return { preview: named('preview'), production: named('production') }
        },
        async set(auth, site, environment, values) {
          const entries = Object.entries(values)
          if (!entries.length) return
          // Encrypted, so the value is not shown on Vercel's dashboard by default either.
          await call(
            `/v10/projects/${project(site)}/env`,
            auth,
            'setting environment variables',
            {
              method: 'POST',
              body: JSON.stringify(
                entries.map(([key, value]) => ({ key, value, type: 'encrypted', target: [environment] })),
              ),
            },
            { upsert: 'true' },
          )
        },
      },
      domains: {
        async list(auth, site) {
          const { domains } = await call<{ domains?: VercelDomain[] }>(
            `/v9/projects/${project(site)}/domains`,
            auth,
            'reading the project domains',
          )
          // Vercel's own `*.vercel.app` names need no DNS.
          const custom = (domains ?? []).filter((domain) => !domain.name.endsWith('.vercel.app')).slice(0, DOMAINS_READ)
          return Promise.all(custom.map((domain) => readDomain(auth, domain)))
        },
        async add(auth, site, name) {
          await call(`/v10/projects/${project(site)}/domains`, auth, 'adding the domain', {
            method: 'POST',
            body: JSON.stringify({ name }),
          }).catch((error: unknown) => {
            if (error instanceof DeployError && error.status === 409)
              throw new DeployError(
                `${name} is already used by another Vercel project or account. Remove it there, then add it again.`,
                'missing-permission',
                409,
              )
            throw error
          })
        },
        async createRecords(auth, _site, domain) {
          for (const record of domain.records)
            await call(`/v2/domains/${encodeURIComponent(domain.zone)}/records`, auth, 'creating a DNS record', {
              method: 'POST',
              body: JSON.stringify({
                name: record.name === '@' ? '' : record.name,
                type: record.type,
                value: record.value,
                ttl: 60,
              }),
            }).catch((error: unknown) => {
              // Vercel answers 409 for a record that is already there; creating records twice is not a failure.
              if (!(error instanceof DeployError && error.status === 409)) throw error
            })
        },
      },
      async rollback(auth, site, deploymentId) {
        await call(`/v9/projects/${project(site)}/rollback/${encodeURIComponent(deploymentId)}`, auth, 'rolling back', {
          method: 'POST',
        })
      },
      async usage(auth) {
        // Vercel reports charges (FOCUS rows, one JSON object per line) per service and day, but no plan limits; the
        // calendar month stands in for the billing period, which its API does not name.
        const today = new Date()
        const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)
        const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1)
        const text = await platformRequest(
          'Vercel',
          fetcher,
          url('/v1/billing/charges', auth, {
            from: new Date(start).toISOString(),
            to: new Date(end).toISOString(),
          }),
          { token: auth.token },
          'reading usage',
        )
        const totals = new Map<string, UsageFigure>()
        for (const line of text.split('\n').slice(0, CHARGE_ROWS)) {
          let row: VercelCharge
          try {
            row = JSON.parse(line) as VercelCharge
          } catch {
            continue
          }
          if (row.ChargeCategory !== 'Usage' || typeof row.ConsumedQuantity !== 'number' || !row.ServiceName) continue
          const unit = row.ConsumedUnit ?? ''
          const key = `${row.ServiceName}\u0000${unit}`
          const figure = totals.get(key) ?? { metric: 'service', service: row.ServiceName, used: 0, unit, limit: null }
          totals.set(key, { ...figure, used: figure.used + row.ConsumedQuantity })
        }
        return {
          period: { start, end: null },
          figures: [...totals.values()]
            .sort((a, b) => (a.service ?? '').localeCompare(b.service ?? ''))
            .slice(0, MAX_SERVICES),
          billingPage: 'https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fsettings%2Fbilling&title=Billing',
        }
      },
    },
  }
}

registerHostingAdapter(vercelAdapter())
