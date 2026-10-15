import { SettingsField, useSettingsInvoke } from './SettingsScope'
import { ContentSkeleton } from '@/components/content-skeleton'
import { errorText } from './errors'
import { SettingsRow } from '@/components/settings-row'
import { Card } from '@/components/ui/card'
import { t, useLanguage } from './i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { useEffect, useRef, useState } from 'react'
import { FolderOpen, LogIn, Plus, RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dropdown } from './Menu'
import {
  AGENT_PROVIDERS,
  providerEnabled,
  providerName,
  supportsProviderAccounts,
  type ProviderStatus,
} from '@ramu/shared/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { ProviderIcon } from './ProviderIcon'
import { runProviderCommand } from './ProviderSetupTerminal'
import { ramu } from './ipc'
import { peakUsage, usageTone, useAccountUsage } from './Usage'

export function ProviderSettings({
  value,
  onChange,
}: {
  value: AppPreferences
  onChange: (value: AppPreferences) => void
}) {
  const invoke = useSettingsInvoke()
  useLanguage()
  const [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [busy, setBusy] = useState(true),
    [updating, setUpdating] = useState<AgentProvider | null>(null)
  const [signingIn, setSigningIn] = useState<AgentProvider | null>(null)
  const [error, setError] = useState<string | null>(null),
    [adding, setAdding] = useState<AgentProvider | null>(null),
    [name, setName] = useState('')
  const sequence = useRef(0),
    config = value.providerBinaries
  const accountUsage = useAccountUsage()
  const refresh = async (latest = false) => {
    const request = ++sequence.current
    setBusy(true)
    setError(null)
    try {
      const next = await invoke('providers.status', config, latest)
      if (request === sequence.current) setStatuses(next)
    } catch (reason) {
      if (request === sequence.current) setError(errorText(reason))
    } finally {
      if (request === sequence.current) setBusy(false)
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 350)
    return () => {
      clearTimeout(timer)
      sequence.current++
    }
  }, [config])
  const change = (provider: AgentProvider, patch: Partial<NonNullable<(typeof config)[AgentProvider]>>) =>
    onChange({ ...value, providerBinaries: { ...config, [provider]: { binary: '', ...config[provider], ...patch } } })
  const browse = async (provider: AgentProvider, key: 'binary' | 'harness') => {
    try {
      const path = await invoke('providers.pickBinary')
      if (path) change(provider, { [key]: path })
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  useEffect(() => {
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [config])
  const toggleAccount = (provider: AgentProvider, id: string, enabled: boolean) =>
    change(provider, {
      accounts: (config[provider]?.accounts ?? []).map((account) =>
        account.id === id ? { ...account, enabled } : account,
      ),
      ...(!enabled && config[provider]?.accountId === id ? { accountId: 'default' } : {}),
    })
  const login = async (provider: AgentProvider, accountId = config[provider]?.accountId || 'default') => {
    if (provider === 'antigravity') {
      // The runtime opens the browser itself; the call returns once Google sign-in completes.
      setSigningIn(provider)
      setError(null)
      try {
        await invoke('providers.signIn', provider, accountId)
        void refresh()
      } catch (reason) {
        setError(errorText(reason))
      } finally {
        setSigningIn(null)
      }
      return
    }
    const target =
      accountId === (config[provider]?.accountId || 'default')
        ? config
        : { ...config, [provider]: { binary: '', ...config[provider], accountId } }
    try {
      const command = await invoke('providers.loginCommand', provider, target)
      if (command) runProviderCommand(`${providerName(provider)} · ${t('Login')}`, command)
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const update = async (provider: AgentProvider) => {
    setUpdating(provider)
    setError(null)
    try {
      await invoke('providers.update', provider)
      await refresh()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setUpdating(null)
    }
  }
  const add = (provider: AgentProvider) => {
    if (!name.trim()) return
    const id = crypto.randomUUID()
    change(provider, { accounts: [...(config[provider]?.accounts ?? []), { id, name: name.trim() }], accountId: id })
    setAdding(null)
    setName('')
  }
  return (
    <div className="settings-form [&_p]:m-0 [&_p]:leading-[1.55] flex flex-col gap-3 provider-settings">
      <SettingsRow setting="providerUpdateChecks" className="settings-toggle [&:not(:has(+_.settings-row))]:mb-0">
        <span>
          <strong>{t('Check provider updates')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Checks run in the background service, including while Ramu is closed.')}
          </span>
        </span>
        <Switch
          aria-label={t('Check provider updates')}
          checked={value.providerUpdateChecks}
          onCheckedChange={(checked) => onChange({ ...value, providerUpdateChecks: checked })}
        />
      </SettingsRow>
      {busy && !statuses.length && <ContentSkeleton variant="cards" rows={2} label={t('Checking providers…')} />}
      <div className="provider-settings-actions flex items-center gap-2.5 flex-wrap">
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover"
          disabled={busy}
          onClick={() => void refresh(true)}
        >
          <RefreshCw size={14} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} />
          {busy ? t('Checking providers…') : t('Check for updates')}
        </Button>
      </div>
      {error && (
        <p className="error text-bad small text-caption" role="alert">
          {error}
        </p>
      )}
      {(busy && !statuses.length ? [] : AGENT_PROVIDERS).map((provider) => {
        const status = statuses.find((item) => item.provider === provider),
          preferences = config[provider]
        const enabled = status?.enabled ?? providerEnabled(config, provider),
          onCount = AGENT_PROVIDERS.filter((item) => providerEnabled(config, item)).length
        const accounts = supportsProviderAccounts(provider),
          canUpdate = !((provider === 'codex' || provider === 'antigravity') && preferences?.binary?.trim())
        return (
          <Card
            role="region"
            className={`gap-3 overflow-visible ring-0 text-body provider-settings-card ${enabled ? '' : 'opacity-60'} [&_header]:flex [&_header]:items-center [&_header]:gap-2.5 [border:1px_solid_transparent] rounded-(--radius-row) p-4 min-w-0 bg-fill`}
            key={provider}
            aria-label={t('{0} settings', { '0': providerName(provider) })}
          >
            <header>
              <ProviderIcon provider={provider} size={22} />
              <strong>{providerName(provider)}</strong>
              <span className="muted text-muted-foreground small text-caption">{status?.version ?? ''}</span>
              <span className="grow flex-1 min-w-0 text-left" />
              <span
                className={`small text-caption ${status?.updateAvailable ? 'provider-update-label text-brand' : 'muted text-muted-foreground'}`}
              >
                {!status
                  ? t('Detecting…')
                  : !status.installed
                    ? t('CLI not found')
                    : status.updateAvailable
                      ? t('Update available')
                      : t('Installed')}
              </span>
              <SettingsField path={`providerBinaries.${provider}.enabled`}>
                {' '}
                <Switch
                  aria-label={t('Turn {0} on or off', { '0': providerName(provider) })}
                  checked={enabled}
                  disabled={enabled && onCount <= 1}
                  onCheckedChange={(on) => change(provider, { enabled: on })}
                />{' '}
              </SettingsField>
            </header>
            {!enabled && (
              <p className="muted text-muted-foreground small text-caption">
                {t('Turned off: hidden from model pickers and never started.')}
              </p>
            )}
            {enabled && status?.installed && (
              <ul
                className="grid gap-1.5 m-0 p-0 list-none"
                aria-label={t('{0} logins', { '0': providerName(provider) })}
              >
                {[
                  { id: 'default', name: accounts ? t('Default CLI account') : t('CLI login'), enabled: true },
                  ...(accounts ? (preferences?.accounts ?? []) : []),
                ].map((row) => {
                  const state = status.signIn?.[row.id]
                  const peak = state?.signedIn
                    ? peakUsage(
                        accountUsage.filter((reading) => (reading.accountId ?? 'default') === row.id),
                        provider,
                      )
                    : undefined
                  return (
                    <li key={row.id} className="flex items-center gap-2.5 min-w-0">
                      <span className="grow flex-1 min-w-0 text-left truncate">
                        {row.name}
                        <span
                          className={`block small text-caption ${state?.signedIn ? 'text-brand' : 'muted text-muted-foreground'}`}
                        >
                          {!state
                            ? ''
                            : state.signedIn
                              ? `${t('Signed in')}${state.detail && provider !== 'opencode' ? ` · ${state.detail}` : ''}`
                              : t('Not signed in')}
                        </span>
                      </span>
                      {peak && (
                        <span
                          className={`flex-none tabular-nums small text-caption ${usageTone(peak) === 'bad' ? 'text-bad' : usageTone(peak) === 'warn' ? 'text-warn' : 'text-soft'}`}
                          title={t('Highest usage window for {0}', { '0': row.name })}
                        >
                          {peak.status === 'limited' ? t('Limited') : `${peak.usedPercent}%`}
                        </span>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        className="bg-fill hover:bg-fill-hover"
                        disabled={signingIn === provider}
                        onClick={() => void login(provider, row.id)}
                      >
                        <LogIn size={14} />
                        {signingIn === provider
                          ? t('Finish sign-in in your browser…')
                          : state?.signedIn
                            ? t('Switch login')
                            : t('Login')}
                      </Button>
                      {row.id !== 'default' && (
                        <SettingsField path={`providerBinaries.${provider}.accounts`}>
                          {' '}
                          <Switch
                            aria-label={t('Turn account {0} on or off', { '0': row.name })}
                            checked={row.enabled !== false}
                            onCheckedChange={(on) => toggleAccount(provider, row.id, on)}
                          />{' '}
                        </SettingsField>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {accounts && (
              <div className="provider-settings-actions flex items-center gap-2.5 flex-wrap">
                <SettingsField path={`providerBinaries.${provider}.accountId`}>
                  {' '}
                  <Dropdown
                    label={t('{0} account', { '0': providerName(provider) })}
                    value={preferences?.accountId ?? 'default'}
                    options={[
                      { value: 'default', label: t('Default CLI account') },
                      ...(preferences?.accounts ?? [])
                        .filter((account) => account.enabled !== false)
                        .map((account) => ({ value: account.id, label: account.name })),
                    ]}
                    onChange={(accountId) => change(provider, { accountId })}
                  />{' '}
                </SettingsField>
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-fill hover:bg-fill-hover small text-caption"
                  disabled={(preferences?.accounts?.length ?? 0) >= 20}
                  onClick={() => {
                    setAdding(provider)
                    setName('')
                  }}
                >
                  <Plus size={14} />
                  {t('Add account')}
                </Button>
              </div>
            )}
            {adding === provider && (
              <div className="provider-settings-actions flex items-center gap-2.5 flex-wrap">
                <Input
                  aria-label={t('Account name')}
                  placeholder={t('Account name')}
                  value={name}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      add(provider)
                    }
                  }}
                />
                <Button
                  variant="secondary"
                  className="bg-fill hover:bg-fill-hover"
                  disabled={!name.trim()}
                  onClick={() => add(provider)}
                >
                  {t('Add')}
                </Button>
                <Button variant="ghost" onClick={() => setAdding(null)}>
                  {t('Cancel')}
                </Button>
              </div>
            )}
            {accounts && (
              <SettingsRow setting={`providerBinaries.${provider}.rotateAccounts`} className="settings-toggle">
                <span className="small text-caption">
                  {t('Use all accounts')}
                  <span className="muted text-muted-foreground block block small text-caption">
                    {t(
                      'When the account a chat is using reaches its limit, continue on the next enabled account before switching models. Order: the selected account, the default login, then the others.',
                    )}
                  </span>
                </span>
                <Switch
                  aria-label={t('Use all {0} accounts', { '0': providerName(provider) })}
                  checked={preferences?.rotateAccounts ?? false}
                  disabled={(preferences?.accounts?.filter((account) => account.enabled !== false).length ?? 0) < 1}
                  onCheckedChange={(rotateAccounts) => change(provider, { rotateAccounts })}
                />
              </SettingsRow>
            )}
            {accounts && (
              <p className="muted text-muted-foreground small text-caption">
                {t('New chats use this account after saving. Existing chats keep their original account.')}
              </p>
            )}
            <div className="provider-settings-actions flex items-center gap-2.5 flex-wrap">
              {canUpdate ? (
                <Button
                  variant="secondary"
                  className="bg-fill hover:bg-fill-hover"
                  disabled={(!status?.installed && provider !== 'antigravity') || updating !== null || status?.updating}
                  onClick={() => void update(provider)}
                >
                  <RefreshCw
                    size={14}
                    className={updating === provider ? 'spin [animation:spin_0.9s_linear_infinite]' : ''}
                  />
                  {provider === 'antigravity'
                    ? updating === provider
                      ? t(status?.installed ? 'Updating…' : 'Installing…')
                      : t(status?.installed ? 'Update runtime' : 'Install runtime')
                    : updating === provider
                      ? t('Updating…')
                      : t('Update CLI')}
                </Button>
              ) : (
                <a href={status?.downloadUrl ?? status?.docsUrl} target="_blank" rel="noreferrer">
                  {t('Provider website ↗')}
                </a>
              )}
            </div>
            {provider === 'cursor' && (
              <SettingsRow setting={`providerBinaries.${provider}.usageKeychain`} className="settings-toggle">
                <span className="small text-caption">
                  {t('Show plan usage')}
                  <span className="muted text-muted-foreground block small text-caption">
                    {t(
                      'Reads your Cursor login from the macOS Keychain to show monthly usage. macOS asks for permission.',
                    )}
                  </span>
                </span>
                <Switch
                  aria-label={t('Show Cursor plan usage')}
                  checked={preferences?.usageKeychain ?? false}
                  onCheckedChange={(usageKeychain) => change(provider, { usageKeychain })}
                />
              </SettingsRow>
            )}
            {canUpdate && (
              <SettingsRow
                setting={`providerBinaries.${provider}.autoUpdate`}
                className="settings-toggle [&:not(:has(+_.settings-row))]:mb-0"
              >
                <span className="small text-caption">
                  {t('Auto-update CLI')}
                  <span className="muted text-muted-foreground block block small text-caption">
                    {t('Updates apply to new provider processes. Running chats stay connected.')}
                  </span>
                </span>
                <Switch
                  aria-label={t('Auto-update {0} CLI', { '0': providerName(provider) })}
                  checked={preferences?.autoUpdate ?? false}
                  onCheckedChange={(autoUpdate) => change(provider, { autoUpdate })}
                />
              </SettingsRow>
            )}
            {status?.latestVersion && status.updateAvailable && (
              <p className="muted text-muted-foreground small text-caption">
                {t('Available version: {0}', { '0': status.latestVersion })}
              </p>
            )}
            {[status?.versionError, status?.error, status?.updateError].filter(Boolean).map((message) => (
              <p key={message} className="error text-bad small text-caption" role="alert">
                {message}
              </p>
            ))}
            <Collapsible>
              <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="small text-caption" />}>
                {t('Advanced')}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <label
                  className="provider-binary-label block text-caption m-[12px_0_6px]"
                  htmlFor={`provider-${provider}`}
                >
                  {t('Binary path')}
                </label>
                <div className="provider-binary-input">
                  <SettingsField path={`providerBinaries.${provider}.binary`}>
                    {' '}
                    <Input
                      id={`provider-${provider}`}
                      maxLength={4096}
                      placeholder={t('Automatic detection')}
                      value={preferences?.binary ?? ''}
                      onChange={(event) => change(provider, { binary: event.target.value })}
                    />{' '}
                  </SettingsField>
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center"
                    aria-label={t('Browse {0} binary', { '0': providerName(provider) })}
                    onClick={() => void browse(provider, 'binary')}
                  >
                    <FolderOpen size={16} />
                  </Button>
                </div>
                {status && (
                  <p className="muted text-muted-foreground small text-caption">
                    <code>{status.binary}</code>
                  </p>
                )}
                {provider === 'antigravity' && (
                  <>
                    <label htmlFor="provider-harness">{t('Harness helper path')}</label>
                    <div className="provider-binary-input">
                      <SettingsField path={`providerBinaries.${provider}.harness`}>
                        {' '}
                        <Input
                          id="provider-harness"
                          value={preferences?.harness ?? ''}
                          onChange={(event) => change(provider, { harness: event.target.value })}
                        />{' '}
                      </SettingsField>
                      <Button
                        variant="secondary"
                        size="icon-sm"
                        className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center"
                        aria-label={t('Browse Antigravity harness helper')}
                        onClick={() => void browse(provider, 'harness')}
                      >
                        <FolderOpen size={16} />
                      </Button>
                    </div>
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
          </Card>
        )
      })}
    </div>
  )
}
