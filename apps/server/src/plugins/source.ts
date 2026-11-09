// Where a plugin's files come from: a Git repository pinned to one commit, or a folder on this host. A clone is shallow
// and never runs hooks or submodules. When an index names the author's signing key, the pinned commit must be signed
// by that key alone, checked with `git verify-commit` against a keyring or allowed-signers file holding only it.
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { git } from '../workspace/git'

const SHA = /^[0-9a-f]{40}$/

/** Git URLs a plugin may come from: https, ssh or a local path. `ext::` and other transports that run commands are refused. */
export function safeGitUrl(url: string): boolean {
  if (url.length > 1000 || /[\s\0]/.test(url)) return false
  if (/^https:\/\/[^/]+\//.test(url)) return true
  if (/^ssh:\/\/[^/]+\//.test(url) || /^git@[\w.-]+:[\w./-]+$/.test(url)) return true
  if (url.startsWith('/') && !url.includes('..')) return true
  return false
}

/** Runs Git with no configured hooks, credential prompts or file protocol tricks. */
const SAFE: string[] = [
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'protocol.ext.allow=never',
  '-c',
  'protocol.file.allow=user',
  '-c',
  'submodule.recurse=false',
  '-c',
  'advice.detachedHead=false',
]

export interface FetchedSource {
  dir: string
  commit: string
  cleanup(): Promise<void>
}

/** Clones `url` at `ref` (a branch, tag or commit; the default branch when absent) into a new folder under `parent`. */
export async function fetchGitSource(
  parent: string,
  url: string,
  ref?: string,
  run: typeof git = git,
): Promise<FetchedSource> {
  if (!safeGitUrl(url)) throw new Error('Plugins install from an https or ssh Git address, or a folder.')
  if (ref !== undefined && !/^[\w./-]{1,200}$/.test(ref)) throw new Error('That ref is not a branch, tag or commit.')
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const dir = await mkdtemp(join(parent, 'source-'))
  const cleanup = () => rm(dir, { recursive: true, force: true })
  try {
    await run(dir, [...SAFE, 'init', '--quiet'])
    await run(dir, [...SAFE, 'remote', 'add', 'origin', url])
    const target = ref ?? 'HEAD'
    try {
      await run(dir, [...SAFE, 'fetch', '--quiet', '--depth', '1', '--no-tags', 'origin', target])
    } catch (error) {
      // Servers that refuse fetching an unadvertised commit by id need the full history to find it.
      if (!ref || !SHA.test(ref)) throw error
      await run(dir, [...SAFE, 'fetch', '--quiet', '--no-tags', 'origin'])
    }
    await run(dir, [...SAFE, 'checkout', '--quiet', '--detach', ref && SHA.test(ref) ? ref : 'FETCH_HEAD'])
    const commit = (await run(dir, ['rev-parse', 'HEAD'])).trim()
    if (!SHA.test(commit)) throw new Error('Could not read the commit.')
    if (ref && SHA.test(ref) && commit !== ref) throw new Error('The repository did not have the pinned commit.')
    await rm(join(dir, '.git', 'hooks'), { recursive: true, force: true })
    return { dir, commit, cleanup }
  } catch (error) {
    await cleanup()
    throw new Error(`Could not get the plugin from ${url}: ${(error as Error).message.slice(0, 400)}`, {
      cause: error,
    })
  }
}

/** The newest commit on `ref` (the default branch when absent), without cloning. */
export async function latestCommit(url: string, ref?: string, run: typeof git = git): Promise<string> {
  if (!safeGitUrl(url)) throw new Error('That is not a Git address Ramu installs from.')
  const out = await run(process.cwd(), [...SAFE, 'ls-remote', url, ref ?? 'HEAD'])
  const commit = out.split(/\s/)[0] ?? ''
  if (!SHA.test(commit)) throw new Error(`${url} has no ${ref ?? 'default branch'}.`)
  return commit
}

export type SigningKey = { kind: 'ssh'; key: string } | { kind: 'gpg'; key: string }

export function signingKey(text: string): SigningKey {
  const trimmed = text.trim()
  if (/^(ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+|sk-ssh-ed25519@openssh\.com) [A-Za-z0-9+/=]+( .*)?$/.test(trimmed))
    return { kind: 'ssh', key: trimmed.split('\n')[0]! }
  if (trimmed.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) return { kind: 'gpg', key: trimmed }
  throw new Error('A signing key is an SSH public key line or an armored GPG public key.')
}

/** The SSH key's comment, or the GPG key's user id, for **Signed by**. */
export function signerName(key: SigningKey, fallback: string): string {
  if (key.kind === 'ssh') return key.key.split(' ').slice(2).join(' ').trim() || fallback
  return fallback
}

/** Whether `commit` in `repo` is signed by `key` and no other. */
export async function verifyCommit(
  repo: string,
  commit: string,
  key: SigningKey,
  run: typeof git = git,
): Promise<boolean> {
  const home = await mkdtemp(join(repo, '.git', 'verify-'))
  try {
    if (key.kind === 'ssh') {
      const signers = join(home, 'allowed_signers')
      await writeFile(signers, `* namespaces="git" ${key.key}\n`, { mode: 0o600 })
      await run(repo, ['-c', `gpg.ssh.allowedSignersFile=${signers}`, 'verify-commit', commit])
      return true
    }
    const env = { GNUPGHOME: home }
    await run(repo, ['-c', 'gpg.program=gpg', 'status'], { env })
    const { execFile } = await import('node:child_process')
    await new Promise<void>((resolve, reject) => {
      const child = execFile('gpg', ['--batch', '--import'], { env: { ...process.env, ...env } }, (error) =>
        error ? reject(error) : resolve(),
      )
      child.stdin?.end(key.key)
    })
    await run(repo, ['verify-commit', commit], { env })
    return true
  } catch {
    return false
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}
