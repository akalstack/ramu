import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area'
import { cn } from 'cn'
import { ScrollBar } from '@/components/ui/scroll-area'

/**
 * shadcn's ScrollArea with an inner content element (so rows can shrink below their text width)
 * and a hook for the viewport's class. Ramu's lists use this; the shadcn file stays as the registry ships it.
 */
function OverlayScrollArea({
  className,
  viewportClassName,
  viewportRef,
  viewportProps,
  contentClassName,
  horizontal = false,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props & {
  viewportClassName?: string
  viewportRef?: React.Ref<HTMLDivElement>
  viewportProps?: React.HTMLAttributes<HTMLDivElement>
  contentClassName?: string
  horizontal?: boolean
}) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn(
        `relative overlay-scroll-area [&_>_[data-slot='scroll-area-viewport']]:[scrollbar-width:none] [&_>_[data-slot='scroll-area-viewport']]:[scrollbar-gutter:auto] [&_>_[data-slot='scroll-area-viewport']::-webkit-scrollbar]:hidden [&_>_[data-slot='scroll-area-scrollbar']]:[border:0] [&_>_[data-slot='scroll-area-scrollbar']]:p-0.5 [&_>_[data-slot='scroll-area-scrollbar']]:opacity-0 [&_>_[data-slot='scroll-area-scrollbar']]:[transition:opacity_160ms_ease] [&_>_[data-slot='scroll-area-scrollbar']]:z-45 [&:hover_>_[data-slot='scroll-area-scrollbar']]:opacity-100 [&:focus-within_>_[data-slot='scroll-area-scrollbar']]:opacity-100 [&_>_[data-slot='scroll-area-scrollbar'][data-scrolling]]:opacity-100 [&_>_[data-slot='scroll-area-scrollbar'][data-dragging]]:opacity-100 [&_[data-slot='scroll-area-thumb']]:[background:color-mix(in_srgb,_var(--text)_28%,_transparent)] [&_[data-slot='scroll-area-thumb']:hover]:[background:color-mix(in_srgb,_var(--text)_42%,_transparent)] [&_[data-slot=scroll-area-content]]:min-w-0 min-w-0 min-h-0 overflow-hidden!`,
        horizontal
          ? "[&_>_[data-slot='scroll-area-viewport']]:overflow-x-auto! [&_>_[data-slot='scroll-area-scrollbar']]:h-[7px]"
          : "[&_>_[data-slot='scroll-area-viewport']]:overflow-x-hidden! [&_>_[data-slot='scroll-area-scrollbar']]:w-[9px]",
        className,
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        ref={viewportRef}
        {...viewportProps}
        className={cn(
          'size-full rounded-[inherit] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
          viewportClassName,
        )}
      >
        <ScrollAreaPrimitive.Content
          data-slot="scroll-area-content"
          className={cn('w-full min-w-0', contentClassName)}
          style={{ minWidth: 0 }}
        >
          {children}
        </ScrollAreaPrimitive.Content>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar
        orientation={horizontal ? 'horizontal' : 'vertical'}
        style={horizontal ? { bottom: 0, top: 'auto' } : undefined}
      />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

export { OverlayScrollArea }
