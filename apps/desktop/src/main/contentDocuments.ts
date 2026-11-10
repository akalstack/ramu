import { randomUUID } from 'node:crypto'
import { INTERACTIVE_CSP } from '@ramu/shared/interactive'
/**
 * The largest document mounted: a game's 50 MB of assets, or a 100 MB model in the 3D viewer, as base64 inside the
 * page.
 */
export const MAX_CONTENT_DOCUMENT = 140_000_000

/** Ephemeral, capability-free document origin, independent of the workspace's script policy. */
export class ContentDocuments {
  private entries = new Map<string, string>()
  mount(html: unknown): string {
    if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_CONTENT_DOCUMENT)
      throw new Error('Invalid interactive document')
    if (this.entries.size >= 4) throw new Error('Too many open interactive documents')
    const url = `ramu-content://${randomUUID()}/document`
    this.entries.set(url, html)
    return url
  }
  has(url: string) {
    return this.entries.has(url)
  }
  release(url: unknown) {
    if (typeof url === 'string') this.entries.delete(url)
  }
  clear() {
    this.entries.clear()
  }
  response(url: string): Response {
    const html = this.entries.get(url)
    return new Response(html ?? 'Document closed', {
      status: html === undefined ? 404 : 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `${INTERACTIVE_CSP}; sandbox allow-scripts`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }
}
