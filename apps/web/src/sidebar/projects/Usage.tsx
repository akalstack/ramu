import { useEffect, useState } from 'react'
import { accountBrand } from '@ramu/shared/brands'
import { deployText, nearLimit } from '@ramu/shared/deployText'
import type { UsageReport } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

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
            <BrandIcon brand={accountBrand(report.platform)} />
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
              className={nearLimit(figure) ? 'text-destructive' : 'text-muted-foreground'}
            >
              {deployText(t, (at) => new Date(at).toLocaleString()).usageFigure(figure)}
            </span>
          ))}
          {report.figures.length > 0 && report.figures.every((figure) => !figure.limit) && (
            <span className="text-muted-foreground">
              {t('{0}’s API does not report plan limits. Open billing to see them.', { 0: report.name })}
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
