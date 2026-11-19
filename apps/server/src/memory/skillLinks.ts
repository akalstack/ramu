import { execFileSync } from 'node:child_process'
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const PREFIX = 'ramu-'

export interface SkillLinkTarget {
  /** Folder the provider scans for skills in this chat's working directory, such as `<cwd>/.cursor/skills`. */
  dir: string
  /** Working directory the folder belongs to; its git repository, if any, excludes the links. */
  cwd: string
}
export interface SkillLinkResult {
  created: string[]
  removed: string[]
  skipped: string[]
}

const inside = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path))
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
const lstat = (path: string) => {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}
/** Where a symlink points, resolved against its folder; null when the entry is not a link. */
const linkTarget = (path: string) => {
  try {
    return resolve(dirname(path), readlinkSync(path))
  } catch {
    return null
  }
}
const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)

/**
 * Makes `dir` hold exactly one link per skill folder in `source` (`ramu-<name>`), for providers that only scan a fixed skills
 * folder. Only names starting with `ramu-` whose target lies inside `root` (Ramu's export root) are ever created or removed.
 * A real file or folder, or a link pointing anywhere else, is skipped and reported. Links are removed with `unlink`, which
 * never follows them, and nothing is written through a `dir` that is itself a link.
 */
export function reconcileSkillLinks(
  { dir, cwd }: SkillLinkTarget,
  source: string,
  root: string,
  warn: (message: string) => void = console.warn,
): SkillLinkResult {
  const result: SkillLinkResult = { created: [], removed: [], skipped: [] }
  const skip = (path: string, why: string) => {
    result.skipped.push(path)
    warn(`Skill link skipped (${why}): ${path}`)
  }
  let wanted: string[] = []
  try {
    wanted = readdirSync(source).filter((name) => name.startsWith(PREFIX) && inside(root, join(source, name)))
  } catch {
    /* The export is gone, so nothing is wanted. */
  }
  const folder = lstat(dir)
  if (folder && !folder.isDirectory()) {
    if (wanted.length) skip(dir, folder.isSymbolicLink() ? 'folder is a link' : 'not a folder')
    return result
  }
  if (!folder) {
    if (!wanted.length) return result
    mkdirSync(dir, { recursive: true })
  }
  const want = new Set(wanted)
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(PREFIX)) continue
    const path = join(dir, name),
      target = lstat(path)?.isSymbolicLink() ? linkTarget(path) : null
    if (!target) {
      if (want.has(name)) skip(path, 'not a Ramu link')
      want.delete(name)
      continue
    }
    if (!inside(root, target)) {
      skip(path, 'link points outside Ramu')
      want.delete(name)
    } else if (!want.has(name) || !same(target, resolve(source, name))) {
      unlinkSync(path)
      result.removed.push(path)
    } else want.delete(name)
  }
  for (const name of want) {
    const path = join(dir, name)
    if (lstat(path)) {
      skip(path, 'name in use')
      continue
    }
    try {
      // A junction needs no privilege on Windows and behaves like a folder link.
      symlinkSync(resolve(source, name), path, process.platform === 'win32' ? 'junction' : 'dir')
      result.created.push(path)
    } catch (error) {
      skip(path, (error as Error).message)
    }
  }
  if (result.created.length) excludeFromGit(cwd, dir)
  return result
}

/** Lists the Ramu links in `.git/info/exclude` (never `.gitignore`), so a project does not show them as untracked. */
function excludeFromGit(cwd: string, dir: string) {
  try {
    const [prefix = '', path = ''] = execFileSync('git', ['rev-parse', '--show-prefix', '--git-path', 'info/exclude'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
      windowsHide: true,
    }).split('\n')
    if (!path) return
    const file = resolve(cwd, path),
      entry = `/${prefix}${relative(cwd, dir).split(sep).join('/')}/${PREFIX}*`
    mkdirSync(dirname(file), { recursive: true })
    let text = ''
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      /* No exclude file yet. */
    }
    if (text.split(/\r?\n/).includes(entry)) return
    appendFileSync(file, `${text && !text.endsWith('\n') ? '\n' : ''}# Ramu managed skills\n${entry}\n`)
  } catch {
    /* Not a git repository, or git is unavailable. */
  }
}
