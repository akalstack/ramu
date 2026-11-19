import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'

/** Quiet sidebar section/host disclosure with the shared tree focus and hover states. */
export function SidebarDisclosureButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      {...props}
      type="button"
      variant="tree"
      className={cn(
        'h-auto min-h-0 min-w-0 gap-2 px-1 py-1 text-[length:var(--font-control)] font-medium text-muted-foreground',
        className,
      )}
    />
  )
}
