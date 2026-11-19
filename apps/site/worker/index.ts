// getramu.dev's Worker. Only `/download/*` reaches it (see wrangler.jsonc); every other path is served straight from the
// static build. A download redirects to the newest release's file on GitHub, so the page never needs a redeploy for a
// new release, and anything GitHub cannot answer falls back to the Releases page instead of an error.
import { downloadUrl, type Release } from '../src/lib/downloads'

const RELEASES_API = 'https://api.github.com/repos/akalstack/ramu/releases?per_page=20'
const RELEASES_PAGE = 'https://github.com/akalstack/ramu/releases'
/** GitHub allows few anonymous API calls, so the list is reused for this long, here and in Cloudflare's cache. */
const CACHE_SECONDS = 300

let cached: { at: number; releases: Release[] } | null = null

async function releases(): Promise<Release[]> {
  if (cached && Date.now() - cached.at < CACHE_SECONDS * 1000) return cached.releases
  const init: RequestInit & { cf: { cacheTtl: number; cacheEverything: boolean } } = {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'getramu.dev' },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  }
  const response = await fetch(RELEASES_API, init)
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  const list = (await response.json()) as Release[]
  cached = { at: Date.now(), releases: list }
  return list
}

const redirect = (location: string, seconds: number) =>
  new Response(null, { status: 302, headers: { Location: location, 'Cache-Control': `public, max-age=${seconds}` } })

export default {
  async fetch(request: Request, env: { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const { pathname } = new URL(request.url)
    const match = /^\/download\/([a-z0-9-]+)\/?$/.exec(pathname)
    if (!match) return env.ASSETS.fetch(request)
    try {
      const url = downloadUrl(match[1]!, await releases())
      return redirect(url ?? RELEASES_PAGE, url ? CACHE_SECONDS : 60)
    } catch {
      return redirect(RELEASES_PAGE, 60)
    }
  },
}
