// Netlify's REST API with the person's own token. Linking sets up Netlify's continuous deployment the way its own
// CLI does: a read-only deploy key on the repository and a webhook to the site's build hook, both through the
// repository's existing GitHub account.
import { apexOf, recordName } from '@ramu/shared/domains'
import type { Deployment, DeploymentState, DnsRecord } from '@ramu/shared/types/deploy'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
  type PlatformDomain,
} from './adapter'

interface NetlifyDeploy {
  id: string
  state?: string
  context?: string
  branch?: string | null
  commit_ref?: string | null
  title?: string | null
  created_at?: string
  deploy_ssl_url?: string | null
  build_id?: string | null
  error_message?: string | null
}

/** A team's build status; the minutes are counted for the current billing period. */
interface BuildStatus {
  minutes?: {
    current?: number
    period_start_date?: string
    period_end_date?: string
    included_minutes?: string | number | null
    included_minutes_with_packs?: string | number | null
  }
}

const STATES: Record<string, DeploymentState> = {
  new: 'queued',
  pending_review: 'queued',
  accepted: 'queued',
  enqueued: 'queued',
  building: 'building',
  uploading: 'building',
  uploaded: 'building',
  preparing: 'building',
  prepared: 'building',
  processing: 'building',
  retrying: 'building',
  ready: 'ready',
  error: 'failed',
  rejected: 'canceled',
}

function deployment(raw: NetlifyDeploy): Deployment {
  return {
    id: raw.id,
    state: STATES[raw.state ?? 'new'] ?? 'queued',
    url: raw.deploy_ssl_url ?? null,
    production: raw.context === 'production',
    ref: raw.branch ?? null,
    commit: raw.commit_ref ?? null,
    message: raw.title?.split('\n')[0] ?? null,
    createdAt: raw.created_at ? Date.parse(raw.created_at) : 0,
  }
}

interface NetlifySite {
  name?: string
  default_domain?: string | null
  custom_domain?: string | null
  domain_aliases?: string[] | null
}

interface DnsZone {
  id: string
  name: string
}

/** The Netlify DNS zone a host name belongs to (the longest match), when its DNS is at Netlify. */
const zoneFor = (zones: DnsZone[], host: string) =>
  zones
    .filter((zone) => host === zone.name || host.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0] ?? null

/** Netlify's documented load balancer address for a domain itself, where a CNAME is not allowed. */
const NETLIFY_A = '75.2.60.5'
/** Record types that point a name in Netlify DNS at a site. */
const POINTING = new Set(['NETLIFY', 'NETLIFYv6', 'A', 'AAAA', 'CNAME', 'ALIAS'])

/** Netlify's deploy contexts for the environments Ramu syncs. */
const CONTEXT = { preview: 'deploy-preview', production: 'production' } as const

