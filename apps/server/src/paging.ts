import { z } from 'zod'
import { PAGE_LIMIT_MAX, type Page } from '@ramu/shared/paging'

/** A page's cursor as a request carries it: opaque to clients, bounded here. */
export const cursorArg = z.string().max(400).nullable()
export const limitArg = z.number().int().min(1).max(PAGE_LIMIT_MAX)

/**
 * The values a cursor names (the last row's sort keys), or null for the first page. A cursor this host did not write is
 * refused rather than read as the first page, which would show the newest rows again as if they were older.
 */
export function readCursor(cursor: string | null, parts: number): string[] | null {
  if (!cursor) return null
  let values: unknown
  try {
    values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch {
    values = null
  }
  if (!Array.isArray(values) || values.length !== parts || !values.every((value) => typeof value === 'string'))
    throw new Error('This list changed; load it again.')
  return values as string[]
}

/**
 * A page from rows read one past the limit: the extra row only says there is more, and the cursor names the last row
 * shown by its sort keys, so rows added since do not shift what comes next.
 */
export function pageOf<Row, Item>(
  rows: Row[],
  limit: number,
  keys: (row: Row) => (string | number)[],
  item: (row: Row) => Item,
): Page<Item> {
  const shown = rows.slice(0, limit)
  const last = shown.at(-1)
  return {
    items: shown.map(item),
    next:
      rows.length > limit && last
        ? Buffer.from(JSON.stringify(keys(last).map(String)), 'utf8').toString('base64url')
        : null,
  }
}
