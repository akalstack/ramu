import { useSettingsInvoke } from './SettingsScope'
import { ContentSkeleton } from '@/components/content-skeleton'
import { errorText } from '../lib/errors'
import { SettingsRow } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { AGENT_PROVIDERS, providerEnabled, providerName, type ProviderStatus } from '@ramu/shared/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { ramu } from '../ipc'
import { useAccountUsage } from './Usage'
import { ProviderCard } from './ProviderCard'

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
        return (
          <ProviderCard
            key={provider}
            provider={provider}
            status={status}
            preferences={preferences}
            enabled={enabled}
            lastEnabled={onCount <= 1}
            accountUsage={accountUsage}
            signingIn={signingIn === provider}
            updating={updating}
            adding={adding === provider}
            accountName={name}
            onChange={(patch) => change(provider, patch)}
            onLogin={(accountId) => void login(provider, accountId)}
            onToggleAccount={(id, on) => toggleAccount(provider, id, on)}
            onStartAdd={() => {
              setAdding(provider)
              setName('')
            }}
            onCancelAdd={() => setAdding(null)}
            onAccountName={setName}
            onAddAccount={() => add(provider)}
            onUpdate={() => void update(provider)}
            onBrowse={(key) => void browse(provider, key)}
          />
        )
      })}
    </div>
  )
}
