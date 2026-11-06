import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { interactiveCsp } from '@ramu/shared/interactive'
import { interactiveExport } from '@ramu/shared/interactiveExport'
import type { TunnelChoice } from '@ramu/shared/types'
import { declaredCapabilities, type PublicArtifactStatus } from '@ramu/shared/artifacts'
import { TunnelManager } from '../remote/tunnel'
import type { PageStore } from './pages'

interface Open {
  server: Server
  tunnel: TunnelManager
  since: number
}

/** A page that keeps nothing on the host and calls nothing back, so its bytes alone are the whole page. */
export function servableAlone(capabilities: Parameters<typeof declaredCapabilities>[0]): boolean {
  return declaredCapabilities(capabilities).length === 0
}

/**
 * Opens a page to anyone, without Ramu: each open page gets its own loopback listener on a random port that answers
 * only `GET /` with that page's exported bytes, and its own tunnel, so it has a hostname of its own that shares no
 * origin, port or cookie with Ramu's API. Only a page that uses no capability can be opened; the tunnel is the
 * person's own Cloudflare quick tunnel or ngrok, never Tailscale Funnel, which would put it on the host's own name.
 */
export class PublicPages {
  private readonly open = new Map<string, Open>()

  constructor(
    private readonly pages: PageStore,
    private readonly saved: { read(): string[]; write(ids: string[]): void },
    private readonly tunnels: (changed: () => void) => TunnelManager = (changed) => new TunnelManager({ changed }),
    private readonly changed: (artifactId: string) => void = () => {},
  ) {}

  /** Opens again, after a restart, the pages the person left open. */
  async restore(choice: TunnelChoice) {
    for (const id of this.saved.read()) await this.start(id, choice).catch(() => {})
  }

  async start(artifactId: string, choice: TunnelChoice): Promise<PublicArtifactStatus> {
    const page = this.pages.get(artifactId)
    if (!servableAlone(page.capabilities))
      throw new Error(
        'This page uses records, AI or other host features, so it cannot be opened to people without Ramu. Make it a project instead.',
      )
    if (choice.kind === 'tailscale')
      throw new Error(
        'Tailscale Funnel would serve the page on this host’s own name. Choose Cloudflare or ngrok in Remote access.',
      )
    if (choice.kind === 'ngrok' && choice.domain)
      throw new Error('A fixed ngrok domain belongs to this host. Use ngrok without a domain or Cloudflare.')
    if (this.open.has(artifactId)) return this.status(artifactId)
    const server = createServer((req, res) => {
      // One resource, read-only. Every other path, method and header-driven trick gets nothing.
      const path = (req.url ?? '/').split('?')[0]
      if (req.method !== 'GET' && req.method !== 'HEAD') return void res.writeHead(405, { Allow: 'GET' }).end()
      if (path !== '/') return void res.writeHead(404).end()
      let body: string
      try {
        const current = this.pages.get(artifactId)
        if (!servableAlone(current.capabilities)) return void res.writeHead(410).end()
        const document = this.pages.document(artifactId)
        body = interactiveExport(document, null, false).html.replace(
          '<head>',
          `<head><title>${current.title.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'))}</title>`,
        )
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': `${interactiveCsp(document.reference.network)}; sandbox allow-scripts`,
          'X-Content-Type-Options': 'nosniff',
          'Referrer-Policy': 'no-referrer',
          'Cross-Origin-Opener-Policy': 'same-origin',
          'Cache-Control': 'no-store',
          'X-Frame-Options': 'DENY',
        })
      } catch {
        return void res.writeHead(404).end()
      }
      res.end(req.method === 'HEAD' ? undefined : body)
    })
    server.headersTimeout = 10_000
    server.requestTimeout = 15_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => resolve())
    })
    const port = (server.address() as AddressInfo).port
    const tunnel = this.tunnels(() => this.changed(artifactId))
    this.open.set(artifactId, { server, tunnel, since: Date.now() })
    tunnel.use(choice, `http://127.0.0.1:${port}`)
    this.saved.write([...new Set([...this.saved.read(), artifactId])])
    this.changed(artifactId)
    return this.status(artifactId)
  }

  stop(artifactId: string) {
    const open = this.open.get(artifactId)
    this.open.delete(artifactId)
    open?.tunnel.stop()
    open?.server.close()
    this.saved.write(this.saved.read().filter((id) => id !== artifactId))
    this.changed(artifactId)
  }

  status(artifactId: string): PublicArtifactStatus {
    const open = this.open.get(artifactId)
    if (!open) return { state: 'off', url: null, error: null, since: null }
    const status = open.tunnel.status()
    return { state: status.state, url: open.tunnel.address(), error: status.error, since: open.since }
  }

  /** Port of a page's listener, for tests. */
  port(artifactId: string): number | null {
    const address = this.open.get(artifactId)?.server.address()
    return address && typeof address === 'object' ? address.port : null
  }

  close() {
    for (const [id, open] of this.open) {
      open.tunnel.stop()
      open.server.close()
      this.open.delete(id)
    }
  }
}
