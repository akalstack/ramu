import type { InteractiveFile } from '@ramu/shared/interactive'
import { INTERACTIVE_MAX_FILES, isInteractiveAsset } from '@ramu/shared/interactive'

const PATH = /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*$/
const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  mp4: 'video/mp4',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  bin: 'application/octet-stream',
  ktx2: 'image/ktx2',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  json: 'application/json',
  txt: 'text/plain',
  csv: 'text/csv',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
}
const extension = (path: string) => path.slice(path.lastIndexOf('.') + 1).toLowerCase()
const dirname = (path: string) => path.slice(0, path.lastIndexOf('/') + 1)
/** References outside the project (absolute URLs, fragments, data) are left for the runtime policy to handle. */
const external = (ref: string) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref) || ref.trim() === ''

/**
 * An App's assets travel once, in a data block at the top of the document. `ramuAsset(path)` turns one into a blob URL
 * when it is first used (a GLTFLoader, an Audio, a texture), and elements whose source names an asset get it the same
 * way, so a 20 MB model is decoded only when the game asks for it.
 */
const ASSET_RUNTIME = `(()=>{const d=JSON.parse(document.getElementById('ramu-assets').textContent),m={},t=${JSON.stringify(MIME)};
const url=p=>{p=String(p).replace(/^\\.?\\//,'');if(m[p])return m[p];const b=d[p];if(b===undefined)throw new Error('No asset '+p+' in this artifact.');const s=atob(b),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return m[p]=URL.createObjectURL(new Blob([a],{type:t[p.slice(p.lastIndexOf('.')+1).toLowerCase()]||'application/octet-stream'}))};
Object.defineProperty(window,'ramuAsset',{value:url});const fill=()=>document.querySelectorAll('[data-ramu-asset]').forEach(e=>e.setAttribute(e.getAttribute('data-ramu-asset-attr')||'src',url(e.getAttribute('data-ramu-asset'))));
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',fill,{once:true});else fill()})();`

/** The data block and resolver for an App's assets, or nothing when it has none. */
export function assetBlock(files: InteractiveFile[]): string {
  const assets = files.filter(isInteractiveAsset)
  if (!assets.length) return ''
  const data = JSON.stringify(Object.fromEntries(assets.map((file) => [file.path, file.content])))
  return `<script type="application/json" id="ramu-assets">${data}</script><script>${ASSET_RUNTIME}</script>`
}

export function validateInteractiveFiles(files: InteractiveFile[], entry: string) {
  if (!files.length) throw new Error('Provide at least one file.')
  if (files.length > INTERACTIVE_MAX_FILES) throw new Error(`Use at most ${INTERACTIVE_MAX_FILES} files.`)
  const seen = new Set<string>()
  for (const file of files) {
    if (!PATH.test(file.path) || file.path.split('/').some((part) => part === '.' || part === '..'))
      throw new Error(`Invalid file path ${JSON.stringify(file.path)}. Use relative paths like "src/app.js".`)
    if (seen.has(file.path)) throw new Error(`Duplicate file ${file.path}.`)
    seen.add(file.path)
    if (file.encoding === 'base64' && !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content))
      throw new Error(`${file.path} is not valid base64.`)
  }
  if (!seen.has(entry)) throw new Error(`Entry file ${entry} is missing.`)
  if (!/\.html?$/i.test(entry)) throw new Error('The entry file must be HTML.')
}

/**
 * Inline a small multi-file project into one document. The isolated renderer has no file origin, so stylesheets,
 * classic scripts and assets become inline content or data URIs; every runtime keeps receiving a single document.
 */
