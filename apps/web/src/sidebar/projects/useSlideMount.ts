import { useLayoutEffect, useRef, useState } from 'react'
import { slide } from '../../slide'

/** Keeps a collapsible element mounted while it slides closed, and slides it open once it is mounted. */
export function useSlideMount(open: boolean) {
  const [mounted, setMounted] = useState(open)
  const ref = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const opening = useRef(false)
  useLayoutEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) {
      if (ref.current) slide(ref.current, true)
      else {
        opening.current = true
        setMounted(true)
      }
    } else if (ref.current) slide(ref.current, false, () => setMounted(false))
    else setMounted(false)
  }, [open])
  useLayoutEffect(() => {
    if (mounted && opening.current && ref.current) {
      opening.current = false
      slide(ref.current, true)
    }
  }, [mounted])
  return { ref, visible: open || mounted }
}
