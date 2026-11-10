import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { interactiveExport } from '@ramu/shared/interactiveExport'
import { DEPLOY_TARGET_PLUGINS } from '@ramu/shared/stacks'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import type { ForgeAccountStore } from '../workspace/forgeAccounts'
import type { PluginService } from '../plugins/service'
import { runPluginCli } from '../plugins/cli'
import { githubPages, slug, type Deployed } from '../hosting/staticSite'
import type { PageStore } from './pages'

/** Where a page can be published: the person's own GitHub Pages or Cloudflare Pages. */
export const STATIC_TARGETS = ['github-pages', 'cloudflare-pages'] as const
export type StaticTarget = (typeof STATIC_TARGETS)[number]
const NAMES: Record<StaticTarget, string> = { 'github-pages': 'GitHub Pages', 'cloudflare-pages': 'Cloudflare Pages' }
const CLOUDFLARE = DEPLOY_TARGET_PLUGINS.cloudflare

/**
 * The production address of a Cloudflare Pages project in wrangler's output. It prints the deployment's own address,
 * `https://<deployment>.<project>.pages.dev`; the project's address is that without the first label.
 */
export function pagesAddress(output: string): string | null {
  const found = output.match(/https:\/\/[a-z0-9.-]+\.pages\.dev\b/gi)?.at(-1)
  if (!found) return null
  const labels = new URL(found).hostname.toLowerCase().split('.')
  return `https://${(labels.length > 3 ? labels.slice(1) : labels).join('.')}`
}

/**
 * Publish to the web: a page's exact tested bytes as a one-file static site on the person's own account. GitHub Pages
 * uses the GitHub login saved in Settings; Cloudflare Pages runs wrangler through the Cloudflare CLI plugin, signed in
 * with the token saved for it in Customize → Plugins.
 */
export class PagePublisher {
  constructor(
    private readonly pages: PageStore,
    private readonly forge: () => ForgeAccountStore | undefined,
    private readonly plugins: Pick<PluginService, 'clis' | 'secret' | 'hasCredential'> | undefined,
    private readonly fetcher: typeof fetch = fetch,
    private readonly run: typeof runPluginCli = runPluginCli,
  ) {}

  /** Each platform, and whether this host can publish there without asking for a sign-in. */
  targets(): { target: StaticTarget; name: string; connected: boolean }[] {
    return STATIC_TARGETS.map((target) => ({
      target,
      name: NAMES[target],
      connected:
        target === 'github-pages'
          ? !!this.forge()?.choiceId('https://github.com')
          : !!this.plugins?.hasCredential(CLOUDFLARE, 'token'),
    }))
  }

  private async githubPages(html: string, site: { name: string; siteId?: string }, signal?: AbortSignal) {
    const account = await this.forge()?.resolve('https://github.com')
    if (account?.kind !== 'saved') throw new Error('Connect a GitHub account in Settings → Git hosting first.')
    return githubPages(this.fetcher).deploy(
      [{ path: 'index.html', content: Buffer.from(html) }],
      site,
      account.token,
      signal,
    )
  }

  private async cloudflarePages(
    html: string,
    site: { name: string; siteId?: string },
    signal?: AbortSignal,
  ): Promise<Deployed> {
    const target = this.plugins?.clis(null).find((entry) => entry.plugin === CLOUDFLARE)
    const secret = target?.slot ? await this.plugins?.secret(target.pluginId, target.slot.id) : null
    if (!target || !secret)
      throw new Error('Install the Cloudflare CLI plugin and save its token in Customize → Plugins first.')
    const project = site.siteId ?? slug(site.name)
    const folder = await mkdtemp(join(tmpdir(), 'ramu-publish-'))
    try {
      await writeFile(join(folder, 'index.html'), html)
      // A first publish makes the project; when it already exists the deploy below goes to it.
      if (!site.siteId)
        await this.run(
          target,
          ['pages', 'project', 'create', project, '--production-branch', 'main'],
          folder,
          secret,
          signal,
        )
      const ran = await this.run(
        target,
        ['pages', 'deploy', folder, '--project-name', project, '--branch', 'main', '--commit-dirty=true'],
        folder,
        secret,
        signal,
      )
      const url = ran.exitCode === 0 ? pagesAddress(ran.output) : null
      if (!url)
        throw new Error(
          `Cloudflare Pages did not take the page${ran.timedOut ? ' in time' : ''}. wrangler said:\n${ran.output.slice(-600)}`,
        )
      return { url, siteId: project }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }

  /** Deploys the page's current version; a page already live on this platform updates the same site. */
  async publish(artifactId: string, target: StaticTarget, signal?: AbortSignal): Promise<ArtifactInfo> {
    const page = this.pages.get(artifactId)
    if (page.capabilities.records || page.capabilities.ai)
      throw new Error(
        'This artifact keeps records or uses a model on this host, so it cannot go on the web as it is. Make it a project instead.',
      )
    const document = this.pages.document(artifactId)
    // The runnable export: the tested bytes with their isolation policy, opening on the page's saved values.
    const exported = interactiveExport(document, this.pages.state(artifactId).state, false)
    const html = exported.html.replace(
      '<head>',
      `<head><title>${page.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>`,
    )
    const site = {
      name: page.title,
      ...(page.published?.target === target && page.published.siteId ? { siteId: page.published.siteId } : {}),
    }
    const deployed =
      target === 'github-pages'
        ? await this.githubPages(html, site, signal)
        : await this.cloudflarePages(html, site, signal)
    this.pages.markPublished(artifactId, {
      target,
      url: deployed.url,
      siteId: deployed.siteId,
      version: page.version,
      at: Date.now(),
    })
    return this.pages.get(artifactId)
  }
}
