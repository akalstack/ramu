import { useLayoutEffect, useRef } from 'react'

/** Scroll the strip, never the page; only reveal selection after selection or layout changes. */
export function useTabScroll(selection: string | undefined | null, horizontal = true, visible = true) {
  const ref = useRef<HTMLDivElement>(null)
  const lastSwitch = useRef(-Infinity)
  useLayoutEffect(() => {
    const strip = ref.current
    if (!strip || !visible) return
    const reveal = () => {
      if (document.querySelector('[data-separator="active"], [data-workspace-split][data-dragging]')) return
      const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      const item = tab?.closest<HTMLElement>('.tab-slot, .terminal-tab') ?? tab
      if (!item) return
      const bounds = strip.getBoundingClientRect()
      const rect = item.getBoundingClientRect()
      if (horizontal) {
        if (rect.left < bounds.left) strip.scrollLeft += rect.left - bounds.left
        else if (rect.right > bounds.right) strip.scrollLeft += Math.min(rect.right - bounds.right, rect.left - bounds.left)
      } else {
        if (rect.top < bounds.top) strip.scrollTop += rect.top - bounds.top
        else if (rect.bottom > bounds.bottom) strip.scrollTop += Math.min(rect.bottom - bounds.bottom, rect.top - bounds.top)
      }
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(strip)
    if (strip.firstElementChild) observer.observe(strip.firstElementChild)
    const wheel = (event: WheelEvent) => {
      if (!horizontal || event.ctrlKey || event.metaKey) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (event.shiftKey) {
        event.preventDefault()
        if (Math.abs(delta) < 1.5 || event.timeStamp - lastSwitch.current < 150) return
        const tabs = Array.from(strip.querySelectorAll<HTMLElement>('[role="tab"]'))
        const index = tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true')
        const next = tabs[index + (delta > 0 ? 1 : -1)]
        if (index >= 0 && next) { lastSwitch.current = event.timeStamp; next.click() }
        return
      }
      if (strip.scrollWidth <= strip.clientWidth) return
      const pixels = delta * (event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? strip.clientWidth : 1)
      event.preventDefault()
      strip.scrollLeft += pixels
    }
    const release = new MutationObserver(reveal)
    release.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-separator', 'data-dragging'] })
    strip.addEventListener('wheel', wheel, { passive: false })
    return () => { observer.disconnect(); release.disconnect(); strip.removeEventListener('wheel', wheel) }
  }, [selection, horizontal, visible])
  return ref
}
