import { useState, type ReactNode } from 'react'
import { LIST_SEARCH_MIN, listEmptyState, matchesWords, searchWords } from '@ramu/shared/listView'
import { Button } from '@/components/desktop-button'
import { Dropdown } from '../Menu'
import { SearchInput } from '../SearchInput'
import { t } from '../i18n'
import { usePaged } from './cards'

export interface ListFilter {
  key: string
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
  width?: 'narrow' | 'wide'
}

/**
 * Search, filters and "Show more" for a long Settings list. `text` is what the search reads for an item and `match`
 * applies the caller's filters; any change to the search or `filterKey` returns to the first page.
 */
export function useListView<T>(
  items: readonly T[],
  {
    text,
    match,
    size = 20,
    filterKey,
  }: { text: (item: T) => string; match?: (item: T) => boolean; size?: number; filterKey?: unknown },
) {
  const [query, setQuery] = useState('')
  const words = searchWords(query)
  const matched = items.filter((item) => (!match || match(item)) && matchesWords(text(item), words))
  const paged = usePaged(matched, size, `${query}|${String(filterKey)}`)
  return {
    query,
    setQuery,
    matched,
    total: items.length,
    paged,
    searchable: items.length >= LIST_SEARCH_MIN || query !== '',
    empty: listEmptyState(items.length, matched.length),
  }
}

/** The search field, filters and extra actions above a list, shown once a list is long enough to need them. */
export function ListToolbar({
  view,
  label,
  filters = [],
  actions,
  alwaysShow = false,
}: {
  view: Pick<ReturnType<typeof useListView>, 'query' | 'setQuery' | 'searchable' | 'matched' | 'total'>
  /** Names the search field, such as “Search memories”. */
  label: string
  filters?: ListFilter[]
  actions?: ReactNode
  alwaysShow?: boolean
}) {
  if (!alwaysShow && !view.searchable && !filters.length && !actions) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {view.searchable || alwaysShow ? (
        <SearchInput
          className="flex-1 min-w-[160px]"
          aria-label={label}
          placeholder={label}
          value={view.query}
          onChange={(e) => view.setQuery(e.target.value)}
          onClear={() => view.setQuery('')}
        />
      ) : (
        <span className="flex-1" />
      )}
      {filters.map((filter) => (
        <Dropdown
          key={filter.key}
          className={`${filter.width === 'wide' ? 'w-[150px]!' : 'w-[120px]!'} flex-none`}
          label={filter.label}
          value={filter.value}
          options={filter.options}
          onChange={filter.onChange}
        />
      ))}
      {actions}
    </div>
  )
}

/** The count line under the toolbar: “12 of 80” while filtering, nothing while everything shows. */
export function ListCount({ view }: { view: Pick<ReturnType<typeof useListView>, 'matched' | 'total'> }) {
  if (view.matched.length === view.total || !view.total) return null
  return (
    <p className="m-0 text-caption text-muted-foreground" role="status">
      {t('{0} of {1}', { 0: view.matched.length, 1: view.total })}
    </p>
  )
}

/** Why a list is empty, with a way back when filters caused it. */
export function ListEmpty({
  view,
  none,
  filtered,
  onReset,
}: {
  view: Pick<ReturnType<typeof useListView>, 'empty' | 'query' | 'setQuery'>
  none: string
  filtered: string
  onReset?: () => void
}) {
  if (view.empty === 'ok') return null
  return (
    <p className="muted text-muted-foreground small text-caption py-6 text-center m-0" role="status">
      {view.empty === 'filtered' ? t(filtered) : t(none)}{' '}
      {view.empty === 'filtered' && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground small text-caption underline"
          onClick={() => {
            view.setQuery('')
            onReset?.()
          }}
        >
          {t('Clear filters')}
        </Button>
      )}
    </p>
  )
}
