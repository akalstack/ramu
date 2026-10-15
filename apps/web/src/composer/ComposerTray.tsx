import type { ComponentProps } from 'react'
import { cn } from 'cn'

/** The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart. */
export function ComposerTray({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'composer-tray relative z-0 flex m-[0_auto_-10px] w-full p-[4px_0_14px]',
        '[border-radius:var(--radius-l)_var(--radius-l)_0_0] [background:var(--composer-tray)]',
        className,
      )}
      {...props}
    />
  )
}
