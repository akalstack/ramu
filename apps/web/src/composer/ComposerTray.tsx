import { useLayoutEffect, useRef, useState, type ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart.
 * Slightly narrower than the composer: its square bottom corners would otherwise show beside the composer's rounded ones.
 *
 * With `stack`, live work folds into a card stack (see `.composer-tray-stack`). Pointing at it or moving focus into it
 * spreads the cards over the conversation: the tray keeps its folded height in the layout and grows upward on top, so
 * what the person is reading never moves. Opening a section is a choice, and that one does take room.
 */
export function ComposerTray({ className, stack = false, ...props }: ComponentProps<'div'> & { stack?: boolean }) {
  const tray = useRef<HTMLDivElement>(null)
  const [peek, setPeek] = useState(false)
  const [folded, setFolded] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = tray.current
    if (!stack || !element) return
    // The height to hold in the layout is the folded one, so it is only read while the stack is not spread.
    const observer = new ResizeObserver(() => {
      if (!element.hasAttribute('data-peek')) setFolded(element.offsetHeight)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [stack])
  if (!stack) return <div className={cn('composer-tray', className)} {...props} />
  return (
    <div className="composer-tray-slot" style={peek && folded !== null ? { height: folded } : undefined}>
      <div
        ref={tray}
        className={cn('composer-tray', className)}
        data-peek={peek || undefined}
        onPointerEnter={() => setPeek(true)}
        onPointerLeave={() => setPeek(false)}
        onFocus={() => setPeek(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPeek(false)
        }}
        {...props}
      />
    </div>
  )
}
