import { startTransition, useEffect, useState, type RefObject } from 'react'

const listeners = new Map<Element, (near: boolean) => void>()
let observer: IntersectionObserver | null = null

/** One observer for expensive surfaces, including hidden tabs and clipped scroll containers. */
export function useNearViewport(ref: RefObject<HTMLElement | null>, enabled = true) {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) { setNear(false); return }
    observer ??= new IntersectionObserver((entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
    }, { rootMargin: '150px' })
    listeners.set(element, (value) => {
      // Keep an editor alive while its selection or comment form has keyboard focus.
      if (!value && element.contains(document.activeElement)) return
      startTransition(() => setNear(value))
    })
    observer.observe(element)
    return () => {
      observer?.unobserve(element)
      listeners.delete(element)
      if (!listeners.size) { observer?.disconnect(); observer = null }
    }
  }, [ref, enabled])
  return enabled && near
}
