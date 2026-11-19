import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'

/** A transcript summary stays quiet while sharing the app button's focus, keyboard and disabled behavior. */
export function SummaryDisclosureButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      className={cn(
        className,
        'h-auto min-h-0 w-full cursor-pointer justify-start gap-1.5 rounded-none border-0 border-b border-line bg-transparent px-0 pt-1.5 pb-2 text-left text-[length:var(--font-chat)] font-normal text-muted-foreground hover:border-border hover:bg-transparent hover:text-soft dark:hover:bg-transparent aria-expanded:bg-transparent active:translate-y-0 disabled:cursor-default',
      )}
    />
  )
}
