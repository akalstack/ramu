import { useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { SettingsRow, SettingsTitle } from '@/components/settings-row'
import { errorText } from '../lib/errors'
import { useEffect, useState } from 'react'
import { Clock, Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { APP_AUTO_UPDATE, hoursUntil, serviceReportsOlderVersion, type AppUpdateStatus } from '@ramu/shared/updates'
import type { AppPreferences, BackgroundStatus } from '@ramu/shared/types'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { t, useLanguage } from '../i18n'

export function AppUpdates({ value, onChange }: { value: AppPreferences; onChange: (value: AppPreferences) => void }) {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null),
    [service, setService] = useState<BackgroundStatus | null>(null)
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void invoke('updates.status').then(setState, (reason) => setError(errorText(reason)))
    void invoke('background.status').then(setService, () => {})
    const off = on('updates:changed', setState)
    const timer = setInterval(() => {
      void invoke('updates.status').then(setState, () => {})
    }, 2000)
    return () => {
      off()
      clearInterval(timer)
    }
  }, [invoke, on])
  const act = async (
    method: 'updates.check' | 'updates.skipWait' | 'updates.download' | 'updates.restart' | 'background.restart',
  ) => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke(method)
      if (result && 'phase' in result) setState(result)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const working = busy || state?.phase === 'checking' || state?.phase === 'downloading'
  // Installing a release out less than a day asks once more, on the same button.
  const [confirmNow, setConfirmNow] = useState(false)
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      <SettingsRow className="">
        <span>
          <strong>
            {t('Ramu')} {state?.currentVersion}
          </strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Updates come from published GitHub releases.')}
          </span>
        </span>
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          disabled={working}
          onClick={() => void act('updates.check')}
        >
          <RefreshCw
            size={14}
            className={state?.phase === 'checking' ? 'spin [animation:spin_0.9s_linear_infinite]' : ''}
          />
          {t('Check for updates')}
        </Button>
      </SettingsRow>
      <SettingsRow setting="appUpdateChecks" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Check app updates')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('The background service checks while Ramu is closed.')}
          </span>
        </span>
        <Switch
          aria-label={t('Check app updates')}
          checked={value.appUpdateChecks}
          onCheckedChange={(appUpdateChecks) => onChange({ ...value, appUpdateChecks })}
        />
      </SettingsRow>
      <SettingsRow setting="updateWait" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Wait a day before offering updates')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t(
              'New provider CLI and Ramu releases are offered once they have been out 24 hours, so a bad release is usually pulled before it reaches you. You can still install one now.',
            )}
          </span>
        </span>
        <Switch
          aria-label={t('Wait a day before offering updates')}
          checked={value.updateWait}
          onCheckedChange={(updateWait) => onChange({ ...value, updateWait })}
        />
      </SettingsRow>
      {state?.waiting && (
        <SettingsRow>
          <span className="flex min-w-0 items-start gap-2">
            <Clock size={14} className="mt-1 flex-none text-muted-foreground" aria-hidden="true" />
            <span>
              <strong>{t('{0} is waiting', { '0': `Ramu ${state.waiting.version}` })}</strong>
              <span className="muted text-muted-foreground block small text-caption">
                {t('Out less than a day; offered in {0}h. A bad release is usually pulled by then.', {
                  '0': hoursUntil(state.waiting.settlesAt),
                })}
              </span>
              <a className="small text-caption" href={state.waiting.notesUrl} target="_blank" rel="noreferrer">
                {t('Release notes ↗')}
              </a>
            </span>
          </span>
          <Button
            variant={confirmNow ? 'destructive' : 'ghost'}
            disabled={working}
            onBlur={() => setConfirmNow(false)}
            onClick={() => {
              if (!confirmNow) return setConfirmNow(true)
              setConfirmNow(false)
              void act('updates.skipWait')
            }}
          >
            {confirmNow ? t('Install it anyway') : t('Update now')}
          </Button>
        </SettingsRow>
      )}
      {APP_AUTO_UPDATE && (
        <SettingsRow setting="appAutoUpdate" className="settings-toggle">
          <span>
            <SettingsTitle>{t('Auto-update Ramu')}</SettingsTitle>
            <span className="muted text-muted-foreground block block small text-caption">
              {t('Download updates automatically, then restart when ready. Threads keep running.')}
            </span>
          </span>
          <Switch
            aria-label={t('Auto-update Ramu')}
            checked={value.appAutoUpdate}
            onCheckedChange={(appAutoUpdate) => onChange({ ...value, appAutoUpdate })}
          />
        </SettingsRow>
      )}
      {state?.release && (
        <SettingsRow className="">
          <span>
            <strong>{t('Ramu {0}', { '0': state.release.version })}</strong>
            <span className="muted text-muted-foreground block block small text-caption">
              {state.phase === 'downloading'
                ? t('Downloading… {0} MB', { '0': Math.round(state.downloadedBytes / 1_000_000) })
                : state.phase === 'ready'
                  ? t('Downloaded')
                  : t('Update available')}
            </span>
            <a className="small text-caption" href={state.release.notesUrl} target="_blank" rel="noreferrer">
              {t('Release notes ↗')}
            </a>
          </span>
          {!APP_AUTO_UPDATE ? (
            <a href={state.release.notesUrl} target="_blank" rel="noreferrer">
              {t('Download installer ↗')}
            </a>
          ) : state.phase === 'ready' ? (
            state.supported ? (
              <Button
                variant="secondary"
                className="bg-fill hover:bg-fill-hover"
                disabled={!state.nativeReady || working}
                onClick={() => void act('updates.restart')}
              >
                {state.nativeReady ? t('Restart app') : t('Preparing update…')}
              </Button>
            ) : (
              <a href={state.release.assetUrl} target="_blank" rel="noreferrer">
                {t('Download installer ↗')}
              </a>
            )
          ) : (
            <Button
              variant="secondary"
              className="bg-fill hover:bg-fill-hover"
              disabled={working}
              onClick={() => void act('updates.download')}
            >
              <Download size={14} />
              {t('Download update')}
            </Button>
          )}
        </SettingsRow>
      )}
      {!state?.release && !state?.waiting && state?.checkedAt && (
        <p className="muted text-muted-foreground small text-caption">
          {t('No newer release is available for this platform.')}
        </p>
      )}
      {(!APP_AUTO_UPDATE || state?.supported === false) && (
        <p className="muted text-muted-foreground small text-caption">
          {t('Automatic install needs a signed macOS app. Other builds install manually.')}
        </p>
      )}
      <SettingsRow className="">
        <span>
          <strong>{t('Service version')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {service?.version ?? '—'} · {service?.build ?? '—'}
          </span>
          <span className="muted text-muted-foreground block block small text-caption">
            {service?.updateAvailable
              ? t(
                  'Service update available. Restart app & service to apply it. Agents stop, and unfinished threads resume.',
                )
              : serviceReportsOlderVersion(service)
                ? t(
                    'Runs the same code as the installed app. It shows the older version until the service next restarts.',
                  )
                : t('Matches the installed app. App-only restarts keep threads running.')}
          </span>
        </span>
        {service?.updateAvailable && (
          <Button
            variant="secondary"
            className="bg-fill hover:bg-fill-hover"
            disabled={working}
            onClick={() => void act('background.restart')}
          >
            {t('Restart app & service')}
          </Button>
        )}
      </SettingsRow>
      {(error || state?.error) && (
        <p className="error text-bad small text-caption" role="alert">
          {error ?? state?.error}
        </p>
      )}
    </div>
  )
}

