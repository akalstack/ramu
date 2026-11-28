import { useEffect, useState, type ReactNode } from 'react'
import { TOOL_MOTION } from '@ramu/shared/chat/presentation'
import { WorkingText } from '../views/agent/components/WorkingText'

/**
 * A tool's label, as on the phone: the real label, which pulses toward the text color while the call runs past a short
 * delay, so a command that finishes at once never flashes. A finished call reads as done with no highlight.
 */
export function ActivityText({
  active,
  children,
  className = '',
}: {
  active: boolean
  children: ReactNode
  className?: string
}) {
  const [settled, setSettled] = useState(false)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => setSettled(true), TOOL_MOTION.shimmerDelayMs)
    return () => {
      clearTimeout(timer)
      setSettled(false)
    }
  }, [active])
  return (
    <span className={`relative min-w-0 ${className}`}>
      {active && settled ? <WorkingText>{children}</WorkingText> : children}
    </span>
  )
}
