import { t, useLanguage, formatLocale } from './i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { Check, Copy, FolderOpen, RefreshCw, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { AGENT_PROVIDERS, providerName, type ProviderStatus } from '../../shared/providers'
import type { AgentProvider, AppPreferences } from '../../shared/types'
import { ProviderIcon } from './ProviderIcon'
import { runProviderCommand } from './ProviderSetupTerminal'
import { ramu } from './ipc'

export function ProviderSettings({ value, onChange }: { value: AppPreferences; onChange: (value: AppPreferences) => void }) {
  useLanguage()
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const sequence = useRef(0)
  const config = value.providerBinaries
  const refresh = async (latest = false) => {
    const request = ++sequence.current
    setBusy(true); setError(null)
    try { const next = await ramu.invoke('providers.status', config, latest); if (request === sequence.current) setStatuses(next) }
    catch (reason) { if (request === sequence.current) setError(String(reason)) }
    finally { if (request === sequence.current) setBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => void refresh(), 350); return () => { clearTimeout(timer); sequence.current++ } }, [config])
  const update = (provider: AgentProvider, key: 'binary' | 'harness', path: string) => onChange({ ...value, providerBinaries: { ...config, [provider]: { binary: config[provider]?.binary ?? '', ...config[provider], [key]: path } } })
  const browse = async (provider: AgentProvider, key: 'binary' | 'harness') => { try { const path = await ramu.invoke('providers.pickBinary'); if (path) update(provider, key, path) } catch (reason) { setError(String(reason)) } }
  const copy = async (command: string) => { try { await ramu.invoke('clipboard.write', command); setCopied(command); setTimeout(() => setCopied((current) => current === command ? null : current), 2000) } catch (reason) { setError(String(reason)) } }
  const command = (provider: AgentProvider, title: string, text: string | null) => text && <div className="provider-command"><span className="muted small">{title}</span><code>{text}</code><Button className="ghost icon small-icon" aria-label={t("Copy {0} command", { "0": title.toLowerCase() })} onClick={() => void copy(text)}>{copied === text ? <Check size={14} /> : <Copy size={14} />}</Button><Button className="small" aria-label={t("Run {0} {1} in terminal", { "0": providerName(provider), "1": title.toLowerCase() })} onClick={() => runProviderCommand(`${providerName(provider)} · ${title}`, text)}><SquareTerminal size={14} />{t("Run in terminal")}</Button></div>
  return <div className="settings-form provider-settings">
    <div className="settings-row settings-toggle"><span><strong>{t("Provider update notifications")}</strong><span className="muted block small">{t("Check daily and show an in-app notice when an installed provider has a newer version.")}</span></span><Switch aria-label={t("Provider update notifications")} checked={value.providerUpdateChecks} onCheckedChange={(checked) => onChange({ ...value, providerUpdateChecks: checked })} /></div>
    <div className="provider-settings-actions"><Button disabled={busy} onClick={() => void refresh()}><RefreshCw size={14} className={busy ? 'spin' : ''} />{t("Refresh installed")}</Button><Button disabled={busy} onClick={() => void refresh(true)}>{t("Check latest versions")}</Button>{busy && <span className="muted small" role="status">{t("Checking providers…")}</span>}</div>
    {error && <p className="error small" role="alert">{error}</p>}
    {AGENT_PROVIDERS.map((provider) => {
      const status = statuses.find((item) => item.provider === provider)
      return <section className="provider-settings-card" key={provider} aria-label={t("{0} settings", { "0": providerName(provider) })}>
        <header><ProviderIcon provider={provider} size={22} /><strong>{providerName(provider)}</strong><span className="grow" /><span className={`small ${status?.updateAvailable ? 'provider-update-label' : 'muted'}`}>{!status ? t("Detecting…") : !status.installed ? t("Not installed") : status.updateAvailable ? t("Update available") : t("Installed")}</span></header>
        <label className="provider-binary-label" htmlFor={`provider-${provider}`}>{t("Binary path")}</label><div className="provider-binary-input"><Input id={`provider-${provider}`} placeholder={t("Automatic detection")} value={config[provider]?.binary ?? ''} onChange={(event) => update(provider, 'binary', event.target.value)} /><Button className="icon" aria-label={t("Browse {0} binary", { "0": providerName(provider) })} onClick={() => void browse(provider, 'binary')}><FolderOpen size={16} /></Button></div>
        {status && <div className="muted small provider-detected">{status.installed ? t("Using") : t("Looking for")} <code>{status.binary}</code></div>}
        {provider === 'antigravity' && <><label className="provider-binary-label" htmlFor="provider-harness">{t("Harness helper path")}</label><div className="provider-binary-input"><Input id="provider-harness" placeholder={t("Detect localharness_external beside the runtime")} value={config.antigravity?.harness ?? ''} onChange={(event) => update(provider, 'harness', event.target.value)} /><Button className="icon" aria-label={t("Browse Antigravity harness helper")} onClick={() => void browse(provider, 'harness')}><FolderOpen size={16} /></Button></div></>}
        {status && <><div className="provider-versions small"><span>{t("Installed ")}<strong>{status.version ?? (status.installed ? t("Unknown") : '—')}</strong></span><span>{t("Latest ")}<strong>{status.latestVersion ?? t("Not checked")}</strong></span>{status.checkedAt && <span className="muted">{t("Checked ")}{new Date(status.checkedAt).toLocaleString(formatLocale())}</span>}</div>
          {status.versionError && <p className="error small">{status.versionError}</p>}{status.error && <p className="error small" role="alert">{status.error}</p>}
          <Collapsible className="provider-setup" defaultOpen={!status.installed || status.updateAvailable}><CollapsibleTrigger render={<Button variant="ghost" />}>{status.updateAvailable ? t("Update & setup") : t("Install & setup")}</CollapsibleTrigger><CollapsibleContent><p className="muted small">{status.setupNote}</p>{command(provider, status.installed ? 'Update' : 'Install', status.installed ? status.updateCommand : status.installCommand)}{command(provider, 'Sign in / configure', status.setupCommand)}<div className="provider-setup-links"><a href={status.docsUrl} target="_blank" rel="noreferrer">{t("Open setup guide ↗")}</a>{status.downloadUrl && <a href={status.downloadUrl} target="_blank" rel="noreferrer">{t("Download ACP runtime ↗")}</a>}{provider === 'antigravity' && !status.downloadUrl && <Button className="small" disabled={busy} onClick={() => void refresh(true)}>{t("Find runtime download")}</Button>}</div><p className="muted small">{t("After setup finishes, refresh installed providers. Save changes to apply binary paths to new sessions.")}</p></CollapsibleContent></Collapsible>
        </>}
      </section>
    })}
  </div>
}
