import { useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart.
 * Slightly narrower than the composer: its square bottom corners would otherwise show beside the composer's rounded ones.
 *
 * With `stack`, live work folds into a card stack (see `.composer-tray-stack`). Pointing at it or moving focus into it
 * spreads the cards over the conversation: the tray keeps its folded height in the layout and grows upward on top, so
 * what the person is reading never moves. Opening a section is a choice, and that one does take room.
 */
/** How long the stack takes to fold back (`.composer-tray-stack` transitions), with a frame to spare. */
const FOLD_MS = 300

export function ComposerTray({ className, stack = false, ...props }: ComponentProps<'div'> & { stack?: boolean }) {
  const tray = useRef<HTMLDivElement>(null)
  const [peek, setPeek] = useState(false)
  // Floating outlives the spread: the cards fold back while the tray still floats, and only then does it rejoin the
  // layout at exactly its folded height, so the conversation never resizes while the stack moves.
  const [floating, setFloating] = useState(false)
  const settle = useRef<number | undefined>(undefined)
  const [folded, setFolded] = useState<number | null>(null)
  const spread = (on: boolean) => {
    window.clearTimeout(settle.current)
    setPeek(on)
    if (on) setFloating(true)
    else settle.current = window.setTimeout(() => setFloating(false), FOLD_MS)
  }
  useEffect(() => () => window.clearTimeout(settle.current), [])
  useLayoutEffect(() => {
    const element = tray.current
    if (!stack || !element) return
    // The height to hold in the layout is the folded one, so it is only read while the stack is not spread.
    const observer = new ResizeObserver(() => {
      if (!element.hasAttribute('data-float')) setFolded(element.offsetHeight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [stack])
  if (!stack) return <div className={cn('composer-tray', className)} {...props} />
  return (
    <div className="composer-tray-slot" style={floating && folded !== null ? { height: folded } : undefined}>
      <div
        ref={tray}
        className={cn('composer-tray', className)}
        data-peek={peek || undefined}
        data-float={floating || undefined}
        onPointerEnter={() => spread(true)}
        onPointerLeave={() => spread(false)}
        onFocus={() => spread(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) spread(false)
        }}
        {...props}
      />
    </div>
  )
}
