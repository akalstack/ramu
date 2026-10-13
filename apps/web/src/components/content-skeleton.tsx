import { Skeleton } from '@/components/ui/skeleton'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'

/** Placeholder bars use the app's field fill and radius so they read as part of the surface they replace. */
const Bar = ({ className, style }: { className?: string; style?: React.CSSProperties }) => <Skeleton className={cn('bg-fill rounded-(--radius-s)', className)} style={style} />

/** Placeholder geometry follows the content it replaces, without changing its surface. */
export function ContentSkeleton({ variant = 'list', rows = 5, label, className }: {
  variant?: 'list' | 'editor' | 'cards' | 'chat'
  rows?: number
  label?: string
  className?: string
}) {
  useLanguage()
  return <div role="status" aria-label={label ?? t('Loading…')} className={cn('min-w-0 overflow-hidden', variant === 'editor' ? 'p-4' : variant === 'chat' ? 'p-0' : 'p-2', className)}>
    <span className="sr-only">{label ?? t('Loading…')}</span>
    <div aria-hidden="true" className={cn('flex flex-col', variant === 'cards' ? 'gap-3' : variant === 'chat' ? 'mx-auto w-full max-w-[var(--chat-column-width)] gap-3.5' : variant === 'list' ? 'gap-0' : 'gap-2')}>
      {variant === 'chat' ? Array.from({ length: rows }, (_, index) => <div key={index} className="flex flex-col gap-3.5">
        {/* Your message: a right-aligned bubble. */}
        <div className="flex justify-end"><Bar className="h-8 rounded-(--radius-m)" style={{ width: `${[38, 28, 44][index % 3]}%` }} /></div>
        {/* The reply: plain text lines, no surface. */}
        <div className="flex flex-col gap-2.5">
          <Bar className="h-3.5 w-[92%]" />
          <Bar className="h-3.5 w-[78%]" />
          <Bar className="h-3.5 w-[54%]" />
        </div>
      </div>) : Array.from({ length: rows }, (_, index) => variant === 'cards' ?
        <div key={index} className="flex flex-col gap-3 rounded-(--radius-m) bg-card p-4">
          <Bar className="h-4 w-2/5" />
          <Bar className="h-3 w-4/5" />
          <Bar className="h-3 w-3/5" />
        </div> :
        <div key={index} className={cn('flex items-center', variant === 'list' ? 'h-7 gap-1.5 px-2' : 'h-4 gap-2')}>
          <Bar className={variant === 'list' ? 'size-3.5 shrink-0' : 'h-3 w-5 shrink-0'} />
          <Bar className="h-3" style={{ width: `${[62, 43, 74, 52, 35][index % 5]}%` }} />
        </div>)}
    </div>
  </div>
}
