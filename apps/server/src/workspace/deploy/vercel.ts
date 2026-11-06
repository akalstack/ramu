// Vercel's REST API with the person's own token. Linking uses Vercel's GitHub integration, so every pull request gets
// a preview and the default branch deploys to production without a token in CI.
import type { Deployment, DeploymentState } from '@ramu/shared/types/deploy'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  tail,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
} from './adapter'

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
      async rollback(auth, site, deploymentId) {
        await call(`/v9/projects/${project(site)}/rollback/${encodeURIComponent(deploymentId)}`, auth, 'rolling back', {
          method: 'POST',
        })
      },
    },
  }
}

registerHostingAdapter(vercelAdapter())
