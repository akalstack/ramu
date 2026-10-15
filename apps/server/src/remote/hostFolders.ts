import { mkdir, readdir, realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

const within = (root: string, path: string) => {
  const rel = relative(root, path)
  return !rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}
export class HostFolders {
  constructor(private projectRoots: () => string[]) {}
  async roots(): Promise<string[]> {
    const configured = process.env.RAMU_BROWSE_ROOTS?.split(delimiter).filter(Boolean)
    const roots = configured ?? [homedir(), ...this.projectRoots()]
    return [...new Set(await Promise.all(roots.map((root) => realpath(root))))]
  }
  private async check(path: string) {
    if (!isAbsolute(path) || path.includes('\0')) throw new Error('Choose an absolute host folder path')
    const actual = await realpath(path)
    if (!(await this.roots()).some((root) => within(root, actual)))
      throw new Error('This folder is outside the host browse roots')
    if (!(await stat(actual)).isDirectory()) throw new Error('Not a host folder')
    return actual
  }
  async list(path: string) {
    const actual = await this.check(path)
    const roots = await this.roots()
    const entries = await readdir(actual, { withFileTypes: true })
    const folders: { name: string; path: string }[] = []
    for (const entry of entries.slice(0, 2000)) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
      const candidate = join(actual, entry.name)
      try {
        await this.check(candidate)
        folders.push({ name: entry.name, path: candidate })
      } catch {
        /* inaccessible folders and symlink escapes are not offered */
      }
    }
    return {
      path: actual,
      parent: roots.some((root) => within(root, dirname(actual))) ? dirname(actual) : null,
      folders: folders.sort((a, b) => a.name.localeCompare(b.name)),
    }
  }
  async create(parent: string, name: string) {
    if (!name.trim() || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 200)
      throw new Error('Use a single folder name')
    const root = await this.check(parent)
    const path = join(root, name.trim())
    await mkdir(path)
    return this.check(path)
  }
  async inspect(path: string) {
    return this.check(path)
  }
  async clone(parent: string, name: string, url: string) {
    if (!/^(https?:\/\/|ssh:\/\/|git@)/.test(url) || /[\r\n\0]/.test(url))
      throw new Error('Use an HTTPS or SSH Git repository URL')
    // Do not accept embedded HTTPS passwords, which would persist in the Git remote.
    if (/^https?:/.test(url)) {
      const parsed = new URL(url)
      if (parsed.password || parsed.username)
        throw new Error('Use credentials configured on the host instead of embedding them in a URL')
    }
    const path = await this.create(parent, name)
    await new Promise<void>((accept, reject) =>
      execFile(
        'git',
        ['clone', '--', url, path],
        { timeout: 120_000, maxBuffer: 1_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (error) =>
          error
            ? reject(
                new Error(
                  'Clone failed. Check the URL and Git credentials on the host. The destination folder was kept for inspection.',
                ),
              )
            : accept(),
      ),
    )
    return path
  }
}