export function bundleInteractive(files: InteractiveFile[], entry = 'index.html'): string {
  validateInteractiveFiles(files, entry)
  const byPath = new Map(files.map((file) => [file.path, file]))
  const resolve = (from: string, ref: string) => {
    const clean = decodeURI(ref.split(/[?#]/)[0]!)
    const parts: string[] = []
    for (const part of (clean.startsWith('/') ? clean.slice(1) : dirname(from) + clean).split('/')) {
      if (part === '' || part === '.') continue
      if (part === '..') {
        if (!parts.pop()) throw new Error(`${from} references ${ref}, which is outside the project.`)
      } else parts.push(part)
    }
    const path = parts.join('/')
    const file = byPath.get(path)
    if (!file) throw new Error(`${from} references ${ref}, but no file ${path} was provided.`)
    return file
  }
  const text = (file: InteractiveFile) =>
    file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content
  const dataUri = (file: InteractiveFile) => {
    const mime = MIME[extension(file.path)] ?? 'application/octet-stream'
    const base64 = file.encoding === 'base64' ? file.content : Buffer.from(file.content, 'utf8').toString('base64')
    return `data:${mime};base64,${base64}`
  }
  const css = (file: InteractiveFile, depth = 0): string => {
    if (depth > 8) throw new Error(`Stylesheet imports nest too deeply at ${file.path}.`)
    return text(file)
      .replace(/@import\s+(?:url\(\s*)?(['"]?)([^'")\s;]+)\1\s*\)?\s*;/g, (match, _q, ref: string) =>
        external(ref) ? match : css(resolve(file.path, ref), depth + 1),
      )
      .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _q, ref: string) =>
        external(ref) ? match : `url(${dataUri(resolve(file.path, ref))})`,
      )
      .replace(/<\/style/gi, '<\\/style')
  }
  // A real import/export in a classic script surfaces as a preview error; text that merely mentions one is fine.
  const script = (file: InteractiveFile) => text(file).replace(/<\/script/gi, '<\\/script')
  const attribute = (attrs: string, name: string) =>
    attrs
      .match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
      ?.slice(1)
      .find(Boolean)
  const without = (attrs: string, name: string) =>
    attrs.replace(new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i'), '')
  const html = (file: InteractiveFile) => {
    // Scripts and textarea text are set aside first so markup inside them is never rewritten.
    const scripts: string[] = []
    const hold = (value: string) => `\u0000ramu-held-${scripts.push(value) - 1}\u0000`
    return (
      text(file)
        .replace(/<textarea\b[^>]*>[\s\S]*?<\/textarea\s*>/gi, hold)
        .replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (match, attrs: string, body: string) => {
          const src = attribute(attrs, 'src')
          if (!src || external(src) || body.trim()) return hold(match)
          if (/\stype\s*=\s*["']?module/i.test(attrs))
            throw new Error(
              `${file.path} loads ${src} as a module. Use classic scripts and share values through globals.`,
            )
          return hold(`<script${without(attrs, 'src')}>${script(resolve(file.path, src))}</script>`)
        })
        .replace(/<link\b([^>]*)>/gi, (match, attrs: string) => {
          const href = attribute(attrs, 'href')
          if (!href || external(href)) return match
          const rel = attribute(attrs, 'rel')?.toLowerCase() ?? ''
          if (rel.split(/\s+/).includes('stylesheet')) return `<style>${css(resolve(file.path, href))}</style>`
          return /icon|preload|manifest/.test(rel) ? '' : match
        })
        .replace(
          /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
          (_match, attrs: string, body: string) => `<style${attrs}>${css({ path: file.path, content: body })}</style>`,
        )
        .replace(
          /(<(?:img|source|audio|video|track|image|use|input|embed)\b[^>]*?\s)(src|poster|href|xlink:href)(\s*=\s*)(["'])([^"']*)\4/gi,
          (match, start: string, name: string, equals: string, quote: string, ref: string) => {
            if (external(ref)) return match
            const target = resolve(file.path, ref)
            // An asset is filled from the data block when the page loads, so its bytes are not in the document twice.
            return isInteractiveAsset(target)
              ? `${start}data-ramu-asset=${quote}${target.path}${quote} data-ramu-asset-attr=${quote}${name}${quote}`
              : `${start}${name}${equals}${quote}${dataUri(target)}${quote}`
          },
        )
        .replace(
          /(\sstyle\s*=\s*)(["'])([^"']*url\([^"']*)\2/gi,
          (_match, prefix: string, quote: string, body: string) =>
            `${prefix}${quote}${css({ path: file.path, content: body })}${quote}`,
        )
        // eslint-disable-next-line no-control-regex -- NUL delimits held placeholders; stripped input cannot contain it
        .replace(/\u0000ramu-held-(\d+)\u0000/g, (_match, index: string) => scripts[Number(index)]!)
    )
  }
  return assetBlock(files) + html(byPath.get(entry)!)
}
