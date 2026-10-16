import type { ReactNode } from 'react'

/** One heading style for every block under the start box, so what needs you reads first and the rest quietly. */
export function FeedSection({
  title,
  count,
  label,
  className = '',
  children,
}: {
  title: string
  count?: number
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`home-section flex flex-col gap-2 ${className}`} aria-label={label ?? title}>
      <h2 className="px-1 text-control font-medium text-muted-foreground">
        {title}
        {count !== undefined && <span className="tabular-nums"> · {count}</span>}
      </h2>
      {children}
    </section>
  )
}
