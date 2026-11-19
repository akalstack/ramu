import type { ReactNode } from 'react'

/** One heading style for every block under the start box, so what needs you reads first and the rest quietly. */
export function FeedSection({
  title,
  count,
  label,
  className = '',
  action,
  children,
}: {
  title: string
  count?: number
  label?: string
  className?: string
  /** Shown at the end of the heading row, such as "See all". */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`home-section flex flex-col gap-2 ${className}`} aria-label={label ?? title}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h2 className="text-control font-medium text-muted-foreground">
          {title}
          {count !== undefined && <span className="tabular-nums"> · {count}</span>}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}
