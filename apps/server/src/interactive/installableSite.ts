import { createHash } from 'node:crypto'
import { chromium } from 'playwright-core'
import { ensureInteractiveBrowser } from './browser'

/** One file of the published site, at its path from the site root. */
interface SiteFile {
  path: string
  content: Buffer
}

/** The app icon as PNGs at the sizes browsers ask for before they offer to install a site. */
export interface AppIcons {
  192: Buffer
  512: Buffer
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'))

/** The artifact's emoji centered on a plain tile, inside the safe zone a maskable icon keeps. */
const iconSvg = (icon: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#f4f4f5"/><text x="256" y="256" font-size="300" text-anchor="middle" dominant-baseline="central">${escapeHtml(icon)}</text></svg>`

/**
 * Widens the export's isolation policy only for the site's own manifest, icons and service worker. Scripts, styles,
 * connections and frames stay exactly as tested.
 */
function allowSiteFiles(html: string): string {
  let found = false
  const next = html.replace(
    /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/,
    (_, open, csp, close) => {
      found = true
      const policy = (csp as string)
        .replace(/(^|; )img-src /, `$1img-src 'self' `)
        .replace(/(^|; )worker-src /, `$1worker-src 'self' `)
      return `${open}${policy}; manifest-src 'self'${close}`
    },
  )
  if (!found) throw new Error('The exported page has no isolation policy to publish with.')
  return next
}

/**
 * Registers the service worker and, when a newer published version has been fetched in the background, offers to
 * reload into it, and reloads only when the person asks. The first visit installs quietly; checking again whenever the window comes back to the front lets an
 * app left open notice Update live site.
 */
const UPDATE_SCRIPT = `(()=>{if(!('serviceWorker' in navigator))return;const sw=navigator.serviceWorker,id=/^id\\b/i.test(navigator.language||'');let wanted=false;
sw.addEventListener('controllerchange',()=>{if(wanted){wanted=false;location.reload()}});
const offer=w=>{if(!sw.controller||document.querySelector('ramu-update'))return;const host=document.createElement('ramu-update'),root=host.attachShadow({mode:'open'}),bar=document.createElement('div'),text=document.createElement('span'),button=document.createElement('button');
bar.setAttribute('role','status');bar.style.cssText='position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:12px;align-items:center;padding:8px 8px 8px 14px;border-radius:10px;background:#18181b;color:#fafafa;font:13px/1.4 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:calc(100vw - 32px)';
text.textContent=id?'Versi baru tersedia.':'A new version is available.';button.type='button';button.textContent=id?'Muat ulang':'Reload';button.style.cssText='border:0;border-radius:6px;padding:4px 10px;background:#fafafa;color:#18181b;font:inherit;font-weight:600;cursor:pointer';
button.addEventListener('click',()=>{button.disabled=true;wanted=true;w.postMessage('ramu-update')});bar.append(text,button);root.append(bar);document.body.append(host)};
sw.register('./sw.js').then(reg=>{if(reg.waiting)offer(reg.waiting);reg.addEventListener('updatefound',()=>{const w=reg.installing;if(w)w.addEventListener('statechange',()=>{if(w.state==='installed')offer(w)})});document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')reg.update().catch(()=>{})})}).catch(()=>{})})()`

/**
 * Serves the published version from its own cache, so the installed app opens at once and offline. A new publish
 * changes this file, which is how browsers notice an update; the new version waits until the person reloads into it.
 */
const serviceWorker = (
  cache: string,
  files: string[],
) => `const CACHE=${JSON.stringify(cache)},FILES=${JSON.stringify(files)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{cache:'reload'}))))));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('ramu-site-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('message',e=>{if(e.data==='ramu-update')self.skipWaiting()});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;e.respondWith(caches.open(CACHE).then(c=>c.match(r,{ignoreSearch:true})).then(hit=>hit||fetch(r)))});
`

/**
 * The files of an artifact published to the web as a site a browser can install as an app: the runnable export with a
 * title, manifest and icons, plus a service worker that keeps it working offline and offers each newer version. Paths
 * are relative, so the site works under a GitHub Pages project path.
 */
export function installableSite(
  page: { title: string; icon: string; version: number },
  exportedHtml: string,
  icons: AppIcons | null,
): SiteFile[] {
  const title = escapeHtml(page.title)
  const iconFiles: SiteFile[] = [
    { path: 'icon.svg', content: Buffer.from(iconSvg(page.icon)) },
    ...(icons
      ? [
          { path: 'icon-192.png', content: icons[192] },
          { path: 'icon-512.png', content: icons[512] },
        ]
      : []),
  ]
  const manifest = {
    id: './',
    name: page.title,
    short_name: page.title.length > 30 ? `${page.title.slice(0, 29)}…` : page.title,
    start_url: './',
    scope: './',
    display: 'standalone',
    icons: [
      { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ...(icons
        ? [192, 512].flatMap((size) =>
            ['any', 'maskable'].map((purpose) => ({
              src: `icon-${size}.png`,
              sizes: `${size}x${size}`,
              type: 'image/png',
              purpose,
            })),
          )
        : []),
    ],
  }
  const head = [
    `<title>${title}</title>`,
    '<link rel="manifest" href="manifest.webmanifest">',
    '<link rel="icon" href="icon.svg" type="image/svg+xml">',
    ...(icons ? ['<link rel="apple-touch-icon" href="icon-192.png">'] : []),
    `<meta name="apple-mobile-web-app-title" content="${title}">`,
  ].join('')
  const html = allowSiteFiles(exportedHtml)
    .replace('<head>', `<head>${head}`)
    .replace(/<\/body>(?![\s\S]*<\/body>)/, `<script>${UPDATE_SCRIPT}</script></body>`)
  const files: SiteFile[] = [
    ...iconFiles,
    { path: 'manifest.webmanifest', content: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { path: 'index.html', content: Buffer.from(html) },
  ]
  const digest = createHash('sha256')
  for (const file of files) digest.update(file.path).update(file.content)
  const cache = `ramu-site-v${page.version}-${digest.digest('hex').slice(0, 12)}`
  // The worker goes last: browsers see a new version only once the files it caches are in place.
  return [
    ...files,
    {
      path: 'sw.js',
      content: Buffer.from(
        serviceWorker(cache, ['./', ...files.filter((f) => f.path !== 'index.html').map((f) => f.path)]),
      ),
    },
  ]
}

/**
 * Draws the app icon in the host's sandboxed browser, with no network. Null when the browser can't be used, so the
 * site still publishes with its vector icon.
 */
export async function drawAppIcons(icon: string, signal?: AbortSignal): Promise<AppIcons | null> {
  try {
    const executablePath = await ensureInteractiveBrowser(signal)
    const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true, timeout: 10_000 })
    try {
      const context = await browser.newContext({ viewport: { width: 512, height: 512 }, serviceWorkers: 'block' })
      await context.route('**/*', (route) => route.abort('blockedbyclient'))
      const view = await context.newPage()
      await view.setContent(`<!doctype html><html><body style="margin:0">${iconSvg(icon)}</body></html>`)
      const draw = async (size: 192 | 512) => {
        await view.setViewportSize({ width: size, height: size })
        await view.locator('svg').evaluate((svg, px) => {
          svg.setAttribute('width', String(px))
          svg.setAttribute('height', String(px))
          svg.style.display = 'block'
        }, size)
        return view.locator('svg').screenshot({ type: 'png', omitBackground: false, timeout: 5000 })
      }
      return { 192: await draw(192), 512: await draw(512) }
    } finally {
      await browser.close().catch(() => {})
    }
  } catch {
    return null
  }
}
