import { useSettingsInvoke } from './SettingsScope'
import { errorText } from '../lib/errors'
import { SettingsRow } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import {
  AGENT_PROVIDERS,
  providerAccountRows,
  providerEnabled,
  providerName,
  type ProviderStatus,
} from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
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
  const [error, setError] = useState<string | null>(null)

  const sequence = useRef(0),
    config = value.providerBinaries
  const accountUsage = useAccountUsage()
  // Background refreshes (config edits, focus) update statuses in place; only the button shows progress.
  const refresh = async (latest = false, quiet = false) => {
    const request = ++sequence.current
    if (!quiet) setBusy(true)
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
    const timer = setTimeout(() => void refresh(false, true), 350)
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
    const onFocus = () => void refresh(false, true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [config])
  /** The top enabled login is the one new threads use. */
  const arrange = (
    provider: AgentProvider,
    order: string[],
    accounts = config[provider]?.accounts ?? [],
    defaultOn = config[provider]?.defaultAccountEnabled !== false,
  ) =>
    change(provider, {
      accounts,
      accountOrder: order,
      defaultAccountEnabled: defaultOn ? undefined : false,
      accountId:
        order.find((id) => (id === 'default' ? defaultOn : accounts.some((a) => a.id === id && a.enabled !== false))) ??
        'default',
    })
  const toggleAccount = (provider: AgentProvider, id: string, enabled: boolean) =>
    arrange(
      provider,
      providerAccountRows(config, provider),
      (config[provider]?.accounts ?? []).map((account) => (account.id === id ? { ...account, enabled } : account)),
      id === 'default' ? enabled : undefined,
    )
  const remove = (provider: AgentProvider, id: string) =>
    arrange(
      provider,
      providerAccountRows(config, provider).filter((item) => item !== id),
      (config[provider]?.accounts ?? []).filter((account) => account.id !== id),
    )
  const rename = (provider: AgentProvider, id: string, name: string) =>
    change(provider, {
      accounts: (config[provider]?.accounts ?? []).map((account) => {
        if (account.id !== id) return account
        const { name: _old, ...rest } = account
        return name ? { ...rest, name } : rest
      }),
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
    const id = crypto.randomUUID()
    arrange(provider, [...providerAccountRows(config, provider), id], [...(config[provider]?.accounts ?? []), { id }])
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
      {AGENT_PROVIDERS.map((provider) => {
        const status = statuses.find((item) => item.provider === provider),
          preferences = config[provider]
        // The draft decides, so the switch answers instantly; the status only catches up after the next check.
        const enabled = providerEnabled(config, provider),
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
            onChange={(patch) => change(provider, patch)}
            onLogin={(accountId) => void login(provider, accountId)}
            onToggleAccount={(id, on) => toggleAccount(provider, id, on)}
            onReorder={(order) => arrange(provider, order)}
            onRename={(id, label) => rename(provider, id, label)}
            onRemove={(id) => remove(provider, id)}
            onAddAccount={() => add(provider)}
            onUpdate={() => void update(provider)}
            onBrowse={(key) => void browse(provider, key)}
          />
        )
      })}
    </div>
  )
}
