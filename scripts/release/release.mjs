import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
export function versionOf(input) {
  const version = (input ?? '').replace(/^v/, '')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(version))
    throw new Error('Use a version such as 0.1.0 or 0.1.0-beta.1 (no build metadata).')
  if (
    version
      .split('-')
      .slice(1)
      .join('-')
      .split('.')
      .some((part) => /^0\d+$/.test(part))
  )
    throw new Error('Numeric prerelease identifiers cannot have leading zeros.')
  return version
}
export function collectAssets(source, destination, platform, arch) {
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch))
    throw new Error('Unsupported release target')
  const files = []
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(zip|dmg|deb|rpm|AppImage)$/.test(entry.name)) files.push(path)
    }
  }
  visit(source)
  if (!files.length) throw new Error('No installers found; run pnpm make first.')
  mkdirSync(destination, { recursive: true })
  const seen = new Set(),
    sums = []
  for (const file of files.sort()) {
    const name = `${platform}-${arch}-${basename(file)}`
    if (seen.has(name) || existsSync(join(destination, name))) throw new Error(`Duplicate asset: ${name}`)
    seen.add(name)
    const bytes = readFileSync(file)
    writeFileSync(join(destination, name), bytes)
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${name}`)
  }
  writeFileSync(join(destination, `SHA256SUMS-${platform}-${arch}.txt`), sums.join('\n') + '\n')
}
const isBot = (login) => !login || login.endsWith('[bot]')
// GitHub's generated notes credit only pull requests, so authors who pushed commits directly are added beside them.
/** The release body: the notes without their `# Ramu vX` title, which GitHub already shows as the release's name. */
export function releaseBody(notes) {
  return notes.replace(/^#\s+[^\n]*\n+/, '')
}

export function withCredits(notes, generated, commitAuthors) {
  const body = generated.trim()
  const named = new Set([...body.matchAll(/@([A-Za-z0-9-]+(?:\[bot\])?)/g)].map((match) => match[1]))
  const others = [...new Set(commitAuthors)].filter((login) => !isBot(login) && !named.has(login)).sort()
  const thanks = others.length ? `## Contributors\n\n${others.map((login) => `@${login}`).join(', ')}` : ''
  const credits = [thanks, body].filter(Boolean).join('\n\n')
  return credits ? `${notes.trimEnd()}\n\n${credits}\n` : notes
}
function ghJson(...args) {
  return JSON.parse(execFileSync('gh', ['api', ...args], { encoding: 'utf8' }))
}
// Semantic-version order: a prerelease sorts before its release, numeric identifiers compare as numbers.
export function compareVersions(a, b) {
  const [coreA, preA] = versionOf(a).split(/-(.*)/),
    [coreB, preB] = versionOf(b).split(/-(.*)/)
  const core = coreA.split('.').map(Number),
    other = coreB.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (core[i] !== other[i]) return core[i] - other[i]
  if (!preA || !preB) return (preA ? -1 : 0) - (preB ? -1 : 0)
  const partsA = preA.split('.'),
    partsB = preB.split('.')
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const x = partsA[i],
      y = partsB[i]
    if (x === undefined || y === undefined) return x === undefined ? -1 : 1
    if (x === y) continue
    const numeric = /^\d+$/.test(x) && /^\d+$/.test(y)
    return numeric ? Number(x) - Number(y) : x < y ? -1 : 1
  }
  return 0
}
// The previous release is the highest published version below this one; creation order can differ from version order.
function releaseCredits(tag, repo) {
  const previous = ghJson(`repos/${repo}/releases?per_page=100`)
    .filter((release) => !release.draft && /^v\d/.test(release.tag_name) && compareVersions(release.tag_name, tag) < 0)
    .map((release) => release.tag_name)
    .sort(compareVersions)
    .at(-1)
  const generated = ghJson(
    '--method',
    'POST',
    `repos/${repo}/releases/generate-notes`,
    '-f',
    `tag_name=${tag}`,
    ...(previous ? ['-f', `previous_tag_name=${previous}`] : []),
  ).body
  // Only the authors: the full comparison carries every changed file's diff, which overflows a large release's buffer.
  const authors = previous
    ? ghJson(`repos/${repo}/compare/${previous}...${tag}`, '--jq', '[.commits[].author.login // ""]')
    : []
  return { generated, authors }
}
// Every workspace package ships together; the desktop app reads its own package.json for app.getVersion().
function setWorkspaceVersions(version) {
  for (const group of ['apps', 'packages']) {
    if (!existsSync(resolve(group))) continue
    for (const name of readdirSync(resolve(group))) {
      const path = resolve(group, name, 'package.json')
      if (!existsSync(path)) continue
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      manifest.version = version
      writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
    }
  }
}
export function run(args) {
  const [command, input] = args
  if (!command || args.includes('--help')) {
    console.log(
      'Usage: pnpm release:prepare <version> [--dry-run]\n       pnpm release:verify <tag>\n       node scripts/release/release.mjs notes <tag> <owner/repo>\n       pnpm release:draft <tag> [--dry-run]\n       pnpm release:assets <platform> <arch>',
    )
    return
  }
  if (command === 'assets') {
    collectAssets(resolve('dist/make'), resolve('dist/release'), input, args[2])
    return
  }
  if (command === 'notes') {
    const tag = `v${versionOf(input)}`,
      repo = args[2]
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '')) throw new Error('Name the repository as owner/repo.')
    const notesPath = resolve('releases', `${tag}.md`)
    if (!existsSync(notesPath)) throw new Error(`Missing release notes: ${notesPath}`)
    const { generated, authors } = releaseCredits(tag, repo)
    process.stdout.write(withCredits(releaseBody(readFileSync(notesPath, 'utf8')), generated, authors))
    return
  }
  if (!['prepare', 'verify', 'draft'].includes(command)) throw new Error(`Unknown command: ${command}`)
  if (args.slice(2).some((arg) => arg !== '--dry-run')) throw new Error('Unknown option')
  const dryRun = args.includes('--dry-run'),
    version = versionOf(input),
    tag = `v${version}`
  const packagePath = resolve('package.json'),
    pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const notesPath = resolve('releases', `${tag}.md`)
  if (command === 'prepare') {
    if (git('tag', '--list', tag)) throw new Error(`${tag} already exists; use a new version.`)
    if (existsSync(notesPath))
      throw new Error(`${notesPath} already exists; edit it directly rather than overwriting it.`)
    const previous = git('tag', '--merged', 'HEAD', '--sort=-version:refname')
      .split('\n')
      .find((name) => /^v\d+\.\d+\.\d+(?:-|$)/.test(name))
    const log = git('log', '--format=- %s (%h)', ...(previous ? [`${previous}..HEAD`] : ['HEAD']))
    const notes = `# Ramu ${tag}\n\n## Changes\n\n${log || '- Initial release.'}\n\n## Downloads\n\nChoose the installer matching your OS and CPU: macOS arm64 (Apple Silicon), macOS x64 (Intel), or Linux x64 or arm64 (.deb, .rpm, AppImage or ZIP). SHA256SUMS files accompany the downloads.\n\n## Known limitations\n\nDesktop alpha. macOS builds update themselves; Linux installs outside a package manager update by hand. Windows releases are not available yet. Agent providers require their own installation and authentication.\n`
    if (dryRun) {
      console.log(
        `Would set package.json versions (root and workspace packages) to ${version} and write ${notesPath}\n\n${notes}`,
      )
      return
    }
    pkg.version = version
    setWorkspaceVersions(version)
    mkdirSync(resolve('releases'), { recursive: true })
    writeFileSync(notesPath, notes)
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(
      `Prepared ${tag}. Edit ${notesPath}, run pnpm check, then commit and push the release commit and tag. No Git changes were committed or pushed.`,
    )
    return
  }
  if (pkg.version !== version) throw new Error(`Tag ${tag} does not match package.json version ${pkg.version}.`)
  if (!existsSync(notesPath) || !readFileSync(notesPath, 'utf8').trim())
    throw new Error(`Missing release notes: ${notesPath}`)
  if (command === 'verify') {
    console.log(`Verified ${tag} and its release notes.`)
    return
  }
  if (git('status', '--porcelain'))
    throw new Error('Commit or stash working-tree changes before requesting a draft release.')
  const head = git('rev-parse', 'HEAD'),
    tagged = git('rev-parse', `${tag}^{commit}`)
  if (head !== tagged) throw new Error('Check out the release tag before requesting a draft.')
  const remote = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
  const remoteSha =
    remote
      .split('\n')
      .find((line) => line.endsWith('^{}'))
      ?.split(/\s+/)[0] ?? remote.split(/\s+/)[0]
  if (remoteSha !== head) throw new Error(`Push ${tag} to origin first; the remote tag must match HEAD.`)
  const ghArgs = ['workflow', 'run', 'release.yml', '--ref', tag, '-f', `tag=${tag}`]
  if (dryRun) {
    console.log(`Would run: gh ${ghArgs.join(' ')}`)
    return
  }
  execFileSync('gh', ghArgs, { stdio: 'inherit' })
  console.log(
    'Draft release workflow requested. Follow progress with gh run list --workflow release.yml. Nothing is published automatically.',
  )
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    run(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
