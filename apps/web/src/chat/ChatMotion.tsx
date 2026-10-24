import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { CHAT_MOTION } from '@ramu/shared/chat/presentation'
import { reducedMotion } from '../workspace/panelMotion'
import { WorkingText } from '../views/agent/components/WorkingText'
import { WORKING_CLASS } from '../views/agent/styles'

/** Fade changed content without replacing its disclosure, focus target, or live region. */
export function ChatFade({
  identity,
  children,
  className,
  animate = false,
}: {
  identity: string
  children: ReactNode
  className?: string
  animate?: boolean
}) {
  const node = useRef<HTMLSpanElement>(null)
  const previous = useRef(identity)
  const enter = useRef(animate).current
  useLayoutEffect(() => {
    const changed = previous.current !== identity
    previous.current = identity
    if ((!enter && !changed) || reducedMotion()) return
    const animation = node.current?.animate(
      [
        { opacity: 0, transform: `translateY(${CHAT_MOTION.rise}px)` },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: CHAT_MOTION.durationMs, easing: `cubic-bezier(${CHAT_MOTION.easing.join(', ')})` },
    )
    return () => animation?.cancel()
  }, [identity, enter])
  return (
    <span ref={node} className={className} style={{ display: 'inline-block' }}>
      {children}
    </span>
  )
}

/** Status phases share the same entrance motion as messages; token and elapsed updates keep their identity. */
export function ChatStatus({ label, compacting }: { label: string; compacting?: boolean }) {
  return (
    <div className={WORKING_CLASS} role="status" aria-live="polite" data-compacting={compacting || undefined}>
      <ChatFade identity={label} animate>
        <WorkingText>{label}</WorkingText>
      </ChatFade>
    </div>
  )
}
