// Stages the workspace server as the npm package behind `npx @akalstack/ramu`: the built bundle (`apps/server/dist`,
// with Ramu's own packages already inlined) and a manifest whose dependencies are the third-party packages it loads.
// Usage: node scripts/release/npm-package.mjs <out-dir>   (run `pnpm --filter @ramu/server build` first)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { builtinModules, createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const NPM_PACKAGE = '@akalstack/ramu'

/** Third-party packages the bundle imports by name: the top-level package of each bare, non-builtin specifier. */
export function importedPackages(sources) {
  const found = new Set()
  const patterns = [
    /^\s*(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']/gm,
    /^\s*import\s*["']([^"']+)["']/gm,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ]
  for (const source of sources)
    for (const pattern of patterns)
      for (const [, specifier] of source.matchAll(pattern)) {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) continue
        const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
        // npm names are lowercase; anything else is text inside a string, such as Swift helper source.
        if (/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/.test(name) && !builtinModules.includes(name)) found.add(name)
      }
  return [...found].sort()
}

/**
 * The published manifest. Its dependencies are the server's own runtime dependencies (some load by path rather than
 * import) plus whatever else the bundle imports, versioned by the inlined workspace package that declares it, with
 * pnpm's `catalog:` versions filled in. A package nobody declares fails the release rather than the person's install.
 */
export function npmManifest(server, { catalog, version, imported, inlined }) {
  const versionOf = (name, range) => {
    if (range === 'catalog:') {
      if (!catalog[name]) throw new Error(`${name} uses catalog: but the workspace catalog has no version for it`)
      return catalog[name]
    }
    if (String(range).startsWith('workspace:')) throw new Error(`${name} is a workspace package; the bundle inlines it`)
    return range
  }
  const dependencies = Object.fromEntries(
    Object.entries(server.dependencies ?? {}).map(([name, range]) => [name, versionOf(name, range)]),
  )
  for (const name of imported) {
    if (dependencies[name] || name.startsWith('@ramu/')) continue
    const owner = inlined.find((manifest) => manifest.dependencies?.[name])
    if (!owner) throw new Error(`The server bundle imports ${name}, but no package declares it as a dependency`)
    dependencies[name] = versionOf(name, owner.dependencies[name])
  }
  return {
    name: NPM_PACKAGE,
    version,
    description: server.description,
    license: server.license,
    author: server.author,
    homepage: server.homepage,
    repository: server.repository,
    bugs: server.bugs,
    keywords: ['ai', 'agents', 'coding-agents', 'claude', 'codex', 'self-hosted'],
    type: 'module',
    bin: server.bin,
    files: ['dist', 'README.md', 'LICENSE'],
    engines: server.engines,
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))),
  }
}

const README = `# Ramu workspace server

Runs [Ramu](https://getramu.dev)'s workspace server (agents, files, Git, terminals and schedules) on a computer
without the desktop app, and controls it from the terminal. Needs Node.js 26. On Linux, \`node-pty\` builds on
install, so Python 3, \`make\` and a C++ compiler must be present (\`build-essential\` on Debian and Ubuntu).

\`\`\`sh
npx @akalstack/ramu serve --listen 0.0.0.0:7788 --private-network
npx @akalstack/ramu pair
\`\`\`

To keep it running as a service, install it first so the service does not depend on npx's cache:

\`\`\`sh
npm install --global @akalstack/ramu
ramu up
\`\`\`

\`ramu --help\` lists every command. Read the guide to
[hosts and remote access](https://github.com/akalstack/ramu/blob/main/docs/guide/remote-hosts.md) before opening a
host to the network.
`

function readCatalog(root) {
  // The yaml package is one of the server's own dependencies.
  const { parse } = createRequire(join(root, 'apps', 'server', 'package.json'))('yaml')
  return parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')).catalog ?? {}
}

function stage(root, out) {
  const dist = join(root, 'apps', 'server', 'dist')
  if (!existsSync(join(dist, 'cli.js'))) throw new Error('Build the server first: pnpm --filter @ramu/server build')
  const read = (path) => JSON.parse(readFileSync(path, 'utf8'))
  const server = read(join(root, 'apps', 'server', 'package.json'))
  const { version } = read(join(root, 'package.json'))
  const inlined = readdirSync(join(root, 'packages')).map((name) => read(join(root, 'packages', name, 'package.json')))
  const imported = importedPackages(
    readdirSync(dist)
      .filter((name) => name.endsWith('.js'))
      .map((name) => readFileSync(join(dist, name), 'utf8')),
  )
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })
  cpSync(dist, join(out, 'dist'), { recursive: true })
  cpSync(join(root, 'LICENSE'), join(out, 'LICENSE'))
  writeFileSync(join(out, 'README.md'), README)
  const manifest = npmManifest(server, { catalog: readCatalog(root), version, imported, inlined })
  writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const out = process.argv[2]
  if (!out) throw new Error('Usage: node scripts/release/npm-package.mjs <out-dir>')
  const manifest = stage(resolve(import.meta.dirname, '..', '..'), resolve(out))
  console.log(`Staged ${manifest.name}@${manifest.version} in ${resolve(out)}`)
}
