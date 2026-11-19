import type { ComponentProps } from 'react'
import { cn } from 'cn'

/** Constrain the whole stack before insetting its trays, including in a wide pane. */
export function ComposerStack({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('composer-stack', className)} {...props} />
}
