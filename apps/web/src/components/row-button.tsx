import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Button } from './desktop-button'

/** A selectable/openable list row; metadata and trailing actions remain composed by the feature. */
export function RowButton({
  className,
  size = 'default',
  stacked = false,
  ...props
}: Omit<ComponentProps<typeof Button>, 'variant' | 'size'> & {
  size?: 'sm' | 'default' | 'lg'
  stacked?: boolean
}) {
  return (
    <Button
      {...props}
      type="button"
      variant="tree"
      className={cn(
        'row-button h-auto min-w-0 w-full cursor-default justify-start whitespace-normal text-left font-normal text-soft aria-pressed:bg-hover aria-selected:bg-hover aria-disabled:opacity-40 aria-disabled:hover:bg-transparent aria-disabled:hover:text-soft',
        size === 'sm'
          ? 'min-h-8 gap-2.5 px-1.5 py-0.5 text-[length:var(--font-control)]'
          : size === 'lg'
            ? 'min-h-12 gap-3 px-2.5 py-1.5 text-[length:var(--font-body)]'
            : 'min-h-8 gap-3 p-2 text-[length:var(--font-body)]',
        stacked && 'flex-col items-start gap-0.5',
        className,
      )}
    />
  )
}
