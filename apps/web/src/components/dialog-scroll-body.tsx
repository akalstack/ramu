import type { ComponentProps } from 'react'
import { cn } from 'cn'

/**
 * For a dialog that can be taller than the window: the title and the actions stay put and only what is between them
 * scrolls. Give the dialog's content `DIALOG_SCROLLS` and put its middle in `DialogScrollBody`.
 */
export const DIALOG_SCROLLS = 'flex max-h-[calc(100vh-48px)] flex-col overflow-hidden'

export function DialogScrollBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('-mx-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4', className)} {...props} />
}
