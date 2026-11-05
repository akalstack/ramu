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

/** `Receiving objects 60%`, or just the phase while Git has not reported a percentage. */
export function cloneProgressText(progress: CloneStep | null, say: (text: string) => string): string {
  return progress
    ? `${say(progress.phase)}${progress.percent === null ? '' : ` ${progress.percent}%`}`
    : say('Cloning…')
}
