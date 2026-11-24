import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { CHAT_MOTION, SENT_MOTION } from '@ramu/shared/chat/presentation'
import { reducedMotion } from '../workspace/panelMotion'
import { WorkingText } from '../views/agent/components/WorkingText'
import { WORKING_CLASS } from '../views/agent/styles'
import { Spinner } from '@/components/ui/spinner'

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

/** When the latest sent message began rising, so the host's copy that replaces it carries on instead of restarting. */
let sentAt = Number.NEGATIVE_INFINITY

/**
 * A message you just sent rises from the composer into its place, as on the phone. `start` begins the rise (the pending
 * copy shown while sending); a message mounted while it runs (the host's copy) continues it from the same point. Only the
 * drawing moves, so the scroller's measurements and position are untouched.
 */
export function useSentRise<T extends HTMLElement>(start: boolean) {
  const node = useRef<T>(null)
  useLayoutEffect(() => {
    if (reducedMotion()) return
    const now = performance.now()
    if (start) sentAt = now
    const elapsed = now - sentAt
    if (elapsed >= SENT_MOTION.durationMs) return
    const animation = node.current?.animate(
      [
        { opacity: 0, transform: `translateY(${SENT_MOTION.rise}px) scale(${SENT_MOTION.scale})` },
        { opacity: 1, offset: SENT_MOTION.opaqueAt },
        { opacity: 1, transform: 'none' },
      ],
      { duration: SENT_MOTION.durationMs, easing: `cubic-bezier(${SENT_MOTION.easing.join(', ')})` },
    )
    if (animation) animation.currentTime = elapsed
    return () => animation?.cancel()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design: a message rises once, when it appears
  }, [])
  return node
}

/**
 * Status phases share the same entrance motion as messages; token and elapsed updates keep their identity. From the
 * send to the turn's end the line keeps its place, as on the phone: `quiet` (a live tool group above already says what
 * the agent is doing) hides the words but not the line, so the reply never swaps places with it.
 */
export function ChatStatus({ label, compacting, quiet }: { label: string; compacting?: boolean; quiet?: boolean }) {
  return (
    <div className={WORKING_CLASS} role="status" aria-live="polite" data-compacting={compacting || undefined}>
      <span className={quiet ? 'invisible' : undefined} aria-hidden={quiet || undefined}>
        <ChatFade identity={label} animate>
          <WorkingText>{label}</WorkingText>
        </ChatFade>
      </span>
    </div>
  )
}

/**
 * The rows on screen are this client's copy while the host catches the thread up. Quieter than the agent's own status:
 * nothing is wrong and nothing needs the person, so it neither shimmers nor takes the accent.
 */
export function ChatSyncStatus({ label }: { label: string }) {
  return (
    <div className={`${WORKING_CLASS} text-muted-foreground`} role="status" aria-live="polite" data-chat-sync>
      <ChatFade identity={label} animate>
        <span className="flex items-center gap-2">
          <Spinner role="presentation" aria-hidden aria-label={undefined} className="size-3.5 flex-none" />
          {label}
        </span>
      </ChatFade>
    </div>
  )
}
