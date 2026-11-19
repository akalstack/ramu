// File management from the mobile Explorer. Pure rules; the host validates and performs every change.

export type ExplorerAction = 'copy-path' | 'copy-contents' | 'share' | 'duplicate' | 'move' | 'rename' | 'delete'

/**
 * What a row offers. Copying a path is always possible. Changing files needs a host that can be reached and a device
 * that is not view-only; the host enforces both again, so hiding the actions only avoids offering what would fail.
 */
export function explorerActions(options: {
  online: boolean
  viewOnly: boolean
  kind?: 'file' | 'dir'
}): ExplorerAction[] {
  if (!options.online) return ['copy-path']
  // Sharing downloads the file's contents to this device, so it only needs a reachable host, and only applies to files.
  const read: ExplorerAction[] = options.kind === 'dir' ? ['copy-path'] : ['copy-path', 'copy-contents', 'share']
  return options.viewOnly ? read : [...read, 'duplicate', 'move', 'rename', 'delete']
}

export type RenamePlan = { ok: true; destination: string } | { ok: false; reason: 'empty' | 'unchanged' | 'invalid' }

/** The new path for renaming an entry within its folder. A name never moves an entry to another folder. */
export function planRename(path: string, rawName: string): RenamePlan {
  const name = rawName.trim()
  if (!name) return { ok: false, reason: 'empty' }
  if (name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 255)
    return { ok: false, reason: 'invalid' }
  const slash = path.lastIndexOf('/')
  const folder = slash === -1 ? '' : path.slice(0, slash + 1)
  const destination = `${folder}${name}`
  return destination === path ? { ok: false, reason: 'unchanged' } : { ok: true, destination }
}

/** The folder whose listing changes after an operation, so only that folder is reloaded. */
export const parentFolder = (path: string): string => {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

export type MovePlan =
  { ok: true; destination: string } | { ok: false; reason: 'unchanged' | 'invalid' | 'inside-self' }

const trimSlashes = (value: string) => value.trim().replace(/^\/+|\/+$/g, '')

/**
 * The new path for moving an entry into another folder of the same checkout. An empty folder means the checkout root.
 * The host still refuses to overwrite an existing entry, so a name clash comes back as an error rather than data loss.
 */
export function planMove(path: string, rawFolder: string): MovePlan {
  const folder = trimSlashes(rawFolder)
  if (folder.split('/').some((part) => part === '.' || part === '..' || part === '') && folder !== '')
    return { ok: false, reason: 'invalid' }
  if (/[\\\0]/.test(folder)) return { ok: false, reason: 'invalid' }
  if (folder === path || folder.startsWith(`${path}/`)) return { ok: false, reason: 'inside-self' }
  const name = path.slice(path.lastIndexOf('/') + 1)
  const destination = folder ? `${folder}/${name}` : name
  return destination === path ? { ok: false, reason: 'unchanged' } : { ok: true, destination }
}

/** A free sibling name for a copy: `a copy.ts`, then `a copy 2.ts`, and so on. `taken` are the folder's loaded names. */
export function duplicateName(path: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const slash = path.lastIndexOf('/')
  const folder = slash === -1 ? '' : path.slice(0, slash + 1)
  const name = path.slice(slash + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''
  for (let index = 1; ; index += 1) {
    const candidate = `${stem} copy${index === 1 ? '' : ` ${index}`}${extension}`
    if (!used.has(candidate)) return `${folder}${candidate}`
  }
}
