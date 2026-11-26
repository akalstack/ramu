import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/*
 * Ramu marks controls by fill, not outline (`--color-input` is transparent), so a toggle group in shadcn's outline style
 * showed its unchosen options as bare text. These give every choice a visible surface in both themes.
 */

type GroupProps = Omit<ComponentProps<typeof ToggleGroup>, 'variant' | 'spacing'>
type ItemProps = Omit<ComponentProps<typeof ToggleGroupItem>, 'variant'>

/** Two to four joined choices on one filled track, the chosen one raised: Full access / View only. */
export function SegmentedControl({ className, ...props }: GroupProps) {
  return <ToggleGroup {...props} spacing={0} className={cn('gap-0.5 rounded-(--radius-s) bg-fill p-0.5', className)} />
}

export function SegmentedItem({ className, ...props }: ItemProps) {
  return (
    <ToggleGroupItem
      {...props}
      className={cn(
        'rounded-[calc(var(--radius-s)-2px)]! px-2.5 text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-raised aria-pressed:text-foreground aria-pressed:shadow-[0_1px_2px_rgb(0_0_0/0.2)]',
        className,
      )}
    />
  )
}

/** Separate choices that wrap, such as kinds to filter by: each a filled chip, the chosen one in the accent wash. */
export function ChoiceChips({ className, ...props }: GroupProps) {
  return <ToggleGroup {...props} spacing={2} className={cn('flex-wrap gap-1.5', className)} />
}

export function ChoiceChip({ className, ...props }: ItemProps) {
  return (
    <ToggleGroupItem
      {...props}
      className={cn(
        'bg-fill px-2.5 text-soft hover:bg-fill-hover hover:text-foreground aria-pressed:bg-brand-wash aria-pressed:text-foreground',
        className,
      )}
    />
  )
}
