import { CalendarClock } from 'lucide-react'
import { RowButton } from '../components/row-button'
import { t, useLanguage } from '../i18n'
import { usePageIndex } from './pageIndex'
import { openPage } from './openPage'
import { useHost } from '../workspace/HostProvider'

/** Runs pages do on their own, listed in Schedules under each page, opening the page to change or allow them. */
export function PageSchedules() {
  useLanguage()
  const { pages } = usePageIndex()
  const host = useHost().id
  const rows = [...pages.values()].flatMap((page) =>
    (page.capabilities.schedules ?? []).map((schedule, index) => ({ page, schedule, index })),
  )
  if (!rows.length) return null
  return (
    <section className="flex flex-col gap-1" aria-label={t('Artifact runs')}>
      <h2 className="m-0 text-control font-medium text-muted-foreground">{t('Artifact runs')}</h2>
      {rows.map(({ page, schedule, index }) => (
        <RowButton key={`${page.id}:${index}`} onClick={() => openPage(page.id, host)}>
          <span aria-hidden className="w-6 flex-none text-center">
            {page.icon}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">
              {page.capabilities.runs?.[schedule.run]?.label ?? schedule.run}
            </span>
            <span className="block truncate text-caption text-muted-foreground">
              {page.title} ·{' '}
              {schedule.every === 'hourly'
                ? t('Every hour')
                : schedule.every === 'daily'
                  ? t('Every day at {time}', { time: schedule.at ?? '08:00' })
                  : t('Every Monday at {time}', { time: schedule.at ?? '08:00' })}
            </span>
          </span>
          {!(page.grants.schedules && page.grants.ai) && (
            <span className="flex flex-none items-center gap-1 text-caption text-muted-foreground">
              <CalendarClock size={12} /> {t('Not allowed')}
            </span>
          )}
        </RowButton>
      ))}
    </section>
  )
}
