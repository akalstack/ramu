import { build, type Loader } from 'esbuild'
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import {
  checkInteractiveAssets,
  interactiveAssetAllowance,
  isInteractiveAsset,
  type InteractiveFile,
} from '@ramu/shared/interactive'
import { bundleInteractive, validateInteractiveFiles } from './bundle'

const require = createRequire(import.meta.url)
/** Deliberately small, pinned browser dependencies. No author-controlled installs or filesystem resolution. */
export const INTERACTIVE_LIBRARIES = [
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  'chart.js',
  'chart.js/auto',
  'chart.js/helpers',
  '@dagrejs/dagre',
  'three',
  'three/addons/loaders/GLTFLoader.js',
  'three/addons/controls/OrbitControls.js',
  'three/addons/utils/SkeletonUtils.js',
] as const
export const INTERACTIVE_MAX_ARTIFACT = 1_500_000

/** Versions this build shipped with, used when a library cannot be read where the host runs. */
const SHIPPED_LIBRARIES: Record<string, string> = {
  react: '19.3.0',
  'react-dom': '19.3.0',
  'chart.js': '4.6.1',
  '@dagrejs/dagre': '2.0.4',
  three: '0.186.1',
}
/** The versions the bundled libraries actually are, recorded with each version so a change can be noticed. */
export function pinnedLibraries(): Record<string, string> {
  const versions: Record<string, string> = {}
  for (const [name, shipped] of Object.entries(SHIPPED_LIBRARIES)) {
    versions[name] = shipped
    try {
      // Some packages do not export package.json; find it beside their entry instead.
      let dir = dirname(require.resolve(name))
      for (let depth = 0; depth < 5; depth++, dir = dirname(dir)) {
        const file = join(dir, 'package.json')
        if (!existsSync(file)) continue
        const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string }
        if (pkg.name === name && pkg.version) {
          versions[name] = pkg.version
          break
        }
      }
    } catch {
      // Keep the shipped version.
    }
  }
  return versions
}
/**
 * three's ES module build, so an App's own imports and the add-ons' imports of `three` meet in one copy; its CommonJS
 * entry would bundle a second.
 */
function libraryPath(name: string): string {
  if (name !== 'three' && !name.startsWith('three/')) return require.resolve(name)
  const root = dirname(dirname(require.resolve('three')))
  return name === 'three' ? join(root, 'build', 'three.module.js') : join(root, 'examples', 'jsm', name.slice(13))
}
const text = (file: InteractiveFile) =>
  file.encoding === 'base64' ? Buffer.from(file.content, 'base64').toString('utf8') : file.content
const attr = (attrs: string, name: string) =>
  attrs
    .match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
    ?.slice(1)
    .find(Boolean)

/** Compile only the supplied virtual project. Package resolution is entered exclusively through the allowlist. */
export async function compileInteractive(files: InteractiveFile[], entry = 'index.html'): Promise<string> {
  validateInteractiveFiles(files, entry)
  checkInteractiveAssets(files)
  const sources = new Map(files.map((file) => [file.path, file]))
  const root = sources.get(entry)!
  const scripts = [...text(root).matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(
    (match) => attr(match[1]!, 'type')?.toLowerCase() === 'module',
  )
  if (!scripts.length) return bundleInteractive(files, entry)
  const replacements = new Map<string, string>()
  for (const [index, match] of scripts.entries()) {
    const src = attr(match[1]!, 'src')
    if (src && !src.startsWith('.') && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src))
      throw new Error('Module scripts must be local project files. Bundle libraries with supported imports.')
    const inline = `__ramu_entry_${index}.tsx`
    const entryPath = src
      ? posix.normalize(posix.join(posix.dirname(entry), src))
      : posix.join(posix.dirname(entry), inline)
    if (!src) sources.set(entryPath, { path: entryPath, content: match[2]! })
    const result = await build({
      entryPoints: [entryPath],
      bundle: true,
      write: false,
      outfile: 'content.js',
      platform: 'browser',
      format: 'iife',
      target: ['es2022'],
      minify: true,
      jsx: 'automatic',
      logLevel: 'silent',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [
        {
          name: 'interactive-project',
          setup(builder) {
            builder.onResolve({ filter: /.*/ }, (args) => {
              if (args.kind === 'entry-point') return { path: args.path, namespace: 'project' }
              // Only trusted, pinned dependency code reaches the filesystem namespace.
              return undefined
            })
            builder.onResolve({ filter: /.*/, namespace: 'project' }, (args) => {
              if ((INTERACTIVE_LIBRARIES as readonly string[]).includes(args.path))
                return { path: libraryPath(args.path) }
              if (!args.path.startsWith('.') && !args.path.startsWith('/'))
                throw new Error(`Unsupported library ${args.path}. Available: ${INTERACTIVE_LIBRARIES.join(', ')}.`)
              if (args.path.startsWith('/')) throw new Error('Imports must stay inside the supplied project.')
              const base = posix.normalize(posix.join(posix.dirname(args.importer), args.path))
              const path = [
                base,
                ...['.ts', '.tsx', '.js', '.jsx', '.json', '/index.ts', '/index.tsx', '/index.js'].map(
                  (suffix) => base + suffix,
                ),
              ].find((candidate) => sources.has(candidate))
              if (!path) throw new Error(`Missing project import ${args.path} from ${args.importer}.`)
              return { path, namespace: 'project' }
            })
            builder.onLoad({ filter: /.*/, namespace: 'project' }, (args) => {
              const file = sources.get(args.path)
              if (!file) throw new Error(`Missing project file ${args.path}.`)
              // An imported asset is its URL, read from the document's data block when the page asks for it.
              if (isInteractiveAsset(file))
                return { contents: `export default window.ramuAsset(${JSON.stringify(file.path)})`, loader: 'js' }
              const extension = posix.extname(args.path).slice(1)
              const loader = (
                ['ts', 'tsx', 'js', 'jsx', 'json', 'css'].includes(extension) ? extension : 'dataurl'
              ) as Loader
              return {
                contents: file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content,
                loader,
              }
            })
          },
        },
      ],
    })
    const js = result.outputFiles.find((file) => file.path.endsWith('.js'))?.text ?? ''
    const css = result.outputFiles.find((file) => file.path.endsWith('.css'))?.text ?? ''
    // Module scripts defer until the document is parsed, including when the author places them in <head>.
    const deferred = `(()=>{const run=()=>{${js}\n};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run,{once:true});else run()})();`
    replacements.set(
      match[0],
      `${css ? `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>` : ''}<script>${deferred.replace(/<\/script/gi, '<\\/script')}</script>`,
    )
  }
  let html = text(root)
  for (const [from, to] of replacements) html = html.replace(from, () => to)
  const output = bundleInteractive(
    files.map((file) => (file.path === entry ? { ...file, content: html, encoding: 'utf8' } : file)),
    entry,
  )
  if (Buffer.byteLength(output) > INTERACTIVE_MAX_ARTIFACT + interactiveAssetAllowance(files))
    throw new Error('Compiled interactive content exceeds 1.5 MB. Use fewer dependencies or smaller assets.')
  return output
}
