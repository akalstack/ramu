import { AUTO_PROJECT, NO_PROJECT } from '@ramu/shared/types'

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

const DRAFT_KEY = 'ramu.draft.destination'

/** The destination picked for the unsent Home draft: a project, No project or Auto. Kept per host with the draft. */
export function draftDestination(storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  try {
    return storage.getItem(DRAFT_KEY)
  } catch {
    return null
  }
}

export function rememberDraftDestination(choice: string, storage: Pick<Storage, 'setItem'> = localStorage) {
  try {
    storage.setItem(DRAFT_KEY, choice)
  } catch {
    // The choice only fails to survive a restart.
  }
}

/** Once the draft is sent, Home goes back to its default destination. */
export function clearDraftDestination(storage: Pick<Storage, 'removeItem'> = localStorage) {
  try {
    storage.removeItem(DRAFT_KEY)
  } catch {
    // Nothing to clear when the store is blocked.
  }
}

/**
 * What Home selects for a draft with no choice made this session: the destination picked before a restart while it is
 * still valid (Auto only while Auto is on), otherwise Auto when it is on, otherwise the last project used.
 */
export function homeDestination(input: {
  saved: string | null
  autoOn: boolean
  projects: { id: string }[]
  lastProject: string | null
}): string {
  const { saved, autoOn, projects, lastProject } = input
  if (saved === AUTO_PROJECT && autoOn && projects.length > 0) return AUTO_PROJECT
  if (saved === NO_PROJECT) return NO_PROJECT
  if (saved && saved !== AUTO_PROJECT && projects.some((project) => project.id === saved)) return saved
  return autoOn && projects.length > 0 ? AUTO_PROJECT : defaultStartProject(lastProject, projects)
}

/** What the start box on Home selects: the remembered project while it still exists, otherwise No project. */
export function defaultStartProject(remembered: string | null, projects: { id: string }[]): string {
  return remembered && remembered !== NO_PROJECT && projects.some((project) => project.id === remembered)
    ? remembered
    : NO_PROJECT
}
