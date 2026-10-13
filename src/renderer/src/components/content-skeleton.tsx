import { Skeleton } from '@/components/ui/skeleton'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'

/** Placeholder geometry follows the content it replaces, without changing its surface. */
export function ContentSkeleton({ variant = 'list', rows = 5, label, className }: {
  variant?: 'list' | 'editor' | 'cards'
  rows?: number
  label?: string
  className?: string
}) {
  useLanguage()
  return <div role="status" aria-label={label ?? t('Loading…')} className={cn('min-w-0 overflow-hidden', variant === 'editor' ? 'p-4' : 'p-2', className)}>
    <span className="sr-only">{label ?? t('Loading…')}</span>
    <div aria-hidden="true" className={cn('flex flex-col', variant === 'cards' ? 'gap-3' : 'gap-2')}>
      {Array.from({ length: rows }, (_, index) => variant === 'cards' ?
        <div key={index} className="flex flex-col gap-3 rounded-md border border-border p-4">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-3 w-3/5" />
        </div> :
        <div key={index} className={cn('flex items-center gap-2', variant === 'list' ? 'h-5' : 'h-4')}>
          <Skeleton className={variant === 'list' ? 'size-3 shrink-0' : 'h-3 w-5 shrink-0'} />
          <Skeleton className="h-3" style={{ width: `${[62, 43, 74, 52, 35][index % 5]}%` }} />
        </div>)}
    </div>
  </div>
}
