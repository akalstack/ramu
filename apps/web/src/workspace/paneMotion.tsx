import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { reducedMotion } from './panelMotion'

/**
 * The one way panes open and close, taken from the Codex app: the pane's own size grows or shrinks over 0.3 s with a plain
 * ease while its neighbour reflows with it. No snapshots, no slide. Off while dragging, and with reduced motion.
 *   - A cheap pane laid out in tracks (the workspace pane, the editor dock): `paneTransition` on the toggle.
 *   - A pane that is costly to resize or heavy to draw (terminal, aside, sub-agent panel, tool rail, sidebar): `paneFadeIn`, one
 *     step plus a 150 ms fade; `<SlidePane>` does that for a pane that is mounted only while open.
 */
export const PANE_MOTION = '0.3s ease'
const SETTLE_MS = 340

/** Animates the given properties of these elements for the toggle that happens next; clears itself afterwards. Returns a canceller. */
export function paneTransition(elements: (HTMLElement | null | undefined)[], properties: string[]): () => void {
  const targets = elements.filter((element): element is HTMLElement => !!element)
  if (!targets.length || reducedMotion() || document.hidden) return () => {}
  const value = properties.map((property) => `${property} ${PANE_MOTION}`).join(', ')
  for (const element of targets) element.style.transition = value
  const done = window.setTimeout(() => {
    for (const element of targets) element.style.transition = ''
  }, SETTLE_MS)
  return () => {
    window.clearTimeout(done)
    for (const element of targets) element.style.transition = ''
  }
}

/**
 * For panes whose content is costly to resize (a terminal re-fits its shell on every size change; the aside and sub-agent panel
 * hold whole transcripts): the pane lands in one step and fades in over 150 ms, which runs on the compositor. Returns a canceller.
 */
export function paneFadeIn(element: HTMLElement | null | undefined): () => void {
  if (!element || reducedMotion() || document.hidden) return () => {}
  const fade = element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' })
  return () => fade.cancel()
}

/** A pane that exists only while open (the tool rail): it appears in one step with a fade, and goes away at once. */
export function SlidePane({
  open,
  children,
  className = '',
}: {
  open: boolean
  children: ReactNode
  className?: string
}) {
  const element = useRef<HTMLDivElement>(null)
  const shown = useRef(open)
  useLayoutEffect(() => {
    if (shown.current === open) return
    shown.current = open
    return open ? paneFadeIn(element.current) : undefined
  }, [open])
  if (!open) return null
  return (
    <div ref={element} className={`flex-none min-h-0 flex ${className}`}>
      {children}
    </div>
  )
}
