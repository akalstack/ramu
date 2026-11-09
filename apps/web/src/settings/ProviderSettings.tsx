import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useStaging } from './stagedChanges'
import { SettingsScopeContext, useSettingsEvents, useSettingsInvoke } from './SettingsScope'
import { errorText } from '../lib/errors'
import { SettingsRow, SettingsTitle } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { useContext, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ownHostId } from '../hosts'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { AGENT_PROVIDERS, providerAccountRows, providerEnabled, providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { useAccountUsage } from './Usage'
import { accountKey } from '@ramu/shared/identities'
import { useAccountIdentities } from './AccountIdentity'
import { ProviderCard } from './ProviderCard'
import { ProviderModels } from './ProviderModels'
import { useModelSets } from '../models/ModelSets'
import {
  NO_STATUSES,
  applyStatuses,
  changedProviders,
  providerStatusQuery,
  type KnownStatuses,
} from './providerStatusQuery'
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

  const config = value.providerBinaries
  const host = scope?.primaryId || ownHostId()
  const viewOnly = !!scope?.targets.find((target) => target.id === host)?.viewOnly
  const access = useRef({ host, viewOnly })
  access.current = { host, viewOnly }
  const allowed = () => access.current.host === host && !access.current.viewOnly
  const status = (...args: Parameters<import('@ramu/shared/api').RamuMethods['providers.status']>) =>
    invoke('providers.status', ...args)
  // What is known about each provider stays on screen while it is checked again; "Detecting…" shows only before the
  // first answer. Seeded from this host's latest cached answer, so reopening Settings shows it at once.
  const lastCached = (forHost: string): KnownStatuses => {
    const [latest] = queryClient
      .getQueryCache()
      .findAll({ queryKey: ['provider-settings', forHost] })
      .filter((query) => Array.isArray(query.state.data))
      .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt)
    return latest ? applyStatuses(NO_STATUSES, latest.state.data as ProviderStatus[], 0) : NO_STATUSES
  }
  const [known, setKnown] = useState(() => ({ host, value: lastCached(host) }))
  const shown = known.host === host ? known.value : lastCached(host)
  const statuses = shown.statuses
  const stamp = useRef(0)
  const [fullChecks, setFullChecks] = useState(0)
  const [checking, setChecking] = useState<ReadonlySet<AgentProvider>>(new Set())
  const [stale, setStale] = useState(false)
  const busy = !viewOnly && (fullChecks > 0 || (!statuses.length && !stale))
  const take = (forHost: string, answer: ProviderStatus[], mine: number) =>
    setKnown((current) => ({
      host: forHost,
      value: applyStatuses(current.host === forHost ? current.value : lastCached(forHost), answer, mine),
    }))
  // The merged result is this draft's answer too, so focusing the window or reopening Settings reuses it.
  useEffect(() => {
    if (known.value.statuses.length)
      queryClient.setQueryData(providerStatusQuery(known.host, config, status).queryKey, known.value.statuses)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- written when the known statuses change; the draft it is filed under is read as of then
  }, [known])
  const ready = !viewOnly && (!scope || (scope.ready && !scope.stale))
  const mcp = useQuery({ queryKey: ['mcp-accounts', host], queryFn: () => invoke('mcp.status'), enabled: ready })
  const canShare = mcp.data?.canAdminister === true
  const refetchMcp = mcp.refetch
  /** Account consent to reuse approved Shared MCP connections; absent until someone saves it. */
  const sharing = (provider: AgentProvider, id: string) =>
    mcp.data?.accounts.find((entry) => entry.provider === provider && entry.accountId === id)?.shareApprovals
  const { valueOf, stage } = useStaging()
  const accountIdentities = useAccountIdentities()
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
  // The provider whose sign-in runs in a terminal or browser, checked alone when the window comes back.
  const loginPending = useRef<AgentProvider | null>(null)
  const accountUsage = useAccountUsage()
  /**
   * Asks the host again: every provider, or only those named in `only` (the one an action touched). Cache entries are
   * host and draft scoped, so reopening never shows another host's logins; answers apply per provider by request
   * order, so a slower, older check never overwrites a newer one.
   */
  const refresh = async (latest = false, quiet = false, only?: AgentProvider[]) => {
    if (!allowed()) return
    const mine = ++stamp.current
    const forHost = host
    const current = () => access.current.host === forHost
    setError(null)
    const failed = (reason: unknown) => {
      if (!current()) return
      setError(errorText(reason))
      setStale(true)
    }
    if (only?.length && !latest) {
      setChecking((names) => new Set([...names, ...only]))
      try {
        const answers = await Promise.all(only.map((provider) => invoke('providers.statusOf', provider, config)))
        if (current()) {
          take(forHost, answers, mine)
          setStale(false)
        }
      } catch (reason) {
        failed(reason)
      } finally {
        setChecking((names) => new Set([...names].filter((name) => !only.includes(name))))
      }
      return
    }
    setFullChecks((count) => count + 1)
    try {
      // Reopening and focus reuse fresh data; explicit actions always ask the host again.
      const answer = await queryClient.fetchQuery(providerStatusQuery(host, config, status, latest, !quiet))
      if (current()) {
        take(forHost, answer, mine)
        setStale(false)
      }
    } catch (reason) {
      failed(reason)
    } finally {
      setFullChecks((count) => count - 1)
    }
  }
  // The draft last checked, so an edit re-checks only the providers it changed.
  const checked = useRef<{ host: string; config: typeof config } | null>(null)
  useEffect(() => {
    if (viewOnly) return
    const timer = setTimeout(() => {
      const before = checked.current
      checked.current = { host, config }
      const only = before && before.host === host && statuses.length ? changedProviders(before.config, config) : null
      if (only && !only.length) return
      void refresh(false, true, only ?? undefined)
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [config, invoke, viewOnly] by design; the values it reads beyond these are current as of that run
  }, [config, invoke, viewOnly])
  /** After a sign-in elsewhere: only the provider being signed in when one is, otherwise every provider. */
  const recheckLogin = (quiet: boolean) => {
    const provider = loginPending.current
    loginPending.current = null
    void refresh(false, quiet && !provider, provider ? [provider] : undefined)
  }
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
    return on('logins:changed', () => recheckLogin(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [config, invoke, viewOnly] by design; the values it reads beyond these are current as of that run
  }, [config, invoke, viewOnly, on])
  useEffect(() => {
    if (viewOnly) return
    const onFocus = () => recheckLogin(true)
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
    // A removed login leaves its identity too, so nothing refers to it after Save changes.
    accountIdentities.setOwner(accountKey('provider', provider, id), '')
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
        loginPending.current = provider
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
        void refresh(false, false, [provider])
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
      await refresh(false, false, [provider])
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setUpdating(null)
    }
  }
  const add = (provider: AgentProvider, identityId: string) => {
    const id = crypto.randomUUID()
    arrange(provider, [...providerAccountRows(config, provider), id], [...(config[provider]?.accounts ?? []), { id }])
    // Its identity is saved with the login itself, on Save changes.
    if (identityId) accountIdentities.setOwner(accountKey('provider', provider, id), identityId)
    // A backup account starts out sharing approved MCP connections; it stays editable in its row.
    if (canShare) void setSharing(provider, [id], true)
  }
  return (
    <div className="settings-form [&_p]:m-0 [&_p]:leading-[1.55] flex flex-col gap-3 provider-settings">
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <fieldset disabled={viewOnly} className="contents">
        <SettingsRow setting="providerUpdateChecks" className="settings-toggle [&:not(:has(+_.settings-row))]:mb-0">
          <span>
            <SettingsTitle>{t('Check provider updates')}</SettingsTitle>
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
              onAddAccount={(identityId) => add(provider, identityId)}
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
              stale={stale && !!status}
              checking={checking.has(provider)}
              onCheckAgain={() => void refresh(false, false, [provider])}
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
            void refresh(false, false, [apiKey.provider])
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
              void refresh(false, false, ['antigravity'])
            } finally {
              setSigningIn(null)
            }
          }}
        />
      )}
    </div>
  )
}