/** One status-bar button for a newer release: Update downloads it, Restart applies it; threads keep running. */
export function AppUpdateButton() {
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    void ramu.invoke('updates.status').then(setState, () => {})
    return ramu.on('updates:changed', setState)
  }, [])
  const release = state?.release
  if (!release) return null
  const run = async (method: 'updates.download' | 'updates.restart') => {
    setBusy(true)
    try {
      const result = await ramu.invoke(method)
      if (result && 'phase' in result) setState(result)
    } catch (reason) {
      notifyError(errorText(reason), 'Ramu')
    } finally {
      setBusy(false)
    }
  }
  const className = 'app-update-button h-[22px] min-h-[22px] gap-[5px] p-[0_6px] text-caption text-soft'
  if (!APP_AUTO_UPDATE || state.supported === false)
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        nativeButton={false}
        render={
          <a href={release.notesUrl} target="_blank" rel="noreferrer" title={t('Ramu {0}', { '0': release.version })} />
        }
      >
        <Download size={13} />
        {t('Update')}
      </Button>
    )
  if (state.phase === 'ready')
    return (
      <Button
        variant="ghost"
        size="sm"
        className={className}
        disabled={!state.nativeReady || busy}
        title={t('Ramu {0} is ready. Restart when it suits you. Threads keep running.', { '0': release.version })}
        onClick={() => void run('updates.restart')}
      >
        <RefreshCw size={13} />
        {state.nativeReady ? t('Restart to update') : t('Preparing update…')}
      </Button>
    )
  const downloading = busy || state.phase === 'downloading'
  return (
    <Button
      variant="ghost"
      size="sm"
      className={className}
      disabled={downloading}
      title={t('Ramu {0}', { '0': release.version })}
      onClick={() => void run('updates.download')}
    >
      <Download size={13} />
      {downloading ? t('Downloading…') : t('Update')}
    </Button>
  )
}
