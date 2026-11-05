import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle } from '@/components/settings-row'
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

/** A section's title and one line on what it is for, with its main action at the end. */
export function SettingsSectionHead({
  title,
  help,
  action,
}: {
  title: ReactNode
  help?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mt-5 mb-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <SettingsGroupTitle className="mb-1">{title}</SettingsGroupTitle>
        {help && <p className="m-0 text-caption text-muted-foreground">{help}</p>}
      </div>
      {action}
    </div>
  )
}

/**
 * A settings line inside a card: its label, then a control of fixed width so labels are never squeezed. The cap is a
 * max-width because a global rule stretches every select trigger and outranks a width utility.
 */
export const SETTINGS_CARD_LINE =
  'flex min-h-8 items-center justify-between gap-3 [&_.dropdown-trigger]:max-w-[150px] [&_.dropdown-trigger]:flex-none'

/** What an empty Settings list says in its place: that there is nothing yet, and how something gets there. */
export function SettingsEmpty({ children }: { children: ReactNode }) {
  return (
    <p
      className="m-0 rounded-(--radius-m) border border-dashed border-(--line) px-3 py-4 text-center text-caption text-muted-foreground"
      role="status"
    >
      {children}
    </p>
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
