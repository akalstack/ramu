// Netlify's REST API with the person's own token. Linking sets up Netlify's continuous deployment the way its own
// CLI does: a read-only deploy key on the repository and a webhook to the site's build hook, both through the
// repository's existing GitHub account.
import type { Deployment, DeploymentState } from '@ramu/shared/types/deploy'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
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
      },
      async rollback(auth, target, deploymentId) {
        await call(
          `${site(target.siteId)}/deploys/${encodeURIComponent(deploymentId)}/restore`,
          auth,
          'restoring the deployment',
          { method: 'POST' },
        )
      },
    },
  }
}

registerHostingAdapter(netlifyAdapter())
