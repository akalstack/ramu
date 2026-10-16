import type { ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart.
 * Slightly narrower than the composer: its square bottom corners would otherwise show beside the composer's rounded ones.
 */
export function ComposerTray({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'composer-tray relative z-0 flex m-[0_auto_-10px] w-[calc(100%-40px)] p-[4px_0_14px]',
        '[border-radius:var(--radius-l)_var(--radius-l)_0_0] [background:var(--composer-tray)]',
        className,
      )}
      {...props}
    />
  )
}
