import { useEffect, useState } from 'react'
import { uptimeCheckText } from '@ramu/shared/deployText'
import type { UptimeStatus } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const time = (at: number) => new Date(at).toLocaleString()

/**
 * The Deploy sheet's live address: where people use the app, which this host checks every five minutes while the
 * watch is on (the default), with the last result, any span the host was asleep, and the open incident.
 */
export function LiveAddressSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<UptimeStatus | null>(null)
  const [address, setAddress] = useState<string | null>(null)
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
  const run = async (work: () => Promise<UptimeStatus>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await work())
      setAddress(null)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!status && !error) return null
  // The field shows the saved address until the person edits it.
  const shown = address ?? status?.address ?? ''
  const changed = shown.trim() !== (status?.address ?? '')
  return (
    <section aria-label={t('Live address')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Live address')}</strong>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (!changed) return
          void run(() => host.invoke('deploy.setLiveAddress', projectId, shown.trim() || null))
        }}
      >
        <Input
          aria-label={t('Live address')}
          className="flex-1"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="https://"
          disabled={busy || !status}
          value={shown}
          onChange={(event) => setAddress(event.target.value)}
        />
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !changed}>
          {shown.trim() ? t('Save') : t('Forget')}
        </Button>
      </form>
      <label className="flex items-center gap-2">
        <Checkbox
          checked={status?.enabled ?? false}
          disabled={busy || !status}
          onCheckedChange={(checked) => void run(() => host.invoke('deploy.setUptime', projectId, checked === true))}
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
              : t('Checks start once you save the address people use the app at.')}
          </span>
          {status.last && (
            <span className={status.last.result === 'down' ? 'text-destructive' : undefined}>
              {uptimeCheckText(t, time, status.last)}
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
