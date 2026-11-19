import { useLanguage } from '../../../i18n'
import { useLayoutEffect, useRef } from 'react'

/**
 * Fades the edges of a scroll area that still has content beyond them, instead of cutting it off.
 * It writes data attributes straight to the element, so scrolling never re-renders React; the CSS
 * mask (`.fade-scroll`) animates the fade in and out.
 */
export function useScrollFade<T extends HTMLElement>() {
  useLanguage()
  const ref = useRef<T>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    let frame = 0
    const update = () => {
      frame = 0
      if (el.getAnimations().length) {
        schedule()
        return
      }
      el.toggleAttribute('data-fade-top', el.scrollTop > 2)
      el.toggleAttribute('data-fade-bottom', el.scrollTop + el.clientHeight < el.scrollHeight - 2)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    el.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      el.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  })
  return ref
}
