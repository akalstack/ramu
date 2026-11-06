import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import { SavedCredential } from '../workspace/forge/savedCredential'
import type { ForgeAccountStore } from '../workspace/forgeAccounts'
import type { HostingAccounts } from '../workspace/deploy/accounts'
import { STATIC_TARGETS, staticAdapter, type StaticTarget } from '../hosting/staticSite'
import type { PageStore } from './pages'

type State = ConstructorParameters<typeof SavedCredential>[1]
type SetState = ConstructorParameters<typeof SavedCredential>[2]

/**
 * Publish to the web: a page's exact tested bytes as a one-file static site on the person's own account. GitHub Pages
 * uses the GitHub login saved in Settings, Netlify and Vercel the hosting accounts deploys use (Settings → Hosting
 * accounts), and Cloudflare Pages a token kept in the host's credential store.
 */
export class PagePublisher {
  private readonly cloudflare: SavedCredential<{ token: string; label?: string }>

  constructor(
    private readonly pages: PageStore,
    private readonly forge: () => ForgeAccountStore | undefined,
    private readonly hosting: HostingAccounts | undefined,
    getState: State,
    setState: SetState,
    private readonly fetcher: typeof fetch = fetch,
    credentials?: ConstructorParameters<typeof SavedCredential>[3],
  ) {
    this.cloudflare = new SavedCredential<{ token: string; label?: string }>(
      { key: 'hosting-cloudflare-pages', connectionId: 'hosting-cloudflare-pages', shown: 'label' },
      getState,
      setState,
      credentials,
    )
  }

  /** Each platform, and whether this host can deploy there without asking for a token. */
  targets(): { target: StaticTarget; name: string; connected: boolean }[] {
    return STATIC_TARGETS.map((target) => ({
      target,
      name: staticAdapter(target).name,
      connected:
        target === 'github-pages'
          ? !!this.forge()?.choiceId('https://github.com')
          : target === 'cloudflare-pages'
            ? !!this.cloudflare.savedField()
            : !!this.hosting?.connected(target),
    }))
  }

  /** A Cloudflare token limited to Pages may need the account ID beside it; it is kept with the token. */
  async saveCloudflareToken(token: string, account?: string) {
    const value = account?.trim() ? `${account.trim()}:${token.trim()}` : token.trim()
    await this.cloudflare.save({ token: value, label: 'Cloudflare Pages token' })
  }

  private async token(target: StaticTarget): Promise<string> {
    if (target === 'github-pages') {
      const account = await this.forge()?.resolve('https://github.com')
      if (account?.kind !== 'saved') throw new Error('Connect a GitHub account in Settings → Git hosting first.')
      return account.token
    }
    if (target === 'cloudflare-pages') {
      const saved = await this.cloudflare.read()
      if (!saved) throw new Error('Add a Cloudflare Pages token first.')
      return saved.token
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
