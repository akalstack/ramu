import { useEffect, useRef } from 'react'
import { AppState } from 'react-native'
import { PageWidget } from '../activities/PageWidget'
import { EMPTY_PAGE_WIDGET } from '../activities/pageWidgetProps'
import { useStore } from '../runtime/store'

/** The draft key naming the page the home-screen widget shows, as `{ computerId, pageId }`. */
export const WIDGET_PAGE_KEY = 'widget-page'

export function widgetPage(text: string | undefined): { computerId: string; pageId: string } | null {
  try {
    const value = JSON.parse(text || 'null') as { computerId?: unknown; pageId?: unknown } | null
    return value && typeof value.computerId === 'string' && typeof value.pageId === 'string'
      ? { computerId: value.computerId, pageId: value.pageId }
      : null
  } catch {
    return null
  }
}

/**
 * Keeps the home-screen widget current: it reads the chosen page's declared widget from its host when the app opens,
 * when the page changes, and every quarter hour while Ramu is open. Between reads the widget says when it was read.
 */
export function PageWidgetSync() {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const chosen = widgetPage(store.drafts[WIDGET_PAGE_KEY])
  const key = chosen ? `${chosen.computerId}:${chosen.pageId}` : ''
  const online = chosen ? store.isOnline(chosen.computerId) : false
  useEffect(() => {
    if (!PageWidget) return
    const target = widgetPage(latest.current.drafts[WIDGET_PAGE_KEY])
    if (!target) {
      PageWidget.updateSnapshot(EMPTY_PAGE_WIDGET)
      return
    }
    const refresh = async () => {
      if (!latest.current.isOnline(target.computerId)) return
      try {
        const [page, data] = await Promise.all([
          latest.current.invoke(target.computerId, 'pages.get', target.pageId),
          latest.current.invoke(target.computerId, 'pages.widget', target.pageId),
        ])
        PageWidget?.updateSnapshot({
          page: `${page.icon} ${page.title}`,
          title: data?.title ?? page.title,
          value: data?.value ?? '—',
          items: data?.items ?? [],
          updatedAt: Date.now(),
        })
      } catch {
        // The widget keeps its last reading and its time.
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 15 * 60_000)
    const app = AppState.addEventListener('change', (state) => state === 'active' && void refresh())
    const off = latest.current.subscribe(target.computerId, (...[channel, payload]) => {
      if (channel === 'pages:changed' && (payload as { pageId: string; run?: unknown }).pageId === target.pageId)
        void refresh()
    })
    return () => {
      clearInterval(timer)
      app.remove()
      off()
    }
  }, [key, online])
  return null
}
