import { execFileSync } from 'node:child_process'
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** Polls until `fn` returns something truthy and returns it. The daemon scheduler ticks every 5 s, so allow ~10 s by default. */
export async function until(fn, message, { attempts = 100, interval = 100 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const result = await fn()
    if (result) return result
    await sleep(interval)
  }
  throw new Error(`Timed out: ${message}`)
}

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

/**
 * Creates a Git repository with `files` ({ 'src/a.ts': 'content' }) committed on `branch`.
 * `remote: true` also creates a bare `<dir>.remote.git` as `origin` with the branch pushed.
 * Returns the real path, so it matches what the app reports on macOS where /tmp is a symlink.
 */
export function createRepo(dir, files = { 'README.md': '# fixture\n' }, { branch = 'main', remote = false } = {}) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', branch)
  git(dir, 'config', 'user.email', 'e2e@example.com')
  git(dir, 'config', 'user.name', 'E2E')
  git(dir, 'config', 'commit.gpgsign', 'false')
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  git(dir, 'add', '.')
  git(dir, 'commit', '-q', '-m', 'initial')
  if (remote) {
    const bare = `${dir}.remote.git`
    execFileSync('git', ['init', '-q', '--bare', bare])
    git(dir, 'remote', 'add', 'origin', bare)
    git(dir, 'push', '-q', '-u', 'origin', branch)
  }
  return realpathSync(dir)
}
