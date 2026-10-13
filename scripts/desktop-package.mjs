// Packages the desktop app. Electron Forge's dependency walker only looks in an app's own node_modules (and then
// skips the repository root for apps/desktop), so it cannot see the hoisted workspace install. This stages a
// self-contained copy of the app and its installed production dependencies, then runs Forge there.
//
// Usage: node scripts/desktop-package.mjs <package|make> [forge options]
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'

const root = realpathSync(resolve(import.meta.dirname, '..'))
const desktop = join(root, 'apps', 'desktop')

/** Node's lookup: the nearest node_modules/<name> from `from` upward. */
function find(from, name) {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate)
    if (dirname(dir) === dir) return null
  }
}

/** Every installed package the app needs at runtime: dependencies and present optionalDependencies, transitively. */
export function productionClosure(appDir) {
  const seen = new Map()
  const visit = (dir) => {
    if (seen.has(dir)) return
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    seen.set(dir, manifest.name)
    for (const name of Object.keys(manifest.dependencies ?? {})) {
      const found = find(dir, name)
      if (!found) throw new Error(`Cannot find ${name}, required by ${manifest.name}. Run pnpm install.`)
      visit(found)
    }
    for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
      const found = find(dir, name)
      if (found) visit(found)
    }
  }
  const app = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
  for (const name of Object.keys(app.dependencies ?? {})) {
    const found = find(appDir, name)
    if (!found) throw new Error(`Cannot find ${name}, required by the desktop app. Run pnpm install.`)
    visit(found)
  }
  return [...seen.keys()]
}

/** Where a package lands in the stage: the same place in the tree, with apps/desktop standing in for the root. */
export function stagePath(stage, packageDir) {
  const own = join(desktop, 'node_modules') + sep
  const relativePath = packageDir.startsWith(own) ? join('node_modules', packageDir.slice(own.length)) : relative(root, packageDir)
  return join(stage, relativePath)
}

function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (!['package', 'make'].includes(command)) { console.error('Usage: node scripts/desktop-package.mjs <package|make> [forge options]'); process.exit(1) }
  // A shell with ELECTRON_RUN_AS_NODE set would make Forge's Electron helpers run as plain Node.
  delete process.env.ELECTRON_RUN_AS_NODE
  const run = (file, args, cwd, env = {}) => execFileSync(file, args, { cwd, stdio: 'inherit', env: { ...process.env, ...env } })

  run('pnpm', ['--filter', '@ramu/desktop', 'build'], root)
  // Outside the repository, so nothing in the copy is mistaken for workspace source.
  const stageParent = mkdtempSync(join(realpathSync(tmpdir()), 'ramu-package-'))
  const stage = join(stageParent, 'app')
  try {
    mkdirSync(stage)
    // Forge reads the Electron version from an installed `electron` package. A stub is enough: the real binary comes
    // from Forge's download cache, and dev dependencies never reach the packaged app.
    const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
    const manifest = JSON.parse(readFileSync(join(desktop, 'package.json'), 'utf8'))
    writeFileSync(join(stage, 'package.json'), JSON.stringify({ ...manifest, scripts: undefined, devDependencies: { electron: electronVersion } }, null, 2))
    mkdirSync(join(stage, 'node_modules', 'electron'), { recursive: true })
    writeFileSync(join(stage, 'node_modules', 'electron', 'package.json'), JSON.stringify({ name: 'electron', version: electronVersion }))
    // Forge's preflight checks the package manager's linker from the app directory; the stage mirrors the hoisted install.
    writeFileSync(join(stage, 'pnpm-workspace.yaml'), 'nodeLinker: hoisted\n')
    cpSync(join(desktop, 'forge.config.cjs'), join(stage, 'forge.config.cjs'))
    cpSync(join(desktop, 'out'), join(stage, 'out'), { recursive: true })
    if (!existsSync(join(stage, 'out', 'main', 'daemon.js'))) throw new Error('The desktop build did not produce out/main/daemon.js')
    const packages = productionClosure(desktop)
    for (const dir of packages) {
      // Nested node_modules are separate entries in the closure, so each is copied once, at its own location.
      cpSync(dir, stagePath(stage, dir), { recursive: true, dereference: true, filter: (source) => source !== join(dir, 'node_modules') })
    }
    console.log(`Staged ${packages.length} production packages`)
    run(join(root, 'node_modules', '.bin', 'electron-forge'), [command, ...rest], stage, { RAMU_REPO_ROOT: root })
  } finally { rmSync(stageParent, { recursive: true, force: true }) }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(import.meta.filename)) main()
