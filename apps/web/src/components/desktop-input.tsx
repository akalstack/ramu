import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Input as PrimitiveInput } from './ui/input'
/** App density and theme around the upstream input, preserving its ref and accessibility props. */
export function Input({ className, ...props }: ComponentProps<typeof PrimitiveInput>) {
  return <PrimitiveInput className={cn('h-8 text-body bg-field', className)} {...props} />
}
