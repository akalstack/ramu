import { Slider as SliderPrimitive } from '@base-ui/react/slider'
import { cn } from 'cn'
import { useEffect, useState } from 'react'

/**
 * A one-thumb slider over whole steps, with an accessible name and spoken value for the thumb.
 * Same parts and classes as shadcn's Slider; the thumb only animates once it has measured itself.
 */
function StepSlider({ className, value, thumbLabel, valueText, ...props }: Omit<SliderPrimitive.Root.Props<number>, 'value' | 'defaultValue'> & { value: number; thumbLabel: string; valueText?: string }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => setReady(true)) })
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <SliderPrimitive.Root data-slot="slider" data-slider-ready={ready ? '' : undefined} className={cn('data-horizontal:w-full', className)} value={value} thumbAlignment="edge" {...props}>
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50">
        <SliderPrimitive.Track data-slot="slider-track" className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1 data-horizontal:w-full">
          <SliderPrimitive.Indicator data-slot="slider-range" className="bg-primary select-none data-horizontal:h-full" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb data-slot="slider-thumb" aria-label={thumbLabel} getAriaValueText={valueText ? () => valueText : undefined} className="relative block size-3 shrink-0 rounded-full border border-ring bg-white ring-ring/50 transition-[color,box-shadow] select-none after:absolute after:-inset-2 hover:ring-3 focus-visible:ring-3 focus-visible:outline-hidden active:ring-3" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { StepSlider }
