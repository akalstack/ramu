import { useEffect, useState } from 'react'
import type { UsageFigure, UsageReport } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const METRIC: Record<Exclude<UsageFigure['metric'], 'service'>, string> = {
  'build-minutes': 'Build minutes',
  storage: 'Database storage',
  compute: 'Database compute',
  transfer: 'Data transfer',
}

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 })

/** A figure in the unit a person reads: bytes as MB or GB, seconds as hours. */
function amount(value: number, unit: string): string {
  if (unit === 'bytes')
    return value >= 1024 ** 3
      ? t('{0} GB', { 0: number(value / 1024 ** 3) })
      : t('{0} MB', { 0: number(value / 1024 ** 2) })
  if (unit === 'seconds') return t('{0} hours', { 0: number(value / 3600) })
  if (unit === 'minutes') return t('{0} minutes', { 0: number(value) })
  return `${number(value)} ${unit}`.trim()
}

function figureText(figure: UsageFigure): string {
  const name = figure.metric === 'service' ? (figure.service ?? '') : t(METRIC[figure.metric])
  const used = amount(figure.used, figure.unit)
  if (!figure.limit) return t('{0}: {1}', { 0: name, 1: used })
  return t('{0}: {1} of {2} ({3}%)', {
    0: name,
    1: used,
    2: amount(figure.limit, figure.unit),
    3: Math.round((figure.used / figure.limit) * 100),
  })
}

/**
 * The Deploy sheet's usage: what each platform reports for the current billing period, beside the plan's limit when
 * the platform reports one, and Open billing. Ramu never changes a plan or adds a payment method.
 */
export function UsageSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [reports, setReports] = useState<UsageReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    host.invoke('deploy.usage', projectId).then(
      (value) => current && setReports(value),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId])
  if (!error && !reports?.length) return null
  return (
    <section aria-label={t('Usage')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Usage this billing period')}</strong>
      {reports?.map((report) => (
        <div key={report.platform} className="flex flex-col gap-1 text-caption">
          <span className="flex items-center gap-2">
            <BrandIcon brand={report.platform} />
            <span className="flex-1 text-foreground">
              {report.period
                ? t('{0} since {1}', { 0: report.name, 1: new Date(report.period.start).toLocaleDateString() })
                : report.name}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void openOnThisComputer('app.openExternal', report.billingPage)}
            >
              {t('Open billing')}
            </Button>
          </span>
          {report.figures.map((figure) => (
            <span
              key={`${figure.metric}:${figure.service ?? ''}:${figure.unit}`}
              className={
                figure.limit && figure.used >= figure.limit * 0.8 ? 'text-destructive' : 'text-muted-foreground'
              }
            >
              {figureText(figure)}
            </span>
          ))}
          {report.figures.length > 0 && report.figures.every((figure) => !figure.limit) && (
            <span className="text-muted-foreground">
              {t('{0}’s API reports no plan limits; Open billing shows them.', { 0: report.name })}
            </span>
          )}
          {report.unavailable && <span className="text-muted-foreground">{report.unavailable}</span>}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
