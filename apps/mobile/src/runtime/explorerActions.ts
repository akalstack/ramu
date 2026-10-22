// File management from the mobile Explorer. Pure rules; the host validates and performs every change.

export type ExplorerAction = 'copy-path' | 'copy-contents' | 'share' | 'duplicate' | 'move' | 'rename' | 'delete'

/**
 * What a row offers. Copying a path (the path on the host, not a download) is always possible. Reading a file's text to
 * copy or share it, and changing files, need a host that can be reached; changes also need a device that is not
 * view-only. The host enforces both again, so hiding the actions only avoids offering what would fail.
 */
export function explorerActions(options: {
  online: boolean
  viewOnly: boolean
  kind?: 'file' | 'dir'
}): ExplorerAction[] {
  const actions: ExplorerAction[] = ['copy-path']
  if (options.online && options.kind === 'file') actions.push('copy-contents', 'share')
  if (options.online && !options.viewOnly) actions.push('duplicate', 'move', 'rename', 'delete')
  return actions
}

/** The first free `name copy.ext`, `name copy 2.ext`, ... in a folder whose names are already known. */
export function duplicateName(path: string, taken: readonly string[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  const used = new Set(taken)
  let candidate = `${stem} copy${ext}`
  for (let n = 2; used.has(candidate); n++) candidate = `${stem} copy ${n}${ext}`
  return `${path.slice(0, path.length - name.length)}${candidate}`
}

export type MovePlan = { ok: true; destination: string } | { ok: false; reason: 'same-folder' | 'into-itself' }

/** Moving into another loaded folder keeps the entry's name; a folder cannot move into itself or its own subfolder. */
export function planMove(path: string, folder: string): MovePlan {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (folder === parentFolder(path)) return { ok: false, reason: 'same-folder' }
  if (folder === path || folder.startsWith(`${path}/`)) return { ok: false, reason: 'into-itself' }
  return { ok: true, destination: folder ? `${folder}/${name}` : name }
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
