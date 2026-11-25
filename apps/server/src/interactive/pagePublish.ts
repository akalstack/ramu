import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import type { ForgeAccountStore } from '../workspace/forgeAccounts'
import { githubPages } from '../hosting/staticSite'
import type { PageStore } from './pages'

/** What a page published from Ramu records as its target, so Update live site deploys to the same repository. */
const GITHUB_PAGES = 'github-pages'

/**
 * Publish to the web: a page's exact tested bytes as a one-file static site on GitHub Pages, through the GitHub login
 * saved in Settings.
 */
export class PagePublisher {
  constructor(
    private readonly pages: PageStore,
    private readonly forge: () => ForgeAccountStore | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Whether this host has a GitHub login to publish with. */
  ready(): boolean {
    return !!this.forge()?.choiceId('https://github.com')
  }

  /** Deploys the page's current version; a page already live on GitHub Pages updates the same site. */
  async publish(artifactId: string, signal?: AbortSignal): Promise<ArtifactInfo> {
    const page = this.pages.get(artifactId)
    if (page.capabilities.records || page.capabilities.ai)
      throw new Error(
        'This artifact keeps records or uses a model on this host, so it cannot go on the web as it is. Make it a project instead.',
      )
    const account = await this.forge()?.resolve('https://github.com')
    if (account?.kind !== 'saved') throw new Error('Connect a GitHub account in Settings → Git hosting first.')
    const document = this.pages.document(artifactId)
    // The runnable export: the tested bytes with their isolation policy, opening on the page's saved values.
    const exported = interactiveExport(document, this.pages.state(artifactId).state, false)
    const html = exported.html.replace(
      '<head>',
      `<head><title>${page.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>`,
    )
    const site = {
      name: page.title,
      ...(page.published?.target === GITHUB_PAGES && page.published.siteId ? { siteId: page.published.siteId } : {}),
    }
    const deployed = await githubPages(this.fetcher).deploy(
      [{ path: 'index.html', content: Buffer.from(html) }],
      site,
      account.token,
      signal,
    )
    this.pages.markPublished(artifactId, {
      target: GITHUB_PAGES,
      url: deployed.url,
      siteId: deployed.siteId,
      version: page.version,
      at: Date.now(),
    })
    return this.pages.get(artifactId)
  }
}
