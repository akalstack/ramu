import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** Fixed-height rows with bounded DOM and keyboard navigation through the entire list. */
export function VirtualList<T>({
  items,
  rowHeight,
  itemKey,
  renderItem,
  className,
  resetKey,
  revealKey,
  isFocusable,
  overlay,
}: {
  items: T[]
  rowHeight: number | ((item: T) => number)
  itemKey: (item: T) => string
  renderItem: (item: T, index: number) => ReactNode
  className?: string
  resetKey?: string
  revealKey?: string
  isFocusable?: (item: T) => boolean
  /** Scroll inside an overlay scrollbar that takes no layout width. */
  overlay?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const [top, setTop] = useState(0),
    [height, setHeight] = useState(400)
  const pendingFocus = useRef<number | null>(null)
  const offsets = useMemo(() => {
    const values = [0]
    for (const item of items)
      values.push(values.at(-1)! + (typeof rowHeight === 'number' ? rowHeight : rowHeight(item)))
    return values
  }, [items, rowHeight])
  const indexAt = (y: number) => {
    let low = 0,
      high = items.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (offsets[mid + 1]! <= y) low = mid + 1
      else high = mid
    }
    return Math.min(items.length - 1, low)
  }
  const virtual = items.length > 100
  const start = virtual ? Math.max(0, indexAt(top) - 5) : 0
  const end = virtual ? Math.min(items.length, indexAt(top + height) + 6) : items.length
  const scrollTo = (index: number) => {
    const el = root.current
    if (!el || index < 0 || index >= items.length) return
    const y = offsets[index]!,
      bottom = offsets[index + 1]!
    if (y < el.scrollTop) el.scrollTop = y
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
    setTop(el.scrollTop)
  }
  useLayoutEffect(() => {
    const el = root.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight)
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (root.current) root.current.scrollTop = 0
    setTop(0)
  }, [resetKey])
  useLayoutEffect(() => {
    if (revealKey) scrollTo(items.findIndex((item) => itemKey(item) === revealKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [revealKey, items, rowHeight] by design; the values it reads beyond these are current as of that run
  }, [revealKey, items, rowHeight])
  useLayoutEffect(() => {
    if (pendingFocus.current === null) return
    const button = root.current?.querySelector<HTMLElement>(`[data-virtual-index="${pendingFocus.current}"] button`)
    if (button) {
      button.focus({ preventScroll: true })
      pendingFocus.current = null
    }
  })
  const handlers = {
    onScroll: (event: React.UIEvent<HTMLDivElement>) => {
      if (virtual) setTop(event.currentTarget.scrollTop)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
        event.altKey ||
        event.metaKey ||
        event.ctrlKey
      )
        return
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-virtual-index]')
      if (!row) return
      const index = Number(row.dataset.virtualIndex)
      const direction = event.key === 'Home' || event.key === 'ArrowDown' ? 1 : -1
      let next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? items.length - 1
            : Math.max(0, Math.min(items.length - 1, index + direction))
      while (next >= 0 && next < items.length && isFocusable && !isFocusable(items[next]!)) next += direction
      if (next < 0 || next >= items.length) return
      event.preventDefault()
      pendingFocus.current = next
      scrollTo(next)
      const button = root.current?.querySelector<HTMLElement>(`[data-virtual-index="${next}"] button`)
      if (button) {
        button.focus({ preventScroll: true })
        pendingFocus.current = null
      }
    },
  }
  const rows = (
    <>
      {virtual && <div aria-hidden="true" style={{ height: offsets[start], flex: 'none' }} />}
      {items.slice(start, end).map((item, offset) => (
        <div
          key={itemKey(item)}
          data-virtual-index={start + offset}
          style={{ height: offsets[start + offset + 1]! - offsets[start + offset]!, flex: 'none' }}
        >
          {renderItem(item, start + offset)}
        </div>
      ))}
      {virtual && <div aria-hidden="true" style={{ height: offsets.at(-1)! - offsets[end]!, flex: 'none' }} />}
    </>
  )
  return overlay ? (
    <OverlayScrollArea
      className={className}
      viewportClassName="max-h-[inherit]"
      viewportRef={root}
      viewportProps={handlers}
    >
      {rows}
    </OverlayScrollArea>
  ) : (
    <div ref={root} className={className} {...handlers}>
      {rows}
    </div>
  )
}
