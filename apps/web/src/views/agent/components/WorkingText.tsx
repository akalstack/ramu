import { useLayoutEffect, useRef, useState } from 'react'
import { sweepDuration, TOOL_MOTION } from '@ramu/shared/chat/presentation'

/**
 * Keep the moving text highlight without a background shorthand resetting text clipping. The pass is timed by the
 * label's width, so a long command crosses at the same calm pace as a short one instead of streaking past.
 */
export function WorkingText({ children }: { children: React.ReactNode }) {
  const text = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    const element = text.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(element.offsetWidth))
    observer.observe(element)
    setWidth(element.offsetWidth)
    return () => observer.disconnect()
  }, [])
  return (
    <span
      ref={text}
      className="shimmer bg-clip-text text-transparent motion-reduce:animate-none!"
      style={{
        backgroundImage: 'linear-gradient(90deg, var(--muted) 30%, var(--text) 50%, var(--muted) 70%)',
        backgroundSize: '200% 100%',
        backgroundRepeat: 'repeat-x',
        animation: `shimmer ${sweepDuration(width, TOOL_MOTION.sweepMs, TOOL_MOTION.sweepPxPerSecond)}ms linear infinite`,
      }}
    >
      {children}
    </span>
  )
}
