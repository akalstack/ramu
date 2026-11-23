import type { ReactNode } from 'react'
import { matchesWords, startsWithQuery } from '@ramu/shared/search/matchWords'

export interface ComboboxOption {
  value: string
  label: string
  /** A muted second line under the label. */
  detail?: string
  /** The heading the option sits under; options without one come first, under no heading. */
  group?: string
  icon?: ReactNode
  /** More text that finds the option but is not shown, such as an id. */
  keywords?: string
  /** The tooltip, such as the full id a short label stands for. */
  title?: string
  disabled?: boolean
}

export interface ComboboxGroup {
  name: string | null
  options: ComboboxOption[]
}

/** How many rows a list draws at once; typing narrows a longer one. */
export const COMBOBOX_LIMIT = 200

/**
 * The options that match `query`, in their groups and in the order given, with labels that start with the query first
 * in each group. At most `limit` are drawn, always including `keep` (the chosen one), and `hidden` says how many more
 * a narrower query would show.
 */
export function filterComboboxOptions(
  options: readonly ComboboxOption[],
  query: string,
  { limit = COMBOBOX_LIMIT, keep }: { limit?: number; keep?: string } = {},
): { groups: ComboboxGroup[]; hidden: number } {
  const matches = options.filter((option) =>
    matchesWords(`${option.label} ${option.detail ?? ''} ${option.group ?? ''} ${option.keywords ?? ''}`, query),
  )
  const shown = matches.slice(0, limit)
  const kept = matches.find((option) => option.value === keep)
  if (kept && !shown.includes(kept)) shown.push(kept)
  const groups = new Map<string | null, ComboboxOption[]>([[null, []]])
  for (const option of shown) {
    const name = option.group ?? null
    groups.set(name, [...(groups.get(name) ?? []), option])
  }
  return {
    groups: [...groups]
      .filter(([, entries]) => entries.length)
      .map(([name, entries]) => ({
        name,
        options: query.trim()
          ? [...entries].sort(
              (a, b) => Number(startsWithQuery(b.label, query)) - Number(startsWithQuery(a.label, query)),
            )
          : entries,
      })),
    hidden: matches.length - shown.length,
  }
}
