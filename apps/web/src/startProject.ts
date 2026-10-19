import { NO_PROJECT } from '@ramu/shared/types'

const KEY = 'ramu.last-project'

/** The project a thread was last started in (or the general No project choice), if one was. */
export function lastStartProject(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    return storage.getItem(KEY)
  } catch {
    return null
  }
}

export function rememberStartProject(projectId: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(KEY, projectId)
  } catch {
    // Remembering is a convenience; a full or blocked store only means Home opens on No project.
  }
}

/** What the start box on Home selects: the remembered project while it still exists, otherwise No project. */
export function defaultStartProject(remembered: string | null, projects: { id: string }[]): string {
  return remembered && remembered !== NO_PROJECT && projects.some((project) => project.id === remembered)
    ? remembered
    : NO_PROJECT
}
