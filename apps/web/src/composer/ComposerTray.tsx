import type { ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * The panel tucked behind the composer's top edge. New chat and open chats share it so they cannot drift apart.
 * Slightly narrower than the composer: its square bottom corners would otherwise show beside the composer's rounded ones.
 */
export function ComposerTray({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('composer-tray', className)} {...props} />
}
