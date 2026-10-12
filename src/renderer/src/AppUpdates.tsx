import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { AppUpdateStatus } from '../../shared/updates'
import type { AppPreferences, BackgroundStatus } from '../../shared/types'
import { ramu } from './ipc'
import { t, useLanguage } from './i18n'

export function AppUpdates({ value, onChange }: { value: AppPreferences; onChange: (value: AppPreferences) => void }) {
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null), [service, setService] = useState<BackgroundStatus | null>(null)
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => {
    void ramu.invoke('updates.status').then(setState, (reason) => setError(String(reason)))
    void ramu.invoke('background.status').then(setService, () => {})
    return ramu.on('updates:changed', setState)
  }, [])
  const act = async (method: 'updates.check' | 'updates.download' | 'updates.restart' | 'background.restart') => {
    setBusy(true); setError(null)
    try { const result = await ramu.invoke(method); if (result && 'phase' in result) setState(result) }
    catch (reason) { setError(String(reason)) }
    finally { setBusy(false) }
  }
  const working = busy || state?.phase === 'checking' || state?.phase === 'downloading'
  return <div className="settings-form">
    <div className="settings-row"><span><strong>{t('Ramu')} {state?.currentVersion}</strong><span className="muted block small">{t('Updates come from published GitHub releases.')}</span></span><Button disabled={working} onClick={() => void act('updates.check')}><RefreshCw size={14} className={state?.phase === 'checking' ? 'spin' : ''} />{t('Check for updates')}</Button></div>
    <div className="settings-row settings-toggle"><span><strong>{t('Check app updates')}</strong><span className="muted block small">{t('The background service checks while Ramu is closed.')}</span></span><Switch aria-label={t('Check app updates')} checked={value.appUpdateChecks} onCheckedChange={(appUpdateChecks) => onChange({ ...value, appUpdateChecks })} /></div>
    <div className="settings-row settings-toggle"><span><strong>{t('Auto-update Ramu')}</strong><span className="muted block small">{t('Download updates automatically. You choose when to restart; the background service and running chats stay connected.')}</span></span><Switch aria-label={t('Auto-update Ramu')} checked={value.appAutoUpdate} onCheckedChange={(appAutoUpdate) => onChange({ ...value, appAutoUpdate })} /></div>
    {state?.release && <div className="settings-row"><span><strong>{t('Ramu {0}', { '0': state.release.version })}</strong><span className="muted block small">{state.phase === 'downloading' ? t('Downloading… {0} MB', { '0': Math.round(state.downloadedBytes / 1_000_000) }) : state.phase === 'ready' ? t('Downloaded') : t('Update available')}</span><a className="small" href={state.release.notesUrl} target="_blank" rel="noreferrer">{t('Release notes ↗')}</a></span>{state.phase === 'ready' ? state.supported ? <Button disabled={!state.nativeReady || working} onClick={() => void act('updates.restart')}>{state.nativeReady ? t('Restart app') : t('Preparing update…')}</Button> : <a href={state.release.assetUrl} target="_blank" rel="noreferrer">{t('Download installer ↗')}</a> : <Button disabled={working} onClick={() => void act('updates.download')}><Download size={14} />{t('Download update')}</Button>}</div>}
    {!state?.release && state?.checkedAt && <p className="muted small">{t('No newer release is available for this platform.')}</p>}
    {state?.supported === false && <p className="muted small">{t('Automatic installation is available in signed macOS builds. Other builds can check and download releases for manual installation.')}</p>}
    <div className="settings-row"><span><strong>{t('Background service')}</strong><span className="muted block small">{service?.version ?? '—'} · {service?.build ?? '—'}</span><span className="muted block small">{service?.updateAvailable ? t('A newer service is bundled with this app. Restart the app and service to use it; running agents will stop and unfinished chats will recover.') : t('Matches the installed app. App-only restarts keep chats running.')}</span></span>{service?.updateAvailable && <Button disabled={working} onClick={() => void act('background.restart')}>{t('Restart app & service')}</Button>}</div>
    {(error || state?.error) && <p className="error small" role="alert">{error ?? state?.error}</p>}
  </div>
}

/** A downloaded update never takes over a session without a restart choice. */
export function AppUpdateNotice() {
  useLanguage()
  const [state, setState] = useState<AppUpdateStatus | null>(null), [deferred, setDeferred] = useState(''), [error, setError] = useState<string | null>(null)
  useEffect(() => { void ramu.invoke('updates.status').then(setState, () => {}); return ramu.on('updates:changed', setState) }, [])
  if (!state?.nativeReady || !state.release || deferred === state.release.version) return null
  return <div className="app-update-notice" role="status"><span>{t('Ramu {0} is ready. Restart when you’re ready; chats stay running.', { '0': state.release.version })}</span><Button className="small" onClick={() => void ramu.invoke('updates.restart').catch((reason) => setError(String(reason)))}>{t('Restart app')}</Button><Button variant="ghost" className="small" onClick={() => setDeferred(state.release!.version)}>{t('Later')}</Button>{error && <span className="error small">{error}</span>}</div>
}
