import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { LINK_TARGET_KEY, linkTargetFrom } from '@ramu/shared/browserLinks'
import type { AgentBrowserPreferences, LinkTarget } from '@ramu/shared/browser'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { deviceStorage } from '../deviceStorage'
import { Dropdown } from '../Menu'
import { SearchEnginePicker } from '../views/searchEngine'
import { t, useLanguage } from '../i18n'
import type { DraftProps } from './ToggleRow'
import type { AgentProvider } from '@ramu/shared/types'
import { SettingsScopeContext } from './SettingsScope'
import { ownHostId } from '../hosts'
import { ramu, invokeOn, bridge } from '../ipc'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import type { BrowserProfileCatalog } from '@ramu/shared/types/browser'
import { BrowserProfilesSettings } from './BrowserProfiles'
import { HostBrowserSettings } from './HostBrowserSettings'

/** Settings → Browser. Where clicked links open is a choice of this device; it follows the person across hosts. */
export function BrowserSettings({ draft, onChange, busy }: DraftProps) {
  useLanguage()
  const [target, setTarget] = useState<LinkTarget>(() => linkTargetFrom(deviceStorage.getItem(LINK_TARGET_KEY)))
  useEffect(
    () =>
      deviceStorage.subscribe(
        (key) => key === LINK_TARGET_KEY && setTarget(linkTargetFrom(deviceStorage.getItem(LINK_TARGET_KEY))),
      ),
    [],
  )
  const scope = useContext(SettingsScopeContext)
  const selectedHost = scope?.primaryId ?? ownHostId()
  const viewOnly = !!scope?.targets.find((target) => target.id === selectedHost)?.viewOnly
  const access = useRef({ host: selectedHost, viewOnly })
  access.current = { host: selectedHost, viewOnly }
  const changeHost: typeof onChange = (next) => {
    if (access.current.host === selectedHost && !access.current.viewOnly) onChange(next)
  }
  const bulkHosts = scope?.target === 'all' && scope.targets.length > 1
  const [providerStatus, setProviderStatus] = useState<ProviderStatus[]>([])
  useEffect(() => {
    let active = true
    setProviderStatus([])
    if (!bulkHosts && !viewOnly)
      void invokeOn(selectedHost, 'providers.status', undefined, false, false)
        .then((status) => {
          if (active) setProviderStatus(status)
        })
        .catch(() => {})
    return () => {
      active = false
    }
  }, [selectedHost, bulkHosts, viewOnly])
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [profiles, setProfiles] = useState<{ host: string; catalog: BrowserProfileCatalog } | null>(null)
  const [hosted, setHosted] = useState(false)
  const profileGeneration = useRef(0)
  const refreshProfiles = useCallback(async () => {
    const mine = ++profileGeneration.current
    if (access.current.host !== selectedHost) return
    try {
      const hostStatus =
        viewOnly || access.current.viewOnly
          ? null
          : await invokeOn(selectedHost, 'hostBrowser.status').catch(() => null)
      if (mine !== profileGeneration.current) return
      setHosted(!access.current.viewOnly && !!hostStatus?.enabled)
      const catalog =
        !access.current.viewOnly && hostStatus?.enabled
          ? await invokeOn(selectedHost, 'hostBrowser.profiles')
          : await ramu.invoke('browser.profiles.list', selectedHost)
      if (mine === profileGeneration.current) setProfiles({ host: selectedHost, catalog })
    } catch {
      if (mine === profileGeneration.current)
        setProfiles({
          host: selectedHost,
          catalog: {
            profiles: [],
            error: 'Could not read browser profiles. Refresh or update the desktop on the owning computer.',
          },
        })
    }
  }, [selectedHost, viewOnly])
  useEffect(() => {
    setProfiles(null)
    void refreshProfiles()
    const off = ramu.on('browser:changed', () => {
      void refreshProfiles()
    })
    const offHost = bridge.on('hostBrowser:changed', (_payload, from) => {
      if (from === selectedHost || (!from && selectedHost === ownHostId())) void refreshProfiles()
    })
    return () => {
      profileGeneration.current += 1
      off()
      offHost()
    }
  }, [refreshProfiles])
  const catalog = profiles?.host === selectedHost ? profiles.catalog : null
  const [readiness, setReadiness] = useState<{ available: boolean; reason?: string; warning?: string } | null>(null)
  useEffect(() => {
    let active = true,
      revision = 0
    setReadiness(null)
    if (viewOnly) {
      setReadiness({ available: false, reason: VIEW_ONLY_WRITE_NOTICE })
      return
    }
    const read = async () => {
      const mine = ++revision
      try {
        const hostStatus = await invokeOn(selectedHost, 'hostBrowser.status').catch(() => null)
        if (access.current.host !== selectedHost || access.current.viewOnly) return
        const next = hostStatus?.enabled ? hostStatus : await ramu.invoke('browser.runtimeStatus', selectedHost)
        if (active && mine === revision) setReadiness(next)
      } catch {
        if (active && mine === revision)
          setReadiness({ available: false, reason: 'Update Ramu on this desktop to use integrated browser tools.' })
      }
    }
    void read()
    const off = ramu.on('browser:changed', () => {
      void read()
    })
    return () => {
      active = false
      off()
    }
  }, [selectedHost, viewOnly])
  const browser: AgentBrowserPreferences = draft.agentBrowser ?? {
    agentBrowser: 'integrated' as const,
    providerOverrides: {},
    defaultProfileId: 'default',
  }
  const profileOptions = (
    catalog?.profiles.filter((entry) => !bulkHosts || entry.builtin) ?? [
      { id: 'default', name: 'Default', builtin: true },
      { id: 'temporary', name: 'Temporary', builtin: true },
    ]
  ).map((profile) => ({ value: profile.id, label: profile.builtin ? t(profile.name) : profile.name, disabled: false }))
  if (!profileOptions.some((profile) => profile.value === browser.defaultProfileId))
    profileOptions.push({
      value: browser.defaultProfileId,
      label: t('Unavailable profile ({0})', { 0: browser.defaultProfileId }),
      disabled: true,
    })
  const providers: [AgentProvider, string][] = [
    ['claude-code', 'Claude Code'],
    ['codex', 'Codex'],
    ['opencode', 'OpenCode'],
    ['cursor', 'Cursor'],
    ['antigravity', 'Antigravity'],
  ]
  return (
    <div className="settings-form flex flex-col gap-0">
      <fieldset disabled={viewOnly} className="contents">
        <SettingsGroupTitle>{t('Agent browser')}</SettingsGroupTitle>
        <p role="status" className="m-[0_0_12px] text-caption text-muted-foreground">
          {readiness
            ? readiness.available
              ? t('Integrated browser ready on this computer')
              : t(readiness.reason ?? 'Integrated browser unavailable')
            : t('Checking browser availability…')}
        </p>
        {readiness?.warning && (
          <p role="alert" className="m-[0_0_12px] text-caption text-bad">
            {t(readiness.warning)}
          </p>
        )}
        <SettingsRow setting="agentBrowser.agentBrowser">
          <SettingsLabel
            title={t('Agent browser')}
            help={t(
              'Applies on the selected execution host. Keep Ramu desktop open there. Helpers and other access modes require browser-only approval. Changes apply on the next provider launch.',
            )}
          />
          <Dropdown
            label={t('Agent browser')}
            value={browser.agentBrowser}
            disabled={busy}
            options={[
              { value: 'provider', label: t('Provider browser setup') },
              { value: 'integrated', label: t('Ramu integrated browser') },
            ]}
            onChange={(value) =>
              changeHost({
                ...draft,
                agentBrowser: { ...browser, agentBrowser: value === 'integrated' ? 'integrated' : 'provider' },
              })
            }
          />
        </SettingsRow>
        <SettingsRow setting="agentBrowser.defaultProfileId">
          <SettingsLabel
            title={t('Default integrated profile')}
            help={t(
              'Default shares website sign-ins on this desktop. Temporary keeps this run separate and is cleared when the run ends.',
            )}
          />
          <Dropdown
            label={t('Default integrated profile')}
            value={browser.defaultProfileId}
            disabled={busy}
            options={profileOptions}
            onChange={(value) => changeHost({ ...draft, agentBrowser: { ...browser, defaultProfileId: value } })}
          />
        </SettingsRow>
        {providers.map(([provider, name]) => (
          <SettingsRow key={provider} setting={`agentBrowser.providerOverrides.${provider}`}>
            <SettingsLabel
              title={name}
              help={t(
                (browser.providerOverrides[provider] ?? browser.agentBrowser) === 'provider'
                  ? 'Uses this provider’s external setup; Ramu cannot inspect its browser sessions.'
                  : providerStatus.find((entry) => entry.provider === provider)?.browser?.integratedTools === false
                    ? 'This provider cannot use the integrated browser. Open Provider setup to update it.'
                    : !readiness?.available
                      ? 'Needs the integrated browser on this execution host. Runtime setup is shown above.'
                      : 'Integrated tools use this host’s desktop. Provider-native tools may remain available; MCP support is checked when the runtime connects.',
              )}
            />
            <Dropdown
              label={name}
              keepOptions
              value={browser.providerOverrides[provider] ?? 'default'}
              disabled={busy}
              options={[
                { value: 'default', label: t('Use default') },
                { value: 'provider', label: t('Provider browser setup') },
                {
                  value: 'integrated',
                  label: t('Ramu integrated browser'),
                  disabled:
                    providerStatus.find((entry) => entry.provider === provider)?.browser?.integratedTools === false,
                },
              ]}
              onChange={(value) => {
                const overrides = { ...browser.providerOverrides }
                if (value === 'default') delete overrides[provider]
                else overrides[provider] = value === 'integrated' ? 'integrated' : 'provider'
                changeHost({ ...draft, agentBrowser: { ...browser, providerOverrides: overrides } })
              }}
            />
          </SettingsRow>
        ))}
        <p className="m-[0_0_20px] text-caption text-muted-foreground">
          {t(
            'Use this provider’s existing browser tools and sessions. Ramu cannot show or import them here. Provider tools may remain available when the integrated browser is selected.',
          )}
        </p>
      </fieldset>
      {bulkHosts ? (
        <p className="m-[0_0_20px] text-caption text-muted-foreground">
          {t('Choose one host to manage browser profiles. Named profiles belong to their owning computer.')}
        </p>
      ) : !hosted ? (
        <BrowserProfilesSettings
          hostId={selectedHost}
          catalog={catalog}
          refresh={refreshProfiles}
          onRemoved={(id) => {
            const current = draftRef.current
            if (current.agentBrowser?.defaultProfileId === id)
              changeHost({ ...current, agentBrowser: { ...current.agentBrowser, defaultProfileId: 'default' } })
          }}
        />
      ) : null}
      {!bulkHosts && (
        <HostBrowserSettings
          key={selectedHost}
          readOnly={viewOnly}
          hostId={selectedHost}
          refreshed={refreshProfiles}
          onRemoved={(id) => {
            const current = draftRef.current
            if (current.agentBrowser?.defaultProfileId === id)
              changeHost({ ...current, agentBrowser: { ...current.agentBrowser, defaultProfileId: 'default' } })
          }}
        />
      )}
      <SettingsGroupTitle>{t('Links & viewing')}</SettingsGroupTitle>

      <SettingsRow>
        <SettingsLabel
          title={t('Open clicked links in')}
          help={t(
            'Applies to this device only. Links always open in your own browser when no thread is open. Right-click is not changed.',
          )}
        />
        <Dropdown
          label={t('Open clicked links in')}
          value={target}
          options={[
            { value: 'system', label: t('System browser') },
            { value: 'integrated', label: t('Ramu browser (in the thread)') },
          ]}
          onChange={(value) => deviceStorage.setItem(LINK_TARGET_KEY, linkTargetFrom(value))}
        />
      </SettingsRow>
      <SettingsRow>
        <SettingsLabel
          title={t('Search engine')}
          help={t(
            'Applies to this device only. The address box searches with it when you type words instead of an address.',
          )}
        />
        <SearchEnginePicker label={t('Search engine')} />
      </SettingsRow>
      <p className="m-[0_0_8px] text-caption text-muted-foreground">
        {t('The Ramu browser keeps its own sign-ins, separate from your system browser and from your threads.')}
      </p>
    </div>
  )
}
