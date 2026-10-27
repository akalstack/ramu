import { cn } from 'cn'
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { readSize, useLayoutEpoch } from './panelLayout'
import { hostStorageFor } from '../hostStorage'
import { useHost } from './HostProvider'
import { PANE_MS, paneFadeIn, paneTransition } from './paneMotion'

/** A stable two-track split. Content never participates in track sizing or panel registration. */
export function WorkspaceSplit({
  id,
  orientation = 'horizontal',
  open,
  label,
  defaultShare,
  primaryMin = 320,
  secondaryMin = 240,
  resizePreview = false,
  flip = false,
  primaryCollapsed = false,
  primary,
  secondary,
}: {
  id: string
  orientation?: 'horizontal' | 'vertical'
  open: boolean
  label: string
  defaultShare: number
  primaryMin?: number
  resizePreview?: boolean
  secondaryMin?: number
  /** Puts the secondary pane first (left); only meaningful for horizontal splits. */
  flip?: boolean
  /** Hides the primary pane and gives the secondary pane the full track while open. */
  primaryCollapsed?: boolean
  primary: ReactNode
  secondary: ReactNode
}) {
  const host = useHost().id
  const hostStorage = hostStorageFor(host)
  const storageKey = `workspace-v2.${id}`
  const readShare = () => {
    const saved = readSize(storageKey, defaultShare, host)
    return saved > 0 && saved < 100 ? saved : defaultShare
  }
  const [share, setShare] = useState(readShare)
  const [length, setLength] = useState(0)
  const [dragging, setDragging] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const surface = useRef<HTMLDivElement>(null)
  const settled = useRef(open && !primaryCollapsed)
  const drag = useRef<{ rect: DOMRect; length: number; share: number } | null>(null)
  // Pointer events can arrive several times per frame; the layout is updated once per frame with the latest position.
  const frame = useRef(0)
  const currentShare = useRef(share)
  // Window resizes keep the secondary pane's pixel size; only user drags and resets change it.
  const pixels = useRef<number | null>(null)
  const epoch = useLayoutEpoch()
  useLayoutEffect(() => {
    if (open) return
    drag.current = null
    if (preview.current) preview.current.style.visibility = 'hidden'
    setDragging(false)
  }, [open])
  // Runs in the commit that changes the tracks, before paint: the transition set here applies to that very change.
  useLayoutEffect(() => {
    const element = root.current,
      pane = surface.current
    const visible = open && !primaryCollapsed
    if (!element || !pane || settled.current === visible) return
    settled.current = visible
    // A terminal re-fits its shell and Monaco re-lays out on every size change, so animating their tracks would redo that ~18 times.
    // They land in one step and fade in on the compositor instead; the rest animate their tracks (see paneMotion).
    if (/\.(terminal-(bottom|right)|editor)$/.test(id)) {
      return open ? paneFadeIn(pane) : undefined
    }
    // Only an open/close animates, not window resizes or drag releases.
    const cancel = paneTransition([element], ['grid-template-columns', 'grid-template-rows'])
    // A closing pane stays drawn until its track has shrunk, then hides.
    if (!open) pane.style.transition = `visibility 0s linear ${PANE_MS / 1000}s`
    const done = window.setTimeout(() => {
      pane.style.transition = ''
    }, PANE_MS + 40)
    return () => {
      cancel()
      window.clearTimeout(done)
      pane.style.transition = ''
    }
  }, [open, primaryCollapsed, id])
  useEffect(() => {
    const next = readShare()
    currentShare.current = next
    pixels.current = null
    setShare(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [id, epoch, host])
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
  const minimum = length ? Math.min(35, (secondaryMin / length) * 100) : 35
  const maximum = length ? 100 - Math.min(45, (primaryMin / length) * 100) : 55
  const clamp = (value: number) => Math.max(minimum, Math.min(maximum, value))
  if (length && pixels.current === null) pixels.current = (clamp(share) / 100) * length
  if (length && pixels.current !== null && !drag.current) {
    const kept = clamp((pixels.current / length) * 100)
    if (kept !== share) {
      currentShare.current = kept
      setShare(kept)
    }
  }
  const actual = clamp(share)
  const update = (value: number) => {
    const next = clamp(value)
    currentShare.current = next
    pixels.current = length ? (next / 100) * length : null
    setShare(next)
  }
  const save = () => hostStorage.setItem(`ramu.layout.${storageKey}`, String(currentShare.current))
  const horizontal = orientation === 'horizontal'
  const flipped = flip && horizontal
  const collapsed = open && primaryCollapsed
  const first = collapsed ? 0 : open ? 100 - actual : 100
  const gap = open && !collapsed ? '1px' : '0px'
  const tracks = flipped
    ? `minmax(0, ${100 - first}fr) ${gap} minmax(0, ${first}fr)`
    : `minmax(0, ${first}fr) ${gap} minmax(0, ${100 - first}fr)`
  const place = (column: number): CSSProperties | undefined =>
    flipped ? { gridColumn: column, gridRow: 1 } : undefined
  const movePreview = (value: number, size: number) => {
    if (!preview.current) return
    preview.current.style.visibility = 'visible'
    preview.current.style.transform = horizontal
      ? `translateX(${Math.round(size * (flipped ? value / 100 : 1 - value / 100))}px)`
      : `translateY(${Math.round(size * (1 - value / 100))}px)`
  }
  const endDrag = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    drag.current = null
    if (preview.current) preview.current.style.visibility = 'hidden'
    setDragging(false)
  }

  return (
    <div
      ref={root}
      data-workspace-split={id}
      data-open={open || undefined}
      data-dragging={dragging || undefined}
      className={cn('relative grid h-full w-full min-w-0 min-h-0 overflow-hidden', dragging && 'select-none')}
      style={
        horizontal
          ? { gridTemplateColumns: tracks, gridTemplateRows: 'minmax(0, 1fr)' }
          : { gridTemplateRows: tracks, gridTemplateColumns: 'minmax(0, 1fr)' }
      }
    >
      <div
        className="min-w-0 min-h-0 overflow-hidden"
        inert={collapsed}
        aria-hidden={collapsed || undefined}
        style={{ ...place(3), visibility: collapsed ? 'hidden' : 'visible' }}
      >
        {primary}
      </div>
      <div
        data-sash-active={dragging || undefined}
        role="separator"
        aria-label={label}
        aria-orientation={horizontal ? 'vertical' : 'horizontal'}
        aria-valuemin={Math.round(minimum)}
        aria-valuemax={Math.round(maximum)}
        aria-valuenow={Math.round(actual)}
        aria-hidden={!open || collapsed}
        tabIndex={open && !collapsed ? 0 : -1}
        className={cn(
          'pane-sash relative z-90 bg-[var(--pane-border-color)] outline-none touch-none',
          horizontal
            ? 'cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-3 after:-translate-x-1/2'
            : 'cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-3 after:-translate-y-1/2',
        )}
        style={{ ...place(2), visibility: open && !collapsed ? 'visible' : 'hidden' }}
        onPointerDown={(event) => {
          if (event.button !== 0 || !open || drag.current || !root.current) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          const rect = root.current.getBoundingClientRect()
          const size = Math.max(0, (horizontal ? rect.width : rect.height) - 1)
          drag.current = { rect, length: size, share: actual }
          if (resizePreview) movePreview(actual, size)
          setDragging(true)
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          const state = drag.current
          if (!state || state.length <= 0 || !open) return
          state.share = clamp(
            (((horizontal
              ? flipped
                ? event.clientX - state.rect.left
                : state.rect.right - event.clientX
              : state.rect.bottom - event.clientY) -
              0.5) /
              state.length) *
              100,
          )
          if (frame.current) return
          frame.current = requestAnimationFrame(() => {
            frame.current = 0
            if (!drag.current) return
            if (resizePreview) movePreview(drag.current.share, drag.current.length)
            else update(drag.current.share)
          })
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
          if (drag.current && open) {
            update(drag.current.share)
            save()
          }
          event.currentTarget.releasePointerCapture(event.pointerId)
          endDrag()
        }}
        onPointerCancel={(event) => {
          if (drag.current && !resizePreview) {
            update(drag.current.share)
            save()
          }
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
          endDrag()
        }}
        onLostPointerCapture={() => {
          if (drag.current && !resizePreview) save()
          endDrag()
        }}
        onDoubleClick={() => {
          update(defaultShare)
          save()
        }}
        onKeyDown={(event) => {
          const earlier = horizontal ? 'ArrowLeft' : 'ArrowUp'
          const later = horizontal ? 'ArrowRight' : 'ArrowDown'
          let next: number
          const step = (20 / Math.max(1, length)) * 100 * (flipped ? -1 : 1)
          if (event.key === earlier) next = actual + step
          else if (event.key === later) next = actual - step
          else if (event.key === 'Home') next = maximum
          else if (event.key === 'End') next = minimum
          else return
          event.preventDefault()
          update(next)
          save()
        }}
      />
      <div
        ref={surface}
        data-panel-surface
        className="min-w-0 min-h-0 overflow-hidden"
        inert={!open}
        aria-hidden={!open}
        style={{ ...place(1), visibility: open ? 'visible' : 'hidden' }}
      >
        {secondary}
      </div>
      <div
        ref={preview}
        data-workspace-divider-preview
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute z-100 bg-[var(--pane-border-active)]',
          horizontal ? 'inset-y-0 -left-[1.5px] w-1' : 'inset-x-0 -top-[1.5px] h-1',
        )}
        style={{ visibility: 'hidden' }}
      />
    </div>
  )
}
