import { PROJECT_NAME } from '../stacks'

/** A folder on a host, as the folder picker lists it. `repo` marks a Git repository (it holds `.git`). */
export interface HostFolder {
  name: string
  path: string
  repo?: boolean
}

/** One folder's contents in the host folder picker. `parent` is null at a browse root. */
export interface HostFolderListing {
  path: string
  parent: string | null
  /** The listed folder is itself a Git repository. Older hosts omit it. */
  repo?: boolean
  folders: HostFolder[]
}

export interface FolderCrumb {
  name: string
  path: string
}

/** How far a running clone has got, as Git reports it. `percent` is null until Git says. */
export interface CloneStep {
  phase: string
  percent: number | null
}

const SEPARATORS = /[\\/]+/

/** The last part of a host path, whichever separator the host uses; a filesystem root names itself. */
export function folderName(path: string): string {
  return path.split(SEPARATORS).filter(Boolean).at(-1) ?? path
}

/**
 * The steps from the browse root that holds `path` down to `path`, each one a folder the picker can jump back to. The
 * innermost root wins, so a project folder inside the home folder starts at the project, as the picker's roots do.
 */
export function folderCrumbs(path: string, roots: readonly string[]): FolderCrumb[] {
  const separator = path.includes('\\') && !path.includes('/') ? '\\' : '/'
  const trim = (value: string) => (value.length > 1 ? value.replace(/[\\/]+$/, '') : value)
  const target = trim(path)
  const root = roots
    .map(trim)
    .filter(
      (candidate) =>
        target === candidate || target.startsWith(candidate.endsWith(separator) ? candidate : candidate + separator),
    )
    .sort((a, b) => b.length - a.length)[0]
  if (!root) return [{ name: folderName(target), path: target }]
  const crumbs: FolderCrumb[] = [{ name: folderName(root), path: root }]
  let current = root
  for (const part of target.slice(root.length).split(SEPARATORS).filter(Boolean)) {
    current = current.endsWith(separator) ? current + part : current + separator + part
    crumbs.push({ name: part, path: current })
  }
  return crumbs
}

/**
 * Where a clone most likely belongs: the folder most of the host's projects sit side by side in, when it can be
 * browsed (it lies inside one of `roots`, which hold the home folder and every project). Undefined when none does.
 */
export function cloneStartFolder(roots: readonly string[]): string | undefined {
  const separator = (path: string) => (path.includes('\\') && !path.includes('/') ? '\\' : '/')
  const inside = (path: string, root: string) =>
    path !== root && path.startsWith(root.endsWith(separator(root)) ? root : root + separator(root))
  const counts = new Map<string, number>()
  for (const root of roots) {
    const cut = root.replace(/[\\/]+$/, '').search(/[\\/][^\\/]*$/)
    if (cut <= 0) continue
    const parent = root.slice(0, cut)
    if (roots.some((other) => other === parent || inside(parent, other)))
      counts.set(parent, (counts.get(parent) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0]?.[0]
}

/** The folder a clone lands in: the repository's own name, from `owner/name`, an HTTPS URL or an SSH address. */
export function cloneFolderName(value: string): string {
  return (
    value
      .trim()
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .pop() ?? ''
  )
}

/** A folder name made from a title: lowercase letters and digits joined by dashes, `fallback` when nothing is left. */
export function titleFolderName(title: string, fallback = 'artifact'): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/, '') || fallback
  )
}

/** A folder inside a project given as `a/b`: every part a plain name, never `..`, absolute or hidden. */
export function isProjectFolder(path: string): boolean {
  return path.length <= 400 && path.split('/').every((part) => PROJECT_NAME.test(part))
}

/** `Receiving objects 60%`, or just the phase while Git has not reported a percentage. */
export function cloneProgressText(progress: CloneStep | null, say: (text: string) => string): string {
  return progress
    ? `${say(progress.phase)}${progress.percent === null ? '' : ` ${progress.percent}%`}`
    : say('Cloning…')
}
