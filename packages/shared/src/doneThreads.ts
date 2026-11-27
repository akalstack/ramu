/**
 * Finished threads are listed a page at a time. The thread list carries every open thread, the newest finished ones and
 * any finished thread a device already holds; older ones are read by cursor when the Done list is opened and grown.
 */
type Listed = { id: string; status: string; doneAt?: number | null }

/** Finished threads the thread list carries before any are paged in. */
export const RECENT_DONE = 25
/** Finished threads read per page. */
export const DONE_PAGE = 25

export interface ThreadListOptions {
  /** Newest finished threads to include; the rest are paged with `tasks.olderDone`. */
  recentDone: number
  /** Finished threads this device holds (open tabs, pages it read), kept in the list so they stay current. */
  keep?: string[]
}

/** Where a page of older finished threads starts: finished before `doneAt`, or then, after `id`. */
export interface DoneCursor {
  doneAt: number
  id: string
}

export const isDoneThread = (task: Listed) => task.status !== 'archived' && !!task.doneAt

/** Newest finished first; threads finished at the same moment in id order, so a cursor never skips or repeats one. */
export const doneOrder = (a: Listed, b: Listed) => b.doneAt! - a.doneAt! || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const isAfter = (task: Listed, cursor: DoneCursor) =>
  task.doneAt! < cursor.doneAt || (task.doneAt === cursor.doneAt && task.id > cursor.id)

/** The thread list as asked: everything without options, as older devices ask. */
export function listedThreads<T extends Listed>(tasks: T[], options?: ThreadListOptions): T[] {
  if (!options) return tasks
  const keep = new Set(options.keep)
  const recent = new Set(
    tasks
      .filter(isDoneThread)
      .sort(doneOrder)
      .slice(0, options.recentDone)
      .map((task) => task.id),
  )
  return tasks.filter((task) => !isDoneThread(task) || recent.has(task.id) || keep.has(task.id))
}

/** The finished threads after `cursor`, up to `limit`, and how many are left after them. */
export function olderDoneThreads<T extends Listed>(
  tasks: T[],
  cursor: DoneCursor,
  limit: number,
): { page: T[]; remaining: number } {
  const after = tasks.filter((task) => isDoneThread(task) && isAfter(task, cursor)).sort(doneOrder)
  return { page: after.slice(0, limit), remaining: Math.max(0, after.length - limit) }
}

/** The cursor below every finished thread held: older ones start after it. Null when none is held. */
export function doneCursor(tasks: readonly Listed[]): DoneCursor | null {
  const oldest = tasks.filter(isDoneThread).sort(doneOrder).at(-1)
  return oldest ? { doneAt: oldest.doneAt!, id: oldest.id } : null
}

type ListThreads<T> = (options?: ThreadListOptions) => Promise<T[]>
type OlderDone<T> = (cursor: DoneCursor, limit: number) => Promise<{ tasks: T[]; remaining: number }>

/**
 * The thread list with the newest finished threads and the ones `keep` names. A host from before paging takes no
 * options and refuses them, so it is asked again for every thread, which is what it always sent.
 */
export async function readThreadList<T>(list: ListThreads<T>, keep: Iterable<string>): Promise<T[]> {
  try {
    return await list({ recentDone: RECENT_DONE, keep: [...new Set(keep)].slice(0, 2000) })
  } catch {
    return list()
  }
}

/** A page of older finished threads; a host from before paging sent them all already, so it has none left. */
export async function readOlderDone<T>(
  older: OlderDone<T>,
  cursor: DoneCursor,
  limit: number,
): Promise<{ tasks: T[]; remaining: number }> {
  try {
    return await older(cursor, limit)
  } catch (error) {
    if (error instanceof Error && /Unknown method/.test(error.message)) return { tasks: [], remaining: 0 }
    throw error
  }
}
