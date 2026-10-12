import { t, useLanguage } from './i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { FolderOpen, LogIn, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from './Menu'
import { AGENT_PROVIDERS, providerName, supportsProviderAccounts, type ProviderStatus } from '../../shared/providers'
import type { AgentProvider, AppPreferences } from '../../shared/types'
import { ProviderIcon } from './ProviderIcon'
import { runProviderCommand } from './ProviderSetupTerminal'
import { ramu } from './ipc'

export function ProviderSettings({ value, onChange }: { value: AppPreferences; onChange: (value: AppPreferences) => void }) {
  useLanguage()
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [busy, setBusy] = useState(false), [updating, setUpdating] = useState<AgentProvider | null>(null)
  const [error, setError] = useState<string | null>(null), [adding, setAdding] = useState<AgentProvider | null>(null), [name, setName] = useState('')
  const sequence = useRef(0), config = value.providerBinaries
  const refresh = async (latest = false) => {
    const request = ++sequence.current
    setBusy(true); setError(null)
    try { const next = await ramu.invoke('providers.status', config, latest); if (request === sequence.current) setStatuses(next) }
    catch (reason) { if (request === sequence.current) setError(String(reason)) }
    finally { if (request === sequence.current) setBusy(false) }
  }
  useEffect(() => { const timer = setTimeout(() => void refresh(), 350); return () => { clearTimeout(timer); sequence.current++ } }, [config])
  const change = (provider: AgentProvider, patch: Partial<NonNullable<typeof config[AgentProvider]>>) => onChange({ ...value, providerBinaries: { ...config, [provider]: { binary: '', ...config[provider], ...patch } } })
  const browse = async (provider: AgentProvider, key: 'binary' | 'harness') => { try { const path = await ramu.invoke('providers.pickBinary'); if (path) change(provider, { [key]: path }) } catch (reason) { setError(String(reason)) } }
  const login = async (provider: AgentProvider) => {
    try { const command = await ramu.invoke('providers.loginCommand', provider, config); if (command) runProviderCommand(`${providerName(provider)} · ${t('Login')}`, command) }
    catch (reason) { setError(String(reason)) }
  }
  const update = async (provider: AgentProvider) => {
    setUpdating(provider); setError(null)
    try { await ramu.invoke('providers.update', provider); await refresh() }
    catch (reason) { setError(String(reason)) }
    finally { setUpdating(null) }
  }
  const add = (provider: AgentProvider) => {
    if (!name.trim()) return
    const id = crypto.randomUUID()
    change(provider, { accounts: [...(config[provider]?.accounts ?? []), { id, name: name.trim() }], accountId: id })
    setAdding(null); setName('')
  }
  return <div className="settings-form provider-settings">
    <div className="settings-row settings-toggle"><span><strong>{t('Check provider updates')}</strong><span className="muted block small">{t('Checks run in the background service, including while Ramu is closed.')}</span></span><Switch aria-label={t('Check provider updates')} checked={value.providerUpdateChecks} onCheckedChange={(checked) => onChange({ ...value, providerUpdateChecks: checked })} /></div>
    <div className="provider-settings-actions"><Button disabled={busy} onClick={() => void refresh(true)}><RefreshCw size={14} className={busy ? 'spin' : ''} />{busy ? t('Checking providers…') : t('Check for updates')}</Button></div>
    {error && <p className="error small" role="alert">{error}</p>}
    {AGENT_PROVIDERS.map((provider) => {
      const status = statuses.find((item) => item.provider === provider), preferences = config[provider]
      const accounts = supportsProviderAccounts(provider), canUpdate = provider !== 'antigravity' && !(provider === 'codex' && preferences?.binary?.trim())
      return <section className="provider-settings-card" key={provider} aria-label={t('{0} settings', { '0': providerName(provider) })}>
        <header><ProviderIcon provider={provider} size={22} /><strong>{providerName(provider)}</strong><span className="muted small">{status?.version ?? ''}</span><span className="grow" /><span className={`small ${status?.updateAvailable ? 'provider-update-label' : 'muted'}`}>{!status ? t('Detecting…') : !status.installed ? t('CLI not found') : status.updateAvailable ? t('Update available') : t('Ready')}</span></header>
        {accounts && <div className="provider-settings-actions"><Dropdown label={t('{0} account', { '0': providerName(provider) })} value={preferences?.accountId ?? 'default'} options={[{ value: 'default', label: t('Default CLI account') }, ...(preferences?.accounts ?? []).map((account) => ({ value: account.id, label: account.name }))]} onChange={(accountId) => change(provider, { accountId })} /><Button className="small" disabled={(preferences?.accounts?.length ?? 0) >= 20} onClick={() => { setAdding(provider); setName('') }}><Plus size={14} />{t('Add account')}</Button></div>}
        {adding === provider && <div className="provider-settings-actions"><Input aria-label={t('Account name')} placeholder={t('Account name')} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(provider) } }} /><Button disabled={!name.trim()} onClick={() => add(provider)}>{t('Add')}</Button><Button variant="ghost" onClick={() => setAdding(null)}>{t('Cancel')}</Button></div>}
        {accounts && <p className="muted small">{t('Save to use this account for new chats. Existing chats keep their original account. Login opens the selected account’s CLI flow.')}</p>}
        <div className="provider-settings-actions">{provider !== 'antigravity' && <Button disabled={!status?.installed} onClick={() => void login(provider)}><LogIn size={14} />{t('Login')}</Button>}{canUpdate ? <Button disabled={!status?.installed || updating !== null || status.updating} onClick={() => void update(provider)}><RefreshCw size={14} className={updating === provider ? 'spin' : ''} />{updating === provider ? t('Updating…') : t('Update CLI')}</Button> : <a href={status?.downloadUrl ?? status?.docsUrl} target="_blank" rel="noreferrer">{t('Provider website ↗')}</a>}</div>
        {canUpdate && <div className="settings-row settings-toggle"><span className="small">{t('Auto-update CLI')}<span className="muted block small">{t('Updates apply to new provider processes. Running chats stay connected.')}</span></span><Switch aria-label={t('Auto-update {0} CLI', { '0': providerName(provider) })} checked={preferences?.autoUpdate ?? false} onCheckedChange={(autoUpdate) => change(provider, { autoUpdate })} /></div>}
        {status?.latestVersion && status.updateAvailable && <p className="muted small">{t('Available version: {0}', { '0': status.latestVersion })}</p>}
        {[status?.versionError, status?.error, status?.updateError].filter(Boolean).map((message) => <p key={message} className="error small" role="alert">{message}</p>)}
        <Collapsible><CollapsibleTrigger render={<Button variant="ghost" className="small" />}>{t('Advanced')}</CollapsibleTrigger><CollapsibleContent>
          <label className="provider-binary-label" htmlFor={`provider-${provider}`}>{t('Binary path')}</label><div className="provider-binary-input"><Input id={`provider-${provider}`} placeholder={t('Automatic detection')} value={preferences?.binary ?? ''} onChange={(event) => change(provider, { binary: event.target.value })} /><Button className="icon" aria-label={t('Browse {0} binary', { '0': providerName(provider) })} onClick={() => void browse(provider, 'binary')}><FolderOpen size={16} /></Button></div>
          {status && <p className="muted small"><code>{status.binary}</code></p>}
          {provider === 'antigravity' && <><label htmlFor="provider-harness">{t('Harness helper path')}</label><div className="provider-binary-input"><Input id="provider-harness" value={preferences?.harness ?? ''} onChange={(event) => change(provider, { harness: event.target.value })} /><Button className="icon" aria-label={t('Browse Antigravity harness helper')} onClick={() => void browse(provider, 'harness')}><FolderOpen size={16} /></Button></div></>}
        </CollapsibleContent></Collapsible>
      </section>
    })}
  </div>
}
