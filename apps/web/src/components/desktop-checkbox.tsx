import type { ComponentProps } from 'react'
import { cn } from 'cn'
import { Checkbox as PrimitiveCheckbox } from './ui/checkbox'
/** Keep the upstream checkbox's keyboard, label, ref and checked-state APIs. */
export function Checkbox({ className, ...props }: ComponentProps<typeof PrimitiveCheckbox>) {
  return <PrimitiveCheckbox className={cn('shrink-0', className)} {...props} />
}
