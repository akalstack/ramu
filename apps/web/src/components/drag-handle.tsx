import type { ComponentProps } from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from 'cn'
import { Button } from './desktop-button'
import { GHOST_BUTTON_CLASS } from './button-classes'

/** Pointer and keyboard sensors attach to this same accessible, focusable activator. */
export function DragHandle({
  className,
  title,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'variant' | 'size'> & { 'aria-label': string }) {
  return (
    <Button
      {...props}
      type="button"
      variant="ghost"
      size="icon-xs"
      title={title ?? props['aria-label']}
      className={cn(
        GHOST_BUTTON_CLASS,
        'inline-grid h-[22px] min-h-0 w-[18px] flex-none touch-none cursor-grab place-items-center rounded-(--radius-xs) p-0 active:translate-y-0 active:cursor-grabbing disabled:cursor-default aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-muted-foreground',
        className,
      )}
    >
      <GripVertical size={14} aria-hidden="true" />
    </Button>
  )
}
