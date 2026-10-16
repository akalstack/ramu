import { useState, type ReactNode } from 'react'
import { Button } from '@/components/desktop-button'
import { t } from './i18n'

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

/** Home is a glance: the first few rows, with the rest one click away. */
export function useCapped<T>(items: T[], limit = 3) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, limit)
  const toggle =
    items.length > limit ? (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground small text-caption"
        aria-expanded={all}
        onClick={() => setAll(!all)}
      >
        {all ? t('Show less') : `${t('Show all')} · ${items.length}`}
      </Button>
    ) : null
  return { shown, toggle }
}
