import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { cn } from 'cn'
import { ScrollBar } from '@/components/ui/scroll-area'

/**
 * shadcn's ScrollArea with an inner content element (so rows can shrink below their text width)
 * and a hook for the viewport's class. Ramu's lists use this; the shadcn file stays as the registry ships it.
 */
function OverlayScrollArea({ className, viewportClassName, children, ...props }: ScrollAreaPrimitive.Root.Props & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root data-slot="scroll-area" className={cn('relative overlay-scroll-area', className)} {...props}>
      <ScrollAreaPrimitive.Viewport data-slot="scroll-area-viewport" className={cn('size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', viewportClassName)}>
        <ScrollAreaPrimitive.Content data-slot="scroll-area-content" style={{ minWidth: 0 }}>{children}</ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

export { OverlayScrollArea }
