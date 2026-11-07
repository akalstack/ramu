import { useEffect, useState } from 'react'
import type { LocalAppStatus } from '@ramu/shared/types/deploy'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

/**
 * The Deploy sheet's "Run on this computer", for demos and home use: the app runs in a container here and gets a
 * public address of its own through a tunnel that reaches only the app.
 */
export function LocalAppSection({ projectId, repoId }: { projectId: string; repoId: string | null }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<LocalAppStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Running without Docker is a second, explicit choice: the sheet first says what it means.
  const [withoutDocker, setWithoutDocker] = useState(false)
  useEffect(() => {
    let current = true
    const read = () =>
      host.invoke('deploy.localStatus', projectId).then(
        (value) => current && setStatus(value),
        () => {},
      )
    void read()
    // The address appears once the tunnel is up, a few seconds after the container starts.
    const timer = window.setInterval(() => void read(), 5_000)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [host, projectId])
  const act = async (work: () => Promise<LocalAppStatus | void>) => {
    setBusy(true)
    setError(null)
    try {
      setStatus((await work()) ?? (await host.invoke('deploy.localStatus', projectId)))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const on = status && status.state !== 'off'
  return (
    <section aria-label={t('Run on this computer')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Run on this computer')}</strong>
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'For demos and home use: the app runs in a Docker container here and gets a public address of its own, which reaches only the app. It is offline while this computer sleeps or Ramu is not running.',
        )}
      </p>
      {on && (
        <div className="flex flex-col gap-1 text-caption" role="status">
          <span>
            {status.state === 'building'
              ? t('Building the app…')
              : status.url
                ? t('Live at {0}', { 0: status.url })
                : status.state === 'failed'
                  ? t('It did not start.')
                  : t('Starting its tunnel…')}
          </span>
          {status.error && (
            <pre className="m-0 max-h-40 overflow-auto rounded-(--radius-s) bg-fill p-2 whitespace-pre-wrap">
              {status.error}
            </pre>
          )}
        </div>
      )}
      {on && status.mode === 'process' && (
        <p className="m-0 text-caption text-muted-foreground">{t('Running without Docker, with your permissions.')}</p>
      )}
      {withoutDocker && !on && (
        <p role="alert" className="m-0 text-caption">
          {t(
            'Without Docker, Ramu runs the app’s start script (a Node app) as a program on this computer. It has your own permissions: it can read your files and anything else you can. Run only code you trust.',
          )}
        </p>
      )}
      {error && <p className="m-0 text-caption text-bad">{error}</p>}
      <div className="flex gap-2">
        {on ? (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => void act(() => host.invoke('deploy.localStop', projectId))}
          >
            {t('Stop')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || !repoId}
            onClick={() => repoId && void act(() => host.invoke('deploy.localPublish', projectId, repoId))}
          >
            {busy ? t('Building the app…') : t('Publish from this computer')}
          </Button>
        )}
        {!on && (
          <Button
            variant={withoutDocker ? 'default' : 'ghost'}
            size="sm"
            disabled={busy || !repoId}
            onClick={() => {
              if (!withoutDocker) return setWithoutDocker(true)
              if (repoId)
                void act(async () => {
                  const next = await host.invoke('deploy.localPublish', projectId, repoId, 'process')
                  setWithoutDocker(false)
                  return next
                })
            }}
          >
            {withoutDocker ? t('Run without Docker') : t('Run without Docker…')}
          </Button>
        )}
        {withoutDocker && !on && (
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setWithoutDocker(false)}>
            {t('Cancel')}
          </Button>
        )}
      </div>
    </section>
  )
}
