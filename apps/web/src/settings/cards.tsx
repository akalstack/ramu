import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/desktop-button'
import { t } from '../i18n'

/** The compact look of every card in a Settings list: a tight header row, one quiet meta line, actions at the end. */
export const SETTINGS_CARD = 'settings-card flex flex-col gap-1 rounded-(--radius-m) bg-card px-3 py-2'

export function SettingsCard({
  title,
  badges,
  meta,
  actions,
  children,
  className = '',
  id,
}: {
  title: ReactNode
  badges?: ReactNode
  meta?: ReactNode
  /** Small buttons shown at the end of the header row. */
  actions?: ReactNode
  children?: ReactNode
  className?: string
  id?: string
}) {
  return (
    <article id={id} className={`${SETTINGS_CARD} ${className}`}>
      <div className="flex min-h-7 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <strong className="min-w-0 truncate text-control font-medium">{title}</strong>
          {badges}
        </div>
        {actions && <div className="flex flex-none items-center gap-0.5">{actions}</div>}
      </div>
      {meta && <p className="m-0 truncate text-caption text-muted-foreground">{meta}</p>}
      {children}
    </article>
  )
}

/** Cards stacked tightly, as one list. */
export function SettingsCardList({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>
}

/**
 * Long lists show a page at a time: the first `size` items, then "Show more" for the next page. Change `resetKey`
 * (a search or filter) to go back to the first page.
 */
export function usePaged<T>(items: T[], size = 20, resetKey?: unknown) {
  const [count, setCount] = useState(size)
  useEffect(() => setCount(size), [resetKey, size])
  const shown = items.slice(0, count)
  const more =
    items.length > shown.length ? (
      <Button
        variant="ghost"
        size="sm"
        className="self-start text-muted-foreground small text-caption"
        onClick={() => setCount(count + size)}
      >
        {t('Show more')} · {Math.min(size, items.length - shown.length)} / {items.length - shown.length}
      </Button>
    ) : null
  return { shown, more }
}
