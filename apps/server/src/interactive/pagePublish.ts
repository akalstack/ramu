import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import type { ForgeAccountStore } from '../workspace/forgeAccounts'
import type { HostingAccounts } from '../workspace/deploy/accounts'
import type { PluginService } from '../plugins/service'
import { STATIC_TARGETS, staticAdapter, type StaticTarget } from '../hosting/staticSite'
import type { PageStore } from './pages'

/**
 * Publish to the web: a page's exact tested bytes as a one-file static site on the person's own account. GitHub Pages
 * uses the GitHub login saved in Settings; Netlify and Vercel the hosting accounts deploys use (Settings → Deploy);
 * Cloudflare Pages the token saved for the Cloudflare plugin (Settings → Plugins).
 */
export class PagePublisher {
  constructor(
    private readonly pages: PageStore,
    private readonly forge: () => ForgeAccountStore | undefined,
    private readonly hosting: Pick<HostingAccounts, 'auth' | 'connected'> | undefined,
    private readonly plugins: Pick<PluginService, 'credentialOf' | 'hasCredential'> | undefined,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  /** Each platform, and whether this host can deploy there without asking for a token. */
  targets(): { target: StaticTarget; name: string; connected: boolean }[] {
    return STATIC_TARGETS.map((target) => ({
      target,
      name: staticAdapter(target).name,
      connected:
        target === 'github-pages'
          ? !!this.forge()?.choiceId('https://github.com')
          : target === 'cloudflare-pages'
            ? !!this.plugins?.hasCredential('cloudflare', 'token')
            : !!this.hosting?.connected(target),
    }))
  }

  private async token(target: StaticTarget): Promise<string> {
    if (target === 'github-pages') {
      const account = await this.forge()?.resolve('https://github.com')
      if (account?.kind !== 'saved') throw new Error('Connect a GitHub account in Settings → Git hosting first.')
      return account.token
    }
    if (target === 'cloudflare-pages') {
      const saved = await this.plugins?.credentialOf('cloudflare', 'token')
      if (!saved) throw new Error('Install the Cloudflare plugin and save its token in Settings → Plugins first.')
      // A token limited to Pages often cannot list accounts, so the account ID saved with it goes beside it; without
      // one, the first account the token reaches is used.
      const account = saved.fields.account?.trim()
      return account ? `${account}:${saved.token}` : saved.token
    }
    if (!this.hosting) throw new Error('Update this host to publish there.')
    return (await this.hosting.auth(target)).auth.token
  }

  /** Deploys the page's current version; a page already live on this platform updates the same site. */
  async publish(artifactId: string, target: StaticTarget, signal?: AbortSignal): Promise<ArtifactInfo> {
    const page = this.pages.get(artifactId)
    if (page.capabilities.records || page.capabilities.ai)
      throw new Error(
        'This page keeps records or uses a model on this host, so it cannot go on the web as it is. Make it a project instead.',
      )
    const document = this.pages.document(artifactId)
    // The runnable export: the tested bytes with their isolation policy, opening on the page's saved values.
    const exported = interactiveExport(document, this.pages.state(artifactId).state, false)
    const html = exported.html.replace(
      '<head>',
      `<head><title>${page.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>`,
    )
    const site = await staticAdapter(target, this.fetcher).deploy(
      [{ path: 'index.html', content: Buffer.from(html) }],
      {
        name: page.title,
        ...(page.published?.target === target && page.published.siteId ? { siteId: page.published.siteId } : {}),
      },
      await this.token(target),
      signal,
    )
    this.pages.markPublished(artifactId, {
      target,
      url: site.url,
      siteId: site.siteId,
      version: page.version,
      at: Date.now(),
    })
    return this.pages.get(artifactId)
  }
}
