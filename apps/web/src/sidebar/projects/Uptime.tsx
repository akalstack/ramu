import { useEffect, useState } from 'react'
import type { UptimeCheck, UptimeStatus } from '@ramu/shared/types'
import { Checkbox } from '@/components/desktop-checkbox'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const time = (at: number) => new Date(at).toLocaleString()

function lastCheck(check: UptimeCheck): string {
  const answer =
    check.status !== null
      ? t('HTTP {0} in {1} ms', { 0: check.status, 1: check.ms ?? 0 })
      : check.failure === 'timeout'
        ? t('no answer within 10 seconds')
        : check.failure === 'redirects'
          ? t('too many redirects')
          : t('could not connect')
  if (check.result === 'up') return t('Up · {0} · checked {1}', { 0: answer, 1: time(check.at) })
  if (check.result === 'down') return t('Not answering · {0} · checked {1}', { 0: answer, 1: time(check.at) })
  return t('Unknown · this computer was offline or asleep at {0}', { 0: time(check.at) })
}

/**
 * The Deploy sheet's live address watch: on by default, checked from this host every five minutes, with the last
 * result, any span the host was asleep, and the open incident.
 */
export function UptimeSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<UptimeStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    host.invoke('deploy.uptime', projectId).then(
      (value) => current && setStatus(value),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId])
  const toggle = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await host.invoke('deploy.setUptime', projectId, enabled))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!status && !error) return null
  return (
    <section aria-label={t('Uptime')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <label className="flex items-center gap-2">
        <Checkbox
          checked={status?.enabled ?? false}
          disabled={busy || !status}
          onCheckedChange={(checked) => void toggle(checked === true)}
        />
        <strong>{t('Watch the live address')}</strong>
      </label>
      {status?.enabled && (
        <div className="flex flex-col gap-1 text-caption text-muted-foreground" role="status">
          <span>
            {status.url
              ? t(
                  'This computer checks {0} every five minutes. Two failed checks in a row open a thread here and notify your phone.',
                  { 0: status.url },
                )
              : t('Checks start once the app has a live production deployment.')}
          </span>
          {status.last && (
            <span className={status.last.result === 'down' ? 'text-destructive' : undefined}>
              {lastCheck(status.last)}
            </span>
          )}
          {status.downSince !== null && (
            <span className="text-destructive">{t('Failing since {0}', { 0: time(status.downSince) })}</span>
          )}
          {status.incident && (
            <span>
              {t('An incident thread is open in this project since {0}.', { 0: time(status.incident.openedAt) })}
            </span>
          )}
          {status.gap && (
            <span>
              {t('Unknown from {0} to {1}: this computer was asleep or Ramu was not running.', {
                0: time(status.gap.from),
                1: time(status.gap.to),
              })}
            </span>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
