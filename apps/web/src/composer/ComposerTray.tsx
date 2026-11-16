import { useState, type ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart.
 * Slightly narrower than the composer: its square bottom corners would otherwise show beside the composer's rounded ones.
 *
 * With `stack`, pointing at the tray or moving focus into it marks it `data-peek`, which spreads its `TrayStack` above
 * it. Only that overlay moves; the tray keeps its size, so what the person is reading stays where it is.
 */
export function ComposerTray({ className, stack = false, ...props }: ComponentProps<'div'> & { stack?: boolean }) {
  // Pointing and focus are tracked apart: after a section is opened and closed, focus stays in the tray, so the stack
  // stays spread even once the pointer leaves, until the person moves on elsewhere.
  const [pointed, setPointed] = useState(false)
  const [focused, setFocused] = useState(false)
  if (!stack) return <div className={cn('composer-tray', className)} {...props} />
  return (
    <div
      className={cn('composer-tray', className)}
      data-peek={pointed || focused || undefined}
      onPointerEnter={() => setPointed(true)}
      onPointerLeave={() => setPointed(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false)
      }}
      {...props}
    />
  )
}
