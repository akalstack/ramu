// Cloudflare Pages with the person's own API token, limited to Pages: its API for the account and the Pages project.
// Builds run in the repository's GitHub Actions (`wrangler pages deploy` with that token from the repository's
// secrets); Ramu reads those runs, and dispatches the same job for a production deploy or a rollback.
import { CLOUDFLARE_WORKFLOW } from '@ramu/shared/cloudflareDeploy'
import { actionsDeploys } from './actionsDeploys'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
} from './adapter'

const PROJECT = /^[a-z0-9-]{1,58}$/

/** The Pages project a binding names, checked before it goes into a URL or an address. */
function projectOf(site: HostingSite): string {
  if (!PROJECT.test(site.siteName))
    throw new DeployError('This project’s Cloudflare Pages project is not one Ramu set up. Link it again.', 'not-found')
  return site.siteName
}

/** The preview address Cloudflare gives a branch: its name in lowercase with dashes, at most 28 characters. */
export const cloudflareBranchAlias = (branch: string) =>
  branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28)
    .replace(/-+$/, '')

interface Envelope<T> {
  success: boolean
  result: T
}

/** Cloudflare's API, reached at `api` unless a test points it at a fake server. */
export function cloudflareApi(options: { api?: string; fetch?: typeof fetch } = {}) {
  const api = options.api ?? 'https://api.cloudflare.com/client/v4'
  const fetcher = options.fetch ?? fetch
  const call = async <T>(auth: HostingAuth, path: string, what: string, init: RequestInit = {}) =>
    (await platformCall<Envelope<T>>('Cloudflare', fetcher, `${api}${path}`, { ...init, token: auth.token }, what))
      .result
  return {
    call,
    /** Whether the account has a Pages project of that name. */
    async projectExists(auth: HostingAuth, account: string, name: string) {
      try {
        await call(auth, `/accounts/${encodeURIComponent(account)}/pages/projects/${name}`, 'reading the Pages project')
        return true
      } catch (error) {
        if (error instanceof DeployError && error.kind === 'not-found') return false
        throw error
      }
    },
    async createProject(auth: HostingAuth, account: string, name: string, productionBranch: string) {
      await call(auth, `/accounts/${encodeURIComponent(account)}/pages/projects`, 'creating the Pages project', {
        method: 'POST',
        body: JSON.stringify({ name, production_branch: productionBranch }),
      })
    },
  }
}

export function cloudflareAdapter(
  options: { api?: string; github?: string; fetch?: typeof fetch; pollMs?: number } = {},
): HostingAdapter {
  const cloudflare = cloudflareApi(options)
  const job = actionsDeploys({
    workflow: CLOUDFLARE_WORKFLOW,
    api: options.github ?? 'https://api.github.com',
    fetch: options.fetch ?? fetch,
    pollMs: options.pollMs ?? 2_000,
  })
  /** Each run's address: production's own, or its branch's preview alias. */
  const addressed = (site: HostingSite) => {
    const project = projectOf(site)
    return <D extends { production: boolean; ref: string | null; url: string | null }>(deployment: D): D => ({
      ...deployment,
      url: deployment.production
        ? `https://${project}.pages.dev`
        : deployment.ref
          ? `https://${cloudflareBranchAlias(deployment.ref)}.${project}.pages.dev`
          : null,
    })
  }
  return {
    id: 'cloudflare',
    name: 'Cloudflare Pages',
    tokenPage: 'https://dash.cloudflare.com/profile/api-tokens',
    async account(auth) {
      const verified = await cloudflare.call<{ status?: string; expires_on?: string }>(
        auth,
        '/user/tokens/verify',
        'checking the token',
      )
      if (verified.status !== 'active') throw new DeployError('This Cloudflare token is not active.', 'signed-out')
      const accounts = await cloudflare.call<{ id: string; name: string }[]>(auth, '/accounts', 'reading the accounts')
      const account = accounts[0]
      if (!account) throw new DeployError('This Cloudflare token reaches no account.', 'missing-permission')
      return {
        id: account.id,
        name: account.name,
        defaultScope: account.id,
        broadScope:
          accounts.length > 1
            ? 'Create a token limited to the one account your sites go in, with Pages edit only.'
            : null,
        expiresAt: verified.expires_on ? Date.parse(verified.expires_on) : null,
      }
    },
    listDeployments: async (auth, site, limit) => (await job.list(auth, site, limit)).map(addressed(site)),
    deploymentStatus: async (auth, site, id) => addressed(site)(await job.status(auth, site, id)),
    deploymentLogs: (auth, site, id, lines) => job.log(auth, site, id, lines),
    async productionUrl(_auth, site) {
      return `https://${projectOf(site)}.pages.dev`
    },
    capabilities: {
      deployProduction: (auth, site, ref) => job.deploy(auth, site, ref),
      rollback: (auth, site, id) => job.rollback(auth, site, id),
    },
  }
}

registerHostingAdapter(cloudflareAdapter())
