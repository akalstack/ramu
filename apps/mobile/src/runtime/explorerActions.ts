// File management from the mobile Explorer. Pure rules; the host validates and performs every change.

export type ExplorerAction = 'copy-path' | 'rename' | 'delete'

/**
 * What a row offers. Copying a path is always possible. Changing files needs a host that can be reached and a device
 * that is not view-only; the host enforces both again, so hiding the actions only avoids offering what would fail.
 */
export function explorerActions(options: { online: boolean; viewOnly: boolean }): ExplorerAction[] {
  return options.online && !options.viewOnly ? ['copy-path', 'rename', 'delete'] : ['copy-path']
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
