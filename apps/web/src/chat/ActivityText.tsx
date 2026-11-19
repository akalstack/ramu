import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'
import { reducedMotion } from '../workspace/panelMotion'
import { WorkingText } from '../views/agent/components/WorkingText'

/** Keep the real label visible; completion adds one delayed left-to-right highlight without moving layout. */
export function ActivityText({
  active,
  children,
  className = '',
}: {
  active: boolean
  children: ReactNode
  className?: string
}) {
  const overlay = useRef<HTMLSpanElement>(null)
  const previous = useRef(active)
  const shownAt = useRef(0)
  useLayoutEffect(() => {
    shownAt.current = performance.now()
  }, [])
  useLayoutEffect(() => {
    const completed = previous.current && !active
    previous.current = active
    if (!completed || reducedMotion() || performance.now() - shownAt.current < TOOL_MOTION.quietMs) return
    const animation = overlay.current?.animate(
      [
        { clipPath: 'inset(0 100% 0 0)', opacity: 1 },
        { clipPath: 'inset(0 0% 0 0)', opacity: 1, offset: TOOL_MOTION.fadeAt },
        { clipPath: 'inset(0 0% 0 0)', opacity: 0 },
      ],
      { delay: TOOL_MOTION.settleMs, duration: TOOL_MOTION.finishMs, easing: 'linear' },
    )
    return () => animation?.cancel()
  }, [active])
  return (
    <span className={`relative min-w-0 ${className}`}>
      <span>{active ? <WorkingText>{children}</WorkingText> : children}</span>
      <span
        ref={overlay}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden text-foreground opacity-0"
      >
        {children}
      </span>
    </span>
  )
}
