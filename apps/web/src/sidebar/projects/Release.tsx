import { useCallback, useEffect, useState } from 'react'
import { DEPLOYMENT_STATE } from '@ramu/shared/deployText'
import { blockingChecks, STORE_PERSON_STEPS, storeCheckText } from '@ramu/shared/storeRelease'
import type { StoreBuild, StoreRelease, StoreTarget } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const open = (url: string) => void openOnThisComputer('app.openExternal', url)

const TARGETS: { id: StoreTarget; label: string }[] = [
  { id: 'all', label: 'iOS and Android' },
  { id: 'ios', label: 'iOS' },
  { id: 'android', label: 'Android' },
]

const CHECK_MARK = { ok: '✓', warning: '!', missing: '✗' } as const

/**
 * The Deploy sheet's store releases for an Expo app: what the stores need, what only the person can do there, and
 * Release, which builds on EAS and uploads to TestFlight and Play's internal track. Pressing Release and confirming is
 * the person's approval; submitting for review stays on the stores.
 */
export function ReleaseSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<StoreRelease | null>(null)
  const [target, setTarget] = useState<StoreTarget>('all')
  const [confirming, setConfirming] = useState(false)
  const [steps, setSteps] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [proposed, setProposed] = useState<string | null>(null)
  const [logs, setLogs] = useState<{ key: string; text: string } | null>(null)
  const load = useCallback(() => {
    void host.invoke('deploy.release', projectId).then(setStatus, (reason) => setError(errorText(reason)))
  }, [host, projectId])
  useEffect(load, [load])
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!status?.app) return null
  const blocking = blockingChecks(status.checks, target)
  const canRelease = status.connected && !!status.app.projectId && !blocking.length
  const showLog = (build: StoreBuild, of: 'build' | 'submission') => {
    const key = `${build.id}:${of}`
    if (logs?.key === key) return setLogs(null)
    void run(async () => setLogs({ key, text: await host.invoke('deploy.releaseLogs', projectId, build.id, of) }))
  }
  return (
    <section aria-label={t('Store releases')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong className="flex items-center gap-2">
        <BrandIcon brand="expo" />
        <span className="flex-1">{t('Store releases')}</span>
        {status.app.page && (
          <Button size="sm" variant="ghost" onClick={() => open(status.app!.page!)}>
            {t('Open on Expo')}
          </Button>
        )}
      </strong>
      <p className="m-0 text-caption text-muted-foreground">
        {status.connected
          ? t(
              'Release builds {0} on EAS with your Expo account {1}, then uploads iOS to TestFlight and Android to Play’s internal testing track. Submitting for review is your step on each store.',
              { 0: status.app.name, 1: status.account ?? '' },
            )
          : t('Connect Expo in Settings → Hosting accounts to build and upload the app.')}
      </p>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption" aria-label={t('What the stores need')}>
        {status.checks.map((check) => (
          <li
            key={check.id}
            className={
              check.state === 'missing'
                ? 'text-destructive'
                : check.state === 'warning'
                  ? 'text-foreground'
                  : 'text-muted-foreground'
            }
          >
            <span aria-hidden="true">{CHECK_MARK[check.state]} </span>
            {storeCheckText(t, check)}
            {check.id === 'eas-json' && check.state === 'missing' && !check.detail && !proposed && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const { url } = await host.invoke('deploy.proposeEasJson', projectId)
                    setProposed(url ?? '')
                  })
                }
              >
                {t('Add eas.json in a pull request')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {proposed !== null && (
        <p role="status" className="m-0 flex items-center gap-2 text-caption">
          {t('The pull request adding eas.json is open. Merge it, then release.')}
          {proposed && (
            <Button size="sm" variant="ghost" onClick={() => open(proposed)}>
              {t('Open')}
            </Button>
          )}
        </p>
      )}
      <span>
        <Button size="sm" variant="ghost" aria-expanded={steps} onClick={() => setSteps((shown) => !shown)}>
          {t('What only you can do on the stores')}
        </Button>
      </span>
      {steps && (
        <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-caption text-muted-foreground">
          {STORE_PERSON_STEPS.map((step) => (
            <li key={step}>{t(step)}</li>
          ))}
        </ol>
      )}
      <div role="radiogroup" aria-label={t('Platforms')} className="flex flex-wrap gap-0.5">
        {TARGETS.map((entry) => (
          <RowButton
            key={entry.id}
            role="radio"
            aria-checked={target === entry.id}
            aria-pressed={target === entry.id}
            onClick={() => {
              setTarget(entry.id)
              setConfirming(false)
            }}
          >
            {t(entry.label)}
          </RowButton>
        ))}
      </div>
      {confirming && (
        <p role="status" className="m-0 text-caption">
          {t(
            'This builds the default branch on EAS and uploads it for testers. Nothing is submitted for review, and the project’s latest thread hears how each build and upload finished.',
          )}
        </p>
      )}
      <span className="flex gap-2">
        <Button
          size="sm"
          variant={confirming ? 'default' : 'secondary'}
          disabled={busy || !canRelease}
          onClick={() => {
            if (!confirming) return setConfirming(true)
            void run(async () => {
              await host.invoke('deploy.startRelease', projectId, target)
              setConfirming(false)
              load()
            })
          }}
        >
          {busy && confirming ? t('Working…') : confirming ? t('Release now') : t('Release')}
        </Button>
        {confirming && (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
            {t('Cancel')}
          </Button>
        )}
      </span>
      {status.error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {status.error}
        </p>
      )}
      {error && (
        <p role="alert" className="m-0 text-caption whitespace-pre-wrap text-destructive">
          {error}
        </p>
      )}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label={t('Latest store builds')}>
        {status.builds.map((build) => (
          <li key={build.id} className="flex flex-col gap-1 text-caption">
            <span className="flex items-center gap-2">
              <BrandIcon brand={build.platform === 'ios' ? 'appstore' : 'googleplay'} />
              <strong>{t(DEPLOYMENT_STATE[build.state])}</strong>
              <span className="text-muted-foreground">
                {[
                  build.platform === 'ios' ? 'iOS' : 'Android',
                  build.version && build.buildNumber ? `${build.version} (${build.buildNumber})` : build.version,
                  new Date(build.createdAt).toLocaleString(),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </span>
            {build.message && <span className="truncate">{build.message}</span>}
            {build.error && <span className="text-destructive">{build.error}</span>}
            {build.submission && (
              <span className={build.submission.state === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>
                {t('Upload to {0}: {1}', {
                  0:
                    build.platform === 'ios'
                      ? 'TestFlight'
                      : t('Play’s {0} track', { 0: build.submission.track ?? 'internal' }),
                  1: t(DEPLOYMENT_STATE[build.submission.state]),
                })}
                {build.submission.error ? ` · ${build.submission.error}` : ''}
              </span>
            )}
            <span className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" onClick={() => open(build.page)}>
                {t('Open')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={logs?.key === `${build.id}:build`}
                onClick={() => showLog(build, 'build')}
              >
                {t('Logs')}
              </Button>
              {build.submission && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-expanded={logs?.key === `${build.id}:submission`}
                  onClick={() => showLog(build, 'submission')}
                >
                  {t('Upload log')}
                </Button>
              )}
            </span>
            {logs?.key.startsWith(`${build.id}:`) && (
              <pre className="m-0 max-h-48 overflow-auto rounded-(--radius-s) bg-fill p-2 text-caption whitespace-pre-wrap">
                {logs.text || t('No log yet.')}
              </pre>
            )}
          </li>
        ))}
        {!status.builds.length && status.connected && status.app.projectId && !status.error && (
          <li className="text-caption text-muted-foreground">{t('No store builds yet.')}</li>
        )}
      </ul>
    </section>
  )
}
