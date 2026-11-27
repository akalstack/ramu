import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { elapsedText } from '@ramu/shared/chat/agentActivity'
import { t as translate } from '../i18n'
import { CHAT_MOTION, SENT_MOTION } from '@ramu/shared/chat/presentation'
import { reducedMotion } from '../workspace/panelMotion'
import { WorkingText } from '../views/agent/components/WorkingText'
import { WORKING_CLASS } from '../views/agent/styles'
import { Spinner } from '@/components/ui/spinner'

/**
 * Fades an element in each time `identity` changes, and when it first shows if `animate`. Text that changes under the
 * same identity (a streaming line, a running timer) stays still.
 */
export function useChatFade<T extends HTMLElement>(identity: string, animate = false) {
  const node = useRef<T>(null)
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
  return node
}

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
  const node = useChatFade<HTMLSpanElement>(identity, animate)
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
 * Status phases share the same entrance motion as messages; token and elapsed updates keep their identity. The line is
 * left out while a live tool group says what the agent is doing, so that group's row sits on the line this one held.
 * `enter: false` skips the entrance for a line that was already on screen in the view this one replaces, as when a new
 * thread opens.
 */
export function ChatStatus({
  label,
  compacting,
  enter = true,
  since,
}: {
  label: string
  compacting?: boolean
  enter?: boolean
  /** When the running turn began: the line reads "Working for 12s" and counts on, as T3 Code's does. */
  since?: number | null
}) {
  return (
    <div className={WORKING_CLASS} role="status" aria-live="polite" data-compacting={compacting || undefined}>
      <ChatFade identity={label} animate={enter}>
        <WorkingText>{since ? <WorkingFor since={since} /> : label}</WorkingText>
      </ChatFade>
    </div>
  )
}

/** "Working for 12s", counting on once a second. */
function WorkingFor({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  return translate('Working for {0}', { 0: elapsedText(now - since) })
}

/**
 * The rows on screen are this client's copy while the host catches the thread up. Quieter than the agent's own status:
 * nothing is wrong and nothing needs the person, so it neither shimmers nor takes the accent.
 */
/**
 * A pill floating at the top of the transcript while it is read again. It takes no room in the transcript, so nothing
 * moves when it comes and goes, and it stays clear of the jump-to-latest button at the bottom.
 */
export function ChatSyncStatus({ label }: { label: string }) {
  return (
    <div
      className="pointer-events-none absolute top-2 left-1/2 z-10 -translate-x-1/2"
      role="status"
      aria-live="polite"
      data-chat-sync
    >
      <ChatFade identity={label} animate>
        <span className="flex items-center gap-2 rounded-full bg-raised px-3 py-1 text-caption text-muted-foreground shadow-md">
          <Spinner role="presentation" aria-hidden aria-label={undefined} className="size-3.5 flex-none" />
          {label}
        </span>
      </ChatFade>
    </div>
  )
}
