import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
export function versionOf(input) {
  const version = (input ?? '').replace(/^v/, '')
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?$/.test(version)) throw new Error('Use a version such as 0.1.0 or 0.1.0-beta.1 (no build metadata).')
  if (version.split('-').slice(1).join('-').split('.').some((part) => /^0\d+$/.test(part))) throw new Error('Numeric prerelease identifiers cannot have leading zeros.')
  return version
}
export function collectAssets(source, destination, platform, arch) {
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Unsupported release target')
  const files = []
  const visit = (dir) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) visit(path); else if (/\.(zip|dmg|deb)$/.test(entry.name)) files.push(path) } }
  visit(source)
  if (!files.length) throw new Error('No installers found; run pnpm make first.')
  mkdirSync(destination, { recursive: true })
  const seen = new Set(), sums = []
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
export function run(args) {
  const [command, input] = args
  if (!command || args.includes('--help')) {
    console.log('Usage: pnpm release:prepare <version> [--dry-run]\n       pnpm release:verify <tag>\n       pnpm release:draft <tag> [--dry-run]\n       pnpm release:assets <platform> <arch>')
    return
  }
  if (command === 'assets') { collectAssets(resolve('dist/make'), resolve('dist/release'), input, args[2]); return }
  if (!['prepare', 'verify', 'draft'].includes(command)) throw new Error(`Unknown command: ${command}`)
  if (args.slice(2).some((arg) => arg !== '--dry-run')) throw new Error('Unknown option')
  const dryRun = args.includes('--dry-run'), version = versionOf(input), tag = `v${version}`
  const packagePath = resolve('package.json'), pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const notesPath = resolve('releases', `${tag}.md`)
  if (command === 'prepare') {
    if (git('tag', '--list', tag)) throw new Error(`${tag} already exists; use a new version.`)
    if (existsSync(notesPath)) throw new Error(`${notesPath} already exists; edit it directly rather than overwriting it.`)
    const previous = git('tag', '--merged', 'HEAD', '--sort=-version:refname').split('\n').find((name) => /^v\d+\.\d+\.\d+(?:-|$)/.test(name))
    const log = git('log', '--format=- %s (%h)', ...(previous ? [`${previous}..HEAD`] : ['HEAD']))
    const notes = `# Ramu ${tag}\n\n## Changes\n\n${log || '- Initial release.'}\n\n## Downloads\n\nChoose the installer matching your OS and CPU: macOS arm64 (Apple Silicon), macOS x64 (Intel), or Linux x64. SHA256SUMS files accompany the downloads.\n\n## Known limitations\n\nDesktop alpha. Automated builds are unsigned and macOS builds are not notarized. Windows releases are not available yet. Agent providers require their own installation and authentication.\n`
    if (dryRun) { console.log(`Would set package.json version to ${version} and write ${notesPath}\n\n${notes}`); return }
    pkg.version = version
    mkdirSync(resolve('releases'), { recursive: true })
    writeFileSync(notesPath, notes)
    writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n')
    console.log(`Prepared ${tag}. Edit ${notesPath}, run pnpm check, then commit and push the release commit and tag. No Git changes were committed or pushed.`)
    return
  }
  if (pkg.version !== version) throw new Error(`Tag ${tag} does not match package.json version ${pkg.version}.`)
  if (!existsSync(notesPath) || !readFileSync(notesPath, 'utf8').trim()) throw new Error(`Missing release notes: ${notesPath}`)
  if (command === 'verify') { console.log(`Verified ${tag} and its release notes.`); return }
  if (git('status', '--porcelain')) throw new Error('Commit or stash working-tree changes before requesting a draft release.')
  const head = git('rev-parse', 'HEAD'), tagged = git('rev-parse', `${tag}^{commit}`)
  if (head !== tagged) throw new Error('Check out the release tag before requesting a draft.')
  const remote = git('ls-remote', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`)
  const remoteSha = remote.split('\n').find((line) => line.endsWith('^{}'))?.split(/\s+/)[0] ?? remote.split(/\s+/)[0]
  if (remoteSha !== head) throw new Error(`Push ${tag} to origin first; the remote tag must match HEAD.`)
  const ghArgs = ['workflow', 'run', 'release.yml', '--ref', tag, '-f', `tag=${tag}`]
  if (dryRun) { console.log(`Would run: gh ${ghArgs.join(' ')}`); return }
  execFileSync('gh', ghArgs, { stdio: 'inherit' })
  console.log('Draft release workflow requested. Follow progress with gh run list --workflow release.yml. Nothing is published automatically.')
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { run(process.argv.slice(2)) } catch (error) { console.error(error.message); process.exitCode = 1 }
}
