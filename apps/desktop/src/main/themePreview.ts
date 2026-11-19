import { realpath } from 'node:fs/promises'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const THEME_PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ')
const extensions = new Set([
  '.js',
  '.mjs',
  '.ts',
  '.tsx',
  '.css',
  '.json',
  '.woff',
  '.woff2',
  '.ttf',
  '.svg',
  '.png',
  '.wasm',
])
const within = (root: string, path: string) => {
  const rest = relative(root, path)
  return !!rest && rest !== '..' && !rest.startsWith('../') && !rest.startsWith('..\\') && !isAbsolute(rest)
}
function previewUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    return url.protocol === 'ramu-theme:' && url.hostname === 'preview' && !url.port && !url.username && !url.password
      ? url
      : null
  } catch {
    return null
  }
}
/** Only a direct shell child may navigate to this fixed, app-authored document. */
export function isThemePreviewDocument(value: string): boolean {
  const url = previewUrl(value)
  return !!url && url.pathname === '/theme-editor.html' && !url.search
}

/** Serves packaged renderer assets, or the same source modules from the configured Vite server in development. */
export async function themePreviewResponse(
  value: string,
  options: {
    rendererRoot: string
    sourceRoot: string
    devUrl?: string
    fetch(url: string): Promise<Response>
  },
): Promise<Response> {
  const missing = () => new Response('Preview unavailable', { status: 404 })
  const url = previewUrl(value)
  if (!url) return missing()
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return missing()
  }
  if (path.includes('\\') || path.includes('\0')) return missing()
  const entry = path === '/theme-editor.html'
  let target: string
  if (options.devUrl) {
    const special = path === '/@vite/client' || path === '/@react-refresh'
    let module = false
    if (extensions.has(extname(path))) {
      const file = path.startsWith('/@fs/')
        ? resolve(path.slice(4).replace(/^\/([A-Za-z]:\/)/, '$1'))
        : path.startsWith('/src/') || path.startsWith('/node_modules/')
          ? resolve(options.sourceRoot, 'apps/web', '.' + path)
          : null
      if (file) {
        try {
          module = within(await realpath(options.sourceRoot), await realpath(file))
        } catch {}
      }
    }
    if (!entry && !special && !module) return missing()
    const dev = new URL(options.devUrl)
    dev.pathname = path
    dev.search = url.search
    dev.hash = ''
    target = dev.href
  } else {
    if (!entry && !(path.startsWith('/assets/') && extensions.has(extname(path)))) return missing()
    try {
      const root = await realpath(options.rendererRoot)
      const file = await realpath(resolve(root, '.' + path))
      if (!within(root, file)) return missing()
      target = pathToFileURL(file).href
    } catch {
      return missing()
    }
  }
  try {
    const response = await options.fetch(target)
    if (!response.ok) return missing()
    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
        'Content-Security-Policy': THEME_PREVIEW_CSP,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return missing()
  }
}
