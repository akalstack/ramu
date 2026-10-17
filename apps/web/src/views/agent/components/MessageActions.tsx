import { cn } from 'cn'
import { MessageFooter } from '@/components/ui/message'

/** The row under a message: time, copy and the like. It shows on hover or focus; `latest` keeps it visible. */
export function MessageActions({
  latest,
  className,
  ...props
}: React.ComponentProps<typeof MessageFooter> & { latest?: boolean }) {
  return (
    <MessageFooter
      className={cn(
        'h-6 gap-0.5 px-0 opacity-0 transition-opacity duration-100 focus-within:opacity-100 group-hover/message:opacity-100',
        latest && 'opacity-100',
        className,
      )}
      {...props}
    />
  )
}
