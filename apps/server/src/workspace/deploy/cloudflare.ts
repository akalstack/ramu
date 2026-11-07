// Cloudflare Pages with the person's own API token, limited to Pages: its API for the account and the Pages project.
// Builds run in the repository's GitHub Actions (`wrangler pages deploy` with that token from the repository's
// secrets); Ramu reads those runs, and dispatches the same job for a production deploy or a rollback.
import { CLOUDFLARE_WORKFLOW, WORKERS_WORKFLOW } from '@ramu/shared/cloudflareDeploy'
import { apexOf, recordName } from '@ramu/shared/domains'
import { actionsDeploys } from './actionsDeploys'
import {
  DeployError,
  platformCall,
  registerHostingAdapter,
  type HostingAdapter,
  type HostingAuth,
  type HostingSite,
  type PlatformDomain,
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

/** The Pages project's API path, in the account the binding was made in. */
function projectPath(auth: HostingAuth, project: string): string {
  if (!auth.scope) throw new DeployError('This project’s Cloudflare account is not known. Link it again.', 'not-found')
  return `/accounts/${encodeURIComponent(auth.scope)}/pages/projects/${project}`
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
    // Cloudflare's token form takes a template: only Pages edit, named Ramu.
    tokenPage: `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
      JSON.stringify([{ key: 'page', type: 'edit' }]),
    )}&name=Ramu`,
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
      domains: {
        async list(auth, site): Promise<PlatformDomain[]> {
          const project = projectOf(site)
          const domains = await cloudflare.call<{ name: string; status?: string }[]>(
            auth,
            `${projectPath(auth, project)}/domains`,
            'reading the domains',
          )
          return domains.map((domain) => {
            const zone = apexOf(domain.name)
            const live = domain.status === 'active'
            return {
              name: domain.name,
              records: [
                {
                  type: 'CNAME',
                  host: domain.name,
                  name: recordName(domain.name, zone),
                  value: `${project}.pages.dev`,
                },
              ],
              configured: live,
              certificate: live,
              managedDns: false,
              zone,
            }
          })
        },
        async add(auth, site, name) {
          await cloudflare.call(auth, `${projectPath(auth, projectOf(site))}/domains`, 'adding the domain', {
            method: 'POST',
            body: JSON.stringify({ name }),
          })
        },
        async createRecords() {
          throw new Error('The Pages token cannot change DNS. Add the CNAME record where the domain’s DNS is kept.')
        },
      },
    },
  }
}

registerHostingAdapter(cloudflareAdapter())

const WORKER = /^[a-z0-9-]{1,63}$/

/**
 * Cloudflare Workers with the same Cloudflare account as Pages (its token also needs Workers Scripts edit). Deploys
 * run `wrangler deploy` in the repository's GitHub Actions; the Worker answers at its workers.dev address.
 */
export function cloudflareWorkersAdapter(
  options: { api?: string; github?: string; fetch?: typeof fetch; pollMs?: number } = {},
): HostingAdapter {
  const pages = cloudflareAdapter(options)
  const cloudflare = cloudflareApi(options)
  const job = actionsDeploys({
    workflow: WORKERS_WORKFLOW,
    api: options.github ?? 'https://api.github.com',
    fetch: options.fetch ?? fetch,
    pollMs: options.pollMs ?? 2_000,
  })
  return {
    id: 'cloudflare-workers',
    name: 'Cloudflare Workers',
    tokenPage: 'https://dash.cloudflare.com/profile/api-tokens',
    account: (auth) => pages.account(auth),
    listDeployments: (auth, site, limit) => job.list(auth, site, limit),
    deploymentStatus: (auth, site, id) => job.status(auth, site, id),
    deploymentLogs: (auth, site, id, lines) => job.log(auth, site, id, lines),
    async productionUrl(auth, site) {
      if (!WORKER.test(site.siteName) || !auth.scope) return null
      const { subdomain } = await cloudflare
        .call<{ subdomain?: string }>(
          auth,
          `/accounts/${encodeURIComponent(auth.scope)}/workers/subdomain`,
          'reading the workers.dev address',
        )
        .catch(() => ({ subdomain: undefined }))
      return subdomain ? `https://${site.siteName}.${subdomain}.workers.dev` : null
    },
    capabilities: {
      deployProduction: (auth, site, ref) => job.deploy(auth, site, ref),
      rollback: (auth, site, id) => job.rollback(auth, site, id),
    },
  }
}

registerHostingAdapter(cloudflareWorkersAdapter())
