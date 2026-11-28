import { useCallback, useEffect, useRef, useState } from 'react'
import { appendPage, type Page } from '@ramu/shared/paging'

/**
 * A list the host keeps a page at a time: the first page as soon as `key` is set, more on `loadMore`, and the first page
 * read again whenever `refresh` changes, with what was already loaded kept below it. A host too old to page answers
 * with `fallback`, the whole list it can give.
 */
export function useCursorPages<T>({
  key,
  refresh,
  load,
  id,
  fallback,
}: {
  /** What the list is (a host and a schedule, a search); a new key starts over. Null loads nothing. */
  key: string | null
  /** Changes when the host says the list changed. */
  refresh?: unknown
  load: (cursor: string | null) => Promise<Page<T>>
  id: (item: T) => string
  fallback?: () => Promise<T[]> | T[]
}) {
  const [items, setItems] = useState<T[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const latest = useRef({ load, id, fallback, key })
  latest.current = { load, id, fallback, key }
  const busy = useRef(false)
  const first = useCallback(async (keep: boolean) => {
    const asked = latest.current.key
    if (asked === null) return
    setLoading(true)
    try {
      const page = await latest.current.load(null)
      if (latest.current.key !== asked) return
      setItems((shown) => (keep ? appendPage(page.items, shown, latest.current.id) : page.items))
      if (!keep) setNext(page.next)
    } catch (error) {
      const fallback = latest.current.fallback
      if (!fallback) throw error
      const all = await fallback()
      if (latest.current.key !== asked) return
      setItems(all)
      setNext(null)
    } finally {
      if (latest.current.key === asked) {
        setLoading(false)
        setLoaded(true)
      }
    }
  }, [])
  useEffect(() => {
    setItems([])
    setNext(null)
    setLoaded(false)
    void first(false).catch(() => setLoading(false))
  }, [key, first])
  const refreshed = useRef(refresh)
  useEffect(() => {
    if (refreshed.current === refresh) return
    refreshed.current = refresh
    void first(true).catch(() => {})
  }, [refresh, first])
  const loadMore = useCallback(async () => {
    const asked = latest.current.key
    if (!next || busy.current || asked === null) return
    busy.current = true
    setLoading(true)
    try {
      const page = await latest.current.load(next)
      if (latest.current.key !== asked) return
      setItems((shown) => appendPage(shown, page.items, latest.current.id))
      setNext(page.next)
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [next])
  return { items, more: next !== null, loading, loaded, loadMore }
}
