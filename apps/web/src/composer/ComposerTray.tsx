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
  const [peek, setPeek] = useState(false)
  if (!stack) return <div className={cn('composer-tray', className)} {...props} />
  return (
    <div
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
  )
}