/** Netlify, reached at `api`, and GitHub at `github` (the real services unless a test points them at a fake server). */
export function netlifyAdapter(options: { api?: string; github?: string; fetch?: typeof fetch } = {}): HostingAdapter {
  const api = options.api ?? 'https://api.netlify.com/api/v1'
  const github = options.github ?? 'https://api.github.com'
  const fetcher = options.fetch ?? fetch
  const call = <T>(path: string, auth: HostingAuth, what: string, init: RequestInit = {}) =>
    platformCall<T>('Netlify', fetcher, `${api}${path}`, { ...init, token: auth.token }, what)
  const githubCall = <T>(path: string, token: string, what: string, init: RequestInit = {}) =>
    platformCall<T>(
      'GitHub',
      fetcher,
      `${github}${path}`,
      {
        ...init,
        token,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Ramu' },
      },
      what,
    )
  const site = (id: string) => `/sites/${encodeURIComponent(id)}`
  /** Netlify keeps variables on the team account, filtered to one site. */
  const siteEnv = async (auth: HostingAuth, siteId: string) => {
    const { account_id: account } = await call<{ account_id: string }>(site(siteId), auth, 'reading the site')
    return `/accounts/${encodeURIComponent(account)}/env?site_id=${encodeURIComponent(siteId)}`
  }
  const zones = (auth: HostingAuth) => call<DnsZone[]>('/dns_zones', auth, 'reading the DNS zones')
  return {
    id: 'netlify',
    name: 'Netlify',
    tokenPage: 'https://app.netlify.com/user/applications#personal-access-tokens',
    async account(auth) {
      const user = await call<{ id: string; full_name?: string | null; email?: string; slug?: string }>(
        '/user',
        auth,
        'reading the account',
      )
      // Netlify personal access tokens always reach every team the person belongs to; there is no narrower kind.
      return {
        id: user.id,
        name: user.full_name || user.email || user.slug || user.id,
        defaultScope: null,
        broadScope: null,
        expiresAt: null,
      }
    },
    async listDeployments(auth, target, limit) {
      const deploys = await call<NetlifyDeploy[]>(
        `${site(target.siteId)}/deploys?per_page=${limit}`,
        auth,
        'listing deployments',
      )
      return deploys.map(deployment).sort((a, b) => b.createdAt - a.createdAt)
    },
    async deploymentStatus(auth, target, deploymentId) {
      return deployment(
        await call<NetlifyDeploy>(
          `${site(target.siteId)}/deploys/${encodeURIComponent(deploymentId)}`,
          auth,
          'reading the deployment',
        ),
      )
    },
    async deploymentLogs(auth, target, deploymentId, lines) {
      const deploy = await call<NetlifyDeploy>(
        `${site(target.siteId)}/deploys/${encodeURIComponent(deploymentId)}`,
        auth,
        'reading the deployment',
      )
      if (deploy.build_id) {
        const log = await call<{ message?: string }[]>(
          `/builds/${encodeURIComponent(deploy.build_id)}/log`,
          auth,
          'reading the build log',
        ).catch(() => null)
        if (Array.isArray(log) && log.length) return tail(log.map((entry) => entry.message ?? '').join('\n'), lines)
      }
      return deploy.error_message ?? ''
    },
    async productionUrl(auth, target) {
      const live = await call<{ ssl_url?: string | null; url?: string | null }>(
        site(target.siteId),
        auth,
        'reading the site',
      )
      return live.ssl_url ?? live.url ?? null
    },
    capabilities: {
      async linkRepository(auth, name, repository) {
        const path = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`
        const githubToken = await repository.githubToken()
        const repo = await githubCall<{ id: number; full_name: string }>(path, githubToken, 'reading the repository')
        const key = await call<{ id: string; public_key: string }>('/deploy_keys', auth, 'creating a deploy key', {
          method: 'POST',
        })
        await githubCall(`${path}/keys`, githubToken, 'adding the deploy key', {
          method: 'POST',
          body: JSON.stringify({ title: 'Netlify (added by Ramu)', key: key.public_key, read_only: true }),
        })
        const settings = {
          repo: {
            id: repo.id,
            provider: 'github',
            repo_path: repo.full_name,
            repo_branch: repository.productionBranch,
            deploy_key_id: key.id,
          },
        }
        // Site names are global on Netlify: a taken one gets a short suffix.
        let created: { id: string; name: string; deploy_hook?: string | null } | null = null
        for (const candidate of [name, `${name}-${Date.now().toString(36).slice(-5)}`]) {
          created = await call<{ id: string; name: string; deploy_hook?: string | null }>(
            '/sites',
            auth,
            'creating the site',
            { method: 'POST', body: JSON.stringify({ name: candidate, ...settings }) },
          ).catch((error: unknown) => {
            if (error instanceof DeployError && error.status === 422 && candidate === name) return null
            throw error
          })
          if (created) break
        }
        if (!created) throw new DeployError('Netlify could not create the site.', null)
        if (created.deploy_hook)
          await githubCall(`${path}/hooks`, githubToken, 'adding the build webhook', {
            method: 'POST',
            body: JSON.stringify({
              name: 'web',
              active: true,
              events: ['push', 'pull_request', 'delete'],
              config: { url: created.deploy_hook, content_type: 'json' },
            }),
          }).catch((error: unknown) => {
            // GitHub answers 422 when the same hook is already there.
            if (!(error instanceof DeployError && error.status === 422)) throw error
          })
        return { siteId: created.id, siteName: created.name }
      },
      async deployProduction(auth, target) {
        const build = await call<{ id: string; deploy_id: string }>(
          `${site(target.siteId)}/builds`,
          auth,
          'starting the build',
          { method: 'POST' },
        )
        return deployment(
          await call<NetlifyDeploy>(
            `${site(target.siteId)}/deploys/${encodeURIComponent(build.deploy_id)}`,
            auth,
            'reading the deployment',
          ),
        )
      },
      environment: {
        environments: ['preview', 'production'],
        async list(auth, target) {
          const env = await call<{ key: string; values?: { context?: string }[] }[]>(
            await siteEnv(auth, target.siteId),
            auth,
            'reading the environment variables',
          )
          const named = (context: string) =>
            env
              .filter((entry) => entry.values?.some((value) => value.context === 'all' || value.context === context))
              .map((entry) => entry.key)
          return { preview: named(CONTEXT.preview), production: named(CONTEXT.production) }
        },
        async set(auth, target, environment, values) {
          const base = await siteEnv(auth, target.siteId)
          const [path, query] = base.split('?') as [string, string]
          const existing = new Set(
            (await call<{ key: string }[]>(base, auth, 'reading the environment variables')).map((entry) => entry.key),
          )
          const context = CONTEXT[environment]
          const added = Object.entries(values).filter(([key]) => !existing.has(key))
          if (added.length)
            await call(base, auth, 'adding environment variables', {
              method: 'POST',
              body: JSON.stringify(added.map(([key, value]) => ({ key, values: [{ context, value }] }))),
            })
          // A variable already set for another context gets a value for this one beside it.
          for (const [key, value] of Object.entries(values).filter(([name]) => existing.has(name)))
            await call(`${path}/${encodeURIComponent(key)}?${query}`, auth, 'setting an environment variable', {
              method: 'PATCH',
              body: JSON.stringify({ context, value }),
            })
        },
        async setBranch(auth, target, branch, values) {
          const base = await siteEnv(auth, target.siteId)
          const [path, query] = base.split('?') as [string, string]
          const existing = new Set(
            (await call<{ key: string }[]>(base, auth, 'reading the environment variables')).map((entry) => entry.key),
          )
          const added = Object.entries(values).filter(([key]) => !existing.has(key))
          if (added.length)
            await call(base, auth, 'adding a branch’s environment variables', {
              method: 'POST',
              body: JSON.stringify(
                added.map(([key, value]) => ({
                  key,
                  values: [{ context: 'branch', context_parameter: branch, value }],
                })),
              ),
            })
          for (const [key, value] of Object.entries(values).filter(([name]) => existing.has(name)))
            await call(`${path}/${encodeURIComponent(key)}?${query}`, auth, 'setting a branch’s environment variable', {
              method: 'PATCH',
              body: JSON.stringify({ context: 'branch', context_parameter: branch, value }),
            })
        },
        async removeBranch(auth, target, branch, keys) {
          const base = await siteEnv(auth, target.siteId)
          const [path, query] = base.split('?') as [string, string]
          const env = await call<
            { key: string; values?: { id?: string; context?: string; context_parameter?: string }[] }[]
          >(base, auth, 'reading the environment variables')
          for (const entry of env.filter((item) => keys.includes(item.key)))
            for (const value of entry.values ?? [])
              if (value.id && value.context === 'branch' && value.context_parameter === branch)
                await call(
                  `${path}/${encodeURIComponent(entry.key)}/value/${encodeURIComponent(value.id)}?${query}`,
                  auth,
                  'removing a branch’s environment variable',
                  { method: 'DELETE' },
                )
        },
      },
      domains: {
        async list(auth, target) {
          const live = await call<NetlifySite>(site(target.siteId), auth, 'reading the site')
          const names = [live.custom_domain, ...(live.domain_aliases ?? [])].filter((name): name is string => !!name)
          if (!names.length) return []
          const defaultDomain = live.default_domain ?? `${live.name ?? target.siteName}.netlify.app`
          const [ssl, owned] = await Promise.all([
            // A site without a certificate yet answers 404.
            call<{ state?: string; domains?: string[] }>(
              `${site(target.siteId)}/ssl`,
              auth,
              'reading the certificate',
            ).catch(() => null),
            zones(auth),
          ])
          return Promise.all(
            names.map(async (name): Promise<PlatformDomain> => {
              const zone = zoneFor(owned, name)
              const apex = zone?.name ?? apexOf(name)
              const record: DnsRecord =
                name === apex
                  ? { type: 'A', host: name, name: '@', value: NETLIFY_A }
                  : { type: 'CNAME', host: name, name: recordName(name, apex), value: defaultDomain }
              const pointed = zone
                ? (
                    await call<{ hostname?: string; type?: string }[]>(
                      `/dns_zones/${encodeURIComponent(zone.id)}/dns_records`,
                      auth,
                      'reading the DNS records',
                    )
                  ).some((entry) => entry.hostname === name && POINTING.has(entry.type ?? ''))
                : null
              return {
                name,
                records: [record],
                // Outside Netlify DNS, Netlify does not report whether the DNS points at it; the service checks.
                configured: pointed,
                certificate: ssl?.state === 'issued' && (ssl.domains ?? []).includes(name),
                managedDns: !!zone,
                zone: apex,
              }
            }),
          )
        },
        async add(auth, target, name) {
          const live = await call<NetlifySite>(site(target.siteId), auth, 'reading the site')
          if (live.custom_domain === name || live.domain_aliases?.includes(name)) return
          // The first domain becomes the site's primary one; later ones are aliases that serve the same site.
          const change = live.custom_domain
            ? { domain_aliases: [...(live.domain_aliases ?? []), name] }
            : { custom_domain: name }
          await call(site(target.siteId), auth, 'adding the domain', {
            method: 'PATCH',
            body: JSON.stringify(change),
          }).catch((error: unknown) => {
            if (error instanceof DeployError && error.status === 422)
              throw new DeployError(
                `${name} is already used by another Netlify site. Remove it there, then add it again.`,
                'missing-permission',
                422,
              )
            throw error
          })
        },
        async createRecords(auth, _target, domain) {
          const zone = zoneFor(await zones(auth), domain.name)
          if (!zone) throw new DeployError(`${domain.name} does not use Netlify DNS.`, 'not-found')
          for (const record of domain.records)
            await call(`/dns_zones/${encodeURIComponent(zone.id)}/dns_records`, auth, 'creating a DNS record', {
              method: 'POST',
              body: JSON.stringify({ type: record.type, hostname: record.host, value: record.value, ttl: 3600 }),
            }).catch((error: unknown) => {
              // Netlify answers 422 for a record that is already there; creating records twice is not a failure.
              if (!(error instanceof DeployError && error.status === 422)) throw error
            })
        },
      },
      async rollback(auth, target, deploymentId) {
        const live = await call<{ published_deploy?: { locked?: boolean } }>(
          site(target.siteId),
          auth,
          'reading the site',
        )
        await call(
          `${site(target.siteId)}/deploys/${encodeURIComponent(deploymentId)}/restore`,
          auth,
          'restoring the deployment',
          { method: 'POST' },
        )
        // Publishing by hand moves the lock off, so a site held for migrations stays held after a rollback.
        if (live.published_deploy?.locked)
          await call(`/deploys/${encodeURIComponent(deploymentId)}/lock`, auth, 'keeping auto publishing locked', {
            method: 'POST',
          })
      },
      // Locked publishing: the live deploy stays live until another is published by hand.
      async hold(auth, target, on) {
        const live = await call<{ published_deploy?: { id?: string } }>(site(target.siteId), auth, 'reading the site')
        const id = live.published_deploy?.id
        if (!id) {
          if (!on) return
          // Netlify locks a published deploy; with none yet, the first build would go live before its migrations.
          throw new Error('Netlify can hold builds once the site has a live deploy. Deploy once, then turn this on.')
        }
        await call(`/deploys/${encodeURIComponent(id)}/${on ? 'lock' : 'unlock'}`, auth, 'changing auto publishing', {
          method: 'POST',
        })
      },
      async promote(auth, target, deploymentId) {
        await call(
          `${site(target.siteId)}/deploys/${encodeURIComponent(deploymentId)}/restore`,
          auth,
          'publishing the deployment',
          { method: 'POST' },
        )
        // Publishing by hand moves the lock to the new deploy, so the next build waits too.
        await call(`/deploys/${encodeURIComponent(deploymentId)}/lock`, auth, 'keeping auto publishing locked', {
          method: 'POST',
        })
      },
      async usage(auth, target) {
        // Netlify's API reports a team's build minutes against its plan; bandwidth and credits are on its dashboard only.
        const { account_id: account, account_slug: slug } = await call<{ account_id: string; account_slug?: string }>(
          site(target.siteId),
          auth,
          'reading the site',
        )
        const reply = await call<BuildStatus | BuildStatus[]>(
          `/${encodeURIComponent(account)}/builds/status`,
          auth,
          'reading build minutes',
        )
        const minutes = (Array.isArray(reply) ? reply[0] : reply)?.minutes
        const included = Number(minutes?.included_minutes_with_packs ?? minutes?.included_minutes)
        const start = minutes?.period_start_date ? Date.parse(minutes.period_start_date) : NaN
        const end = minutes?.period_end_date ? Date.parse(minutes.period_end_date) : NaN
        return {
          period: Number.isNaN(start) ? null : { start, end: Number.isNaN(end) ? null : end },
          figures:
            typeof minutes?.current === 'number'
              ? [
                  {
                    metric: 'build-minutes',
                    service: null,
                    used: minutes.current,
                    unit: 'minutes',
                    limit: Number.isFinite(included) && included > 0 ? included : null,
                  },
                ]
              : [],
          billingPage: slug
            ? `https://app.netlify.com/teams/${encodeURIComponent(slug)}/billing/general`
            : 'https://app.netlify.com/',
        }
      },
    },
  }
}

registerHostingAdapter(netlifyAdapter())
