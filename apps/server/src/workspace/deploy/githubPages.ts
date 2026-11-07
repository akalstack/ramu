// GitHub Pages for a static site: no token of its own, since everything goes through the GitHub account that reaches
// the repository. Deploys run in the repository's GitHub Actions (GitHub's own Pages actions); Ramu reads those runs,
// and dispatches the same job for a production deploy or a rollback, as for Fly.io and the person's own server.
import { PAGES_WORKFLOW } from '@ramu/shared/pagesDeploy'
import { actionsDeploys, GITHUB_HEADERS } from './actionsDeploys'
import { DeployError, platformCall, registerHostingAdapter, type HostingAdapter, type HostingAuth } from './adapter'

/** The account Settings shows: the repository's own GitHub sign-in, so nothing is pasted for Pages. */
export const PAGES_ACCOUNT = { token: 'github', label: 'your GitHub sign-in' } as const

export function githubPagesAdapter(
  options: { api?: string; fetch?: typeof fetch; pollMs?: number } = {},
): HostingAdapter {
  const api = options.api ?? 'https://api.github.com'
  const fetcher = options.fetch ?? fetch
  const job = actionsDeploys({ workflow: PAGES_WORKFLOW, api, fetch: fetcher, pollMs: options.pollMs ?? 2_000 })
  const github = async <T>(auth: HostingAuth, path: string, what: string) => {
    if (!auth.github) throw new DeployError('Link this project to its GitHub repository first.', 'not-found')
    return platformCall<T>(
      'GitHub',
      fetcher,
      `${api}${path}`,
      { token: await auth.github(), headers: GITHUB_HEADERS },
      what,
    )
  }
  return {
    id: 'github-pages',
    name: 'GitHub Pages',
    tokenPage: 'https://docs.github.com/pages/getting-started-with-github-pages',
    async account() {
      return { id: 'github', name: PAGES_ACCOUNT.label, defaultScope: null, broadScope: null, expiresAt: null }
    },
    listDeployments: (auth, site, limit) => job.list(auth, site, limit),
    deploymentStatus: (auth, site, id) => job.status(auth, site, id),
    deploymentLogs: (auth, site, id, lines) => job.log(auth, site, id, lines),
    async productionUrl(auth, site) {
      const pages = await github<{ html_url?: string }>(
        auth,
        `/repos/${site.siteId}/pages`,
        'reading the Pages site',
      ).catch(() => null)
      return pages?.html_url ?? null
    },
    capabilities: {
      deployProduction: (auth, site, ref) => job.deploy(auth, site, ref),
      rollback: (auth, site, id) => job.rollback(auth, site, id),
    },
  }
}

registerHostingAdapter(githubPagesAdapter())
