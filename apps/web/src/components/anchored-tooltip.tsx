import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip'
import { cn } from 'cn'

/**
 * shadcn's tooltip popup placed against any element (Ramu shows native `title` text this way),
 * above dialogs and menus, and never in the pointer's way.
 */
function AnchoredTooltip({ anchor, side = 'bottom', sideOffset = 6, className, children, ...props }: TooltipPrimitive.Popup.Props & Pick<TooltipPrimitive.Positioner.Props, 'anchor' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner anchor={anchor} side={side} sideOffset={sideOffset} className="pointer-events-none isolate z-[1200]">
        <TooltipPrimitive.Popup data-slot="tooltip-content" className={cn('z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md px-3 py-1.5 text-xs [overflow-wrap:anywhere]', className)} {...props}>
          {children}
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  )
}

export { AnchoredTooltip }
