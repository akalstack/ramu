import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useStaging } from './stagedChanges'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { errorText } from '../lib/errors'
import { SettingsRow } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ownHostId } from '../hosts'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { AGENT_PROVIDERS, providerAccountRows, providerEnabled, providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { useAccountUsage } from './Usage'
import { ProviderCard } from './ProviderCard'
import { ProviderModels } from './ProviderModels'
import { useModelSets } from '../models/ModelSets'
import { providerStatusQuery } from './providerStatusQuery'
import { AntigravitySignIn } from './AntigravitySignIn'
import { ApiKeySignIn } from './ApiKeySignIn'
import { supportsApiKey } from '@ramu/shared/providers/apiKeys'
import { antigravityKeyName } from '@ramu/shared/providers/environment'

export function ProviderSettings({
  value,
  onChange,
  onOpenSection,
}: {
  value: AppPreferences
  onChange: (value: AppPreferences) => void
  /** Opens another Settings page, used by Update Ramu. */
  onOpenSection?: (section: 'system') => void
}) {
  const invoke = useSettingsInvoke()
  const on = useSettingsEvents()
  useLanguage()
  const { catalogs } = useModelSets()
  const scope = useContext(SettingsScopeContext)
  const queryClient = useQueryClient()
  const [updating, setUpdating] = useState<AgentProvider | null>(null)
  const [signingIn, setSigningIn] = useState<AgentProvider | null>(null)
  // Antigravity offers several sign-in methods; the account being signed in and the key names the host keeps.
  const [antigravity, setAntigravity] = useState<{ accountId: string; keys: string[] } | null>(null)
  const [apiKey, setApiKey] = useState<{ provider: AgentProvider; accountId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const sequence = useRef(0),
    config = value.providerBinaries
  const host = scope?.primaryId || ownHostId()
  const viewOnly = !!scope?.targets.find((target) => target.id === host)?.viewOnly
  const access = useRef({ host, viewOnly })
  access.current = { host, viewOnly }
  const allowed = () => access.current.host === host && !access.current.viewOnly
  const status = (...args: Parameters<import('@ramu/shared/api').RamuMethods['providers.status']>) =>
    invoke('providers.status', ...args)
  const statusQuery = useQuery({ ...providerStatusQuery(host, config, status), enabled: false })
  const statuses = statusQuery.data ?? []
  const busy = !viewOnly && (statusQuery.isFetching || (!statusQuery.data && !statusQuery.isError))
  const ready = !viewOnly && (!scope || (scope.ready && !scope.stale))
  const mcp = useQuery({ queryKey: ['mcp-accounts', host], queryFn: () => invoke('mcp.status'), enabled: ready })
  const canShare = mcp.data?.canAdminister === true
  const refetchMcp = mcp.refetch
  /** Account consent to reuse approved Shared MCP connections; absent until someone saves it. */
  const sharing = (provider: AgentProvider, id: string) =>
    mcp.data?.accounts.find((entry) => entry.provider === provider && entry.accountId === id)?.shareApprovals
  const { valueOf, stage } = useStaging()
  const setSharing = async (provider: AgentProvider, ids: string[], shareApprovals: boolean) => {
    setError(null)
    try {
      // One at a time: each save updates the same host policy.
      for (const accountId of ids)
        if (sharing(provider, accountId) !== shareApprovals)
          await invoke('mcp.account', { provider, accountId, shareApprovals })
      await refetchMcp()
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const readiness = (provider: AgentProvider, id: string) =>
    mcp.data?.readiness?.find((entry) => entry.provider === provider && entry.accountId === id)
  const [rechecking, setRechecking] = useState<string | null>(null)
  const recheck = async (provider: AgentProvider, id: string) => {
    setError(null)
    setRechecking(`${provider}:${id}`)
    try {
      await invoke('mcp.recheckAccount', provider, id, null)
      await refetchMcp()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setRechecking(null)
    }
  }
  const loginPending = useRef(false)
  const accountUsage = useAccountUsage()
  // Cache entries are host/configuration scoped, so reopening never shows another host’s logins.
  const refresh = async (latest = false, quiet = false) => {
    if (!allowed()) return
    const request = ++sequence.current
    setError(null)
    try {
      // Reopening and focus reuse fresh data; explicit actions always ask the host again.
      const fresh = !quiet || loginPending.current
      loginPending.current = false
      await queryClient.fetchQuery(providerStatusQuery(host, config, status, latest, fresh))
    } catch (reason) {
      if (request === sequence.current) setError(errorText(reason))
    }
  }
  useEffect(() => {
    if (viewOnly) return
    const timer = setTimeout(() => void refresh(false, true), 350)
    return () => {
      clearTimeout(timer)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      sequence.current++
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [config, invoke, viewOnly] by design; the values it reads beyond these are current as of that run
  }, [config, invoke, viewOnly])
  const change = (provider: AgentProvider, patch: Partial<NonNullable<(typeof config)[AgentProvider]>>) =>
    allowed() &&
    onChange({ ...value, providerBinaries: { ...config, [provider]: { binary: '', ...config[provider], ...patch } } })
  const browse = async (provider: AgentProvider, key: 'binary' | 'harness') => {
    try {
      const path = await invoke('providers.pickBinary')
      if (path) change(provider, { [key]: path })
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  // A login signed in from another device or a terminal shows its new account here without a manual refresh.
  useEffect(() => {
    if (viewOnly) return
    return on('logins:changed', () => void refresh(false, false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [config, invoke, viewOnly] by design; the values it reads beyond these are current as of that run
  }, [config, invoke, viewOnly, on])
  useEffect(() => {
    if (viewOnly) return
    const onFocus = () => void refresh(false, true)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [config, invoke, viewOnly] by design; the values it reads beyond these are current as of that run
  }, [config, invoke, viewOnly])
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
  const remove = (provider: AgentProvider, id: string) => {
    if (canShare)
      void invoke('mcp.removeAccount', provider, id).then(
        () => refetchMcp(),
        () => {},
      )
    arrange(
      provider,
      providerAccountRows(config, provider).filter((item) => item !== id),
      (config[provider]?.accounts ?? []).filter((account) => account.id !== id),
    )
  }
  const rename = (provider: AgentProvider, id: string, name: string) =>
    change(provider, {
      accounts: (config[provider]?.accounts ?? []).map((account) => {
        if (account.id !== id) return account
        const { name: _old, ...rest } = account
        return name ? { ...rest, name } : rest
      }),
    })
  const login = async (provider: AgentProvider, accountId = config[provider]?.accountId || 'default') => {
    if (!allowed()) return
    const target =
      accountId === (config[provider]?.accountId || 'default')
        ? config
        : { ...config, [provider]: { binary: '', ...config[provider], accountId } }
    setError(null)
    try {
      const command = await invoke('providers.loginCommand', provider, target)
      if (!allowed()) return
      if (command) {
        loginPending.current = true
        runProviderCommand(`${providerName(provider)} · ${t('Login')}`, command)
        return
      }
      if (provider === 'antigravity') {
        const environment = await Promise.resolve(invoke('providers.environment')).catch(() => null)
        if (allowed()) setAntigravity({ accountId, keys: environment?.keys.antigravity ?? [] })
        return
      }
      // Cursor signs in inside Ramu: the browser opens, and the call returns once sign-in completes.
      setSigningIn(provider)
      try {
        await invoke('providers.signIn', provider, accountId)
        void refresh()
      } finally {
        setSigningIn(null)
      }
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
    // A backup account starts out sharing approved MCP connections; it stays editable in its row.
    if (canShare) void setSharing(provider, [id], true)
  }
  return (
    <div className="settings-form [&_p]:m-0 [&_p]:leading-[1.55] flex flex-col gap-3 provider-settings">
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <fieldset disabled={viewOnly} className="contents">
        <SettingsRow setting="providerUpdateChecks" className="settings-toggle [&:not(:has(+_.settings-row))]:mb-0">
          <span>
            <strong>{t('Check provider updates')}</strong>
            <span className="muted text-muted-foreground block small text-caption">
              {t('Runs in the background, even while Ramu is closed.')}
            </span>
          </span>
          <span className="flex flex-none items-center gap-2.5">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void refresh(true)}>
              <RefreshCw size={14} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} />
              {busy ? t('Checking providers…') : t('Check now')}
            </Button>
            <Switch
              aria-label={t('Check provider updates')}
              checked={value.providerUpdateChecks}
              onCheckedChange={(checked) => {
                if (allowed()) onChange({ ...value, providerUpdateChecks: checked })
              }}
            />
          </span>
        </SettingsRow>
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
              onApiKey={
                canShare && supportsApiKey(provider)
                  ? (accountId, name) => {
                      if (allowed()) setApiKey({ provider, accountId, name })
                    }
                  : undefined
              }
              onToggleAccount={(id, on) => toggleAccount(provider, id, on)}
              onReorder={(order) => arrange(provider, order)}
              onRename={(id, label) => rename(provider, id, label)}
              onRemove={(id) => remove(provider, id)}
              onAddAccount={() => add(provider)}
              mcpSharing={
                canShare ? (id) => valueOf(`mcp-sharing:${provider}:${id}`, sharing(provider, id)) : undefined
              }
              onMcpSharing={(ids, on) => {
                for (const id of ids)
                  stage(`mcp-sharing:${provider}:${id}`, on, sharing(provider, id), (value) =>
                    setSharing(provider, [id], !!value),
                  )
              }}
              mcpReadiness={canShare ? (id) => readiness(provider, id) : undefined}
              mcpRechecking={(id) => rechecking === `${provider}:${id}`}
              onMcpRecheck={canShare ? (id) => void recheck(provider, id) : undefined}
              onUpdate={() => void update(provider)}
              stale={statusQuery.isError && !!statusQuery.data}
              onCheckAgain={() => void refresh()}
              onUpdateRamu={onOpenSection ? () => onOpenSection('system') : undefined}
              onBrowse={(key) => void browse(provider, key)}
              models={
                <ProviderModels
                  provider={provider}
                  models={catalogs.find((catalog) => catalog.provider === provider)?.models ?? []}
                  listed={value.visibleModels?.[provider]}
                  onChange={(listed) => {
                    if (!allowed()) return
                    const { [provider]: _previous, ...others } = value.visibleModels ?? {}
                    onChange({ ...value, visibleModels: listed ? { ...others, [provider]: listed } : others })
                  }}
                />
              }
            />
          )
        })}
      </fieldset>
      {apiKey && (
        <ApiKeySignIn
          provider={apiKey.provider}
          account={apiKey.name}
          saved={!!statuses.find((item) => item.provider === apiKey.provider)?.signIn?.[apiKey.accountId]?.apiKey}
          onClose={() => setApiKey(null)}
          onSubmit={async (variable, key) => {
            await invoke('providers.setApiKey', apiKey.provider, apiKey.accountId, variable, key)
            void refresh()
          }}
        />
      )}
      {antigravity && (
        <AntigravitySignIn
          hasKey={(method) => antigravity.keys.includes(antigravityKeyName(method))}
          onClose={() => setAntigravity(null)}
          onSubmit={async (input) => {
            setSigningIn('antigravity')
            try {
              await invoke('providers.signIn', 'antigravity', antigravity.accountId, input)
              void refresh()
            } finally {
              setSigningIn(null)
            }
          }}
        />
      )}
    </div>
  )
}
