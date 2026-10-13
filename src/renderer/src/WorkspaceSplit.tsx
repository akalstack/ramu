import { cn } from 'cn'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { readSize, useLayoutEpoch } from './panelLayout'

/** A stable two-track split. Content never participates in track sizing or panel registration. */
export function WorkspaceSplit({ id, orientation = 'horizontal', open, label, defaultShare, primaryMin = 320, secondaryMin = 240, primary, secondary }: {
  id: string
  orientation?: 'horizontal' | 'vertical'
  open: boolean
  label: string
  defaultShare: number
  primaryMin?: number
  secondaryMin?: number
  primary: ReactNode
  secondary: ReactNode
}) {
  const storageKey = `workspace-v2.${id}`
  const readShare = () => {
    const saved = readSize(storageKey, defaultShare)
    return saved > 0 && saved < 100 ? saved : defaultShare
  }
  const [share, setShare] = useState(readShare)
  const [length, setLength] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) { setPresent(true); return }
    const timer = window.setTimeout(() => setPresent(false), 260)
    return () => window.clearTimeout(timer)
  }, [open])
  const root = useRef<HTMLDivElement>(null)
  const currentShare = useRef(share)
  const epoch = useLayoutEpoch()
  useEffect(() => {
    const next = readShare()
    currentShare.current = next
    setShare(next)
  }, [id, epoch])
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => {
      const rect = element.getBoundingClientRect()
      setLength(Math.max(0, (orientation === 'horizontal' ? rect.width : rect.height) - 1))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [orientation])

  // Pixel minimums yield to the available space in compact windows; the tracks always sum to 100%.
  const minimum = length ? Math.min(35, secondaryMin / length * 100) : 35
  const maximum = length ? 100 - Math.min(45, primaryMin / length * 100) : 55
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value))
  const actual = clamp(share)
  const update = (value: number) => {
    const next = clamp(value)
    currentShare.current = next
    setShare(next)
  }
  const save = () => localStorage.setItem(`ramu.layout.${storageKey}`, String(currentShare.current))
  const tracks = open ? `minmax(0, ${100 - actual}fr) 1px minmax(0, ${actual}fr)` : 'minmax(0, 100fr) 0px minmax(0, 0fr)'
  const horizontal = orientation === 'horizontal'

  return <div ref={root} data-workspace-split={id} data-dragging={dragging || undefined} className={cn('grid h-full w-full min-w-0 min-h-0 overflow-hidden', dragging && 'select-none')} style={horizontal ? { gridTemplateColumns: tracks, gridTemplateRows: 'minmax(0, 1fr)' } : { gridTemplateRows: tracks, gridTemplateColumns: 'minmax(0, 1fr)' }}>
    <div className="min-w-0 min-h-0 overflow-hidden">{primary}</div>
    <div
      role="separator"
      aria-label={label}
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      aria-valuemin={Math.round(minimum)}
      aria-valuemax={Math.round(maximum)}
      aria-valuenow={Math.round(actual)}
      aria-hidden={!open}
      tabIndex={open ? 0 : -1}
      className={cn('relative z-10 bg-[var(--pane-border-color)] outline-none touch-none hover:bg-[var(--pane-border-active)] focus-visible:bg-[var(--pane-border-active)]', horizontal ? 'cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2' : 'cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2', dragging && 'bg-[var(--pane-border-active)]')}
      style={{ visibility: open ? 'visible' : 'hidden' }}
      onPointerDown={event => {
        if (event.button !== 0 || !open) return
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
        setDragging(true)
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const rect = root.current?.getBoundingClientRect()
        if (!rect || length <= 0) return
        update(((horizontal ? rect.right - event.clientX : rect.bottom - event.clientY) - 0.5) / length * 100)
      }}
      onPointerUp={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        save()
        event.currentTarget.releasePointerCapture(event.pointerId)
        setDragging(false)
      }}
      onLostPointerCapture={() => setDragging(false)}
      onDoubleClick={() => { update(defaultShare); save() }}
      onKeyDown={event => {
        const earlier = horizontal ? 'ArrowLeft' : 'ArrowUp'
        const later = horizontal ? 'ArrowRight' : 'ArrowDown'
        let next: number
        if (event.key === earlier) next = actual + 20 / Math.max(1, length) * 100
        else if (event.key === later) next = actual - 20 / Math.max(1, length) * 100
        else if (event.key === 'Home') next = maximum
        else if (event.key === 'End') next = minimum
        else return
        event.preventDefault()
        update(next)
        save()
      }}
    />
    <div className="min-w-0 min-h-0 overflow-hidden" inert={!open} aria-hidden={!open} style={{ visibility: open || present ? 'visible' : 'hidden' }}>{secondary}</div>
  </div>
}
