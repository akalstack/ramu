import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import {
  AGENT_BROWSER_VISIBILITY_KEY,
  agentBrowserVisibilityFrom,
  LINK_TARGET_KEY,
  linkTargetFrom,
} from '@ramu/shared/browserLinks'
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
import { ramu } from '../ipc'
import type { BrowserProfileCatalog } from '@ramu/shared/types/browser'
import { BrowserProfilesSettings } from './BrowserProfiles'

/** Settings → Browser. Where clicked links open is a choice of this device; it follows the person across hosts. */
export function BrowserSettings({ draft, onChange, busy }: DraftProps) {
  useLanguage()
  const [visibility, setVisibility] = useState(() =>
    agentBrowserVisibilityFrom(deviceStorage.getItem(AGENT_BROWSER_VISIBILITY_KEY)),
  )
  useEffect(
    () =>
      deviceStorage.subscribe((key) => {
        if (key === AGENT_BROWSER_VISIBILITY_KEY) setVisibility(agentBrowserVisibilityFrom(deviceStorage.getItem(key)))
      }),
    [],
  )
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
  const bulkHosts = scope?.target === 'all' && scope.targets.length > 1
  const draftRef = useRef(draft)
  draftRef.current = draft
  const [profiles, setProfiles] = useState<{ host: string; catalog: BrowserProfileCatalog } | null>(null)
  const profileGeneration = useRef(0)
  const refreshProfiles = useCallback(async () => {
    const mine = ++profileGeneration.current
    try {
      const catalog = await ramu.invoke('browser.profiles.list', selectedHost)
      if (mine === profileGeneration.current) setProfiles({ host: selectedHost, catalog })
    } catch {
      if (mine === profileGeneration.current)
        setProfiles((previous) => ({
          host: selectedHost,
          catalog: {
            profiles: previous?.host === selectedHost ? previous.catalog.profiles : [],
            error: 'Could not read browser profiles. Refresh or update the desktop on the owning computer.',
          },
        }))
    }
  }, [selectedHost])
  useEffect(() => {
    setProfiles(null)
    void refreshProfiles()
    const off = ramu.on('browser:changed', () => {
      void refreshProfiles()
    })
    return () => {
      profileGeneration.current += 1
      off()
    }
  }, [refreshProfiles])
  const catalog = profiles?.host === selectedHost ? profiles.catalog : null
  const [readiness, setReadiness] = useState<{ available: boolean; reason?: string; warning?: string } | null>(null)
  useEffect(() => {
    let active = true,
      revision = 0
    setReadiness(null)
    const read = async () => {
      const mine = ++revision
      try {
        const next = await ramu.invoke('browser.runtimeStatus', selectedHost)
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
  }, [selectedHost])
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
    <div className="settings-form flex flex-col gap-3">
      <SettingsGroupTitle>{t('Agent browser')}</SettingsGroupTitle>
      <p role="status" className="m-0 text-caption text-muted-foreground">
        {readiness
          ? readiness.available
            ? t('Integrated browser ready on this computer')
            : t(readiness.reason ?? 'Integrated browser unavailable')
          : t('Checking browser availability…')}
      </p>
      {readiness?.warning && (
        <p role="alert" className="m-0 text-caption text-bad">
          {t(readiness.warning)}
        </p>
      )}
      <SettingsRow setting="agentBrowser.agentBrowser">
        <SettingsLabel
          title={t('Agent browser')}
          help={t(
            'Applies on the selected execution host. Integrated browser tools currently need Full access and an open Ramu desktop on that host. Changes apply on the next provider launch.',
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
            onChange({
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
          onChange={(value) => onChange({ ...draft, agentBrowser: { ...browser, defaultProfileId: value } })}
        />
      </SettingsRow>
      {providers.map(([provider, name]) => (
        <SettingsRow key={provider} setting={`agentBrowser.providerOverrides.${provider}`}>
          <SettingsLabel title={name} />
          <Dropdown
            label={name}
            keepOptions
            value={browser.providerOverrides[provider] ?? 'default'}
            disabled={busy}
            options={[
              { value: 'default', label: t('Use default') },
              { value: 'provider', label: t('Provider browser setup') },
              { value: 'integrated', label: t('Ramu integrated browser') },
            ]}
            onChange={(value) => {
              const overrides = { ...browser.providerOverrides }
              if (value === 'default') delete overrides[provider]
              else overrides[provider] = value === 'integrated' ? 'integrated' : 'provider'
              onChange({ ...draft, agentBrowser: { ...browser, providerOverrides: overrides } })
            }}
          />
        </SettingsRow>
      ))}
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'Use this provider’s existing browser tools and sessions. Ramu cannot show or import them here. Provider tools may remain available when the integrated browser is selected.',
        )}
      </p>
      {bulkHosts ? (
        <p className="m-0 text-caption text-muted-foreground">
          {t('Choose one host to manage browser profiles. Named profiles belong to their owning computer.')}
        </p>
      ) : (
        <BrowserProfilesSettings
          hostId={selectedHost}
          catalog={catalog}
          refresh={refreshProfiles}
          onRemoved={(id) => {
            const current = draftRef.current
            if (current.agentBrowser?.defaultProfileId === id)
              onChange({ ...current, agentBrowser: { ...current.agentBrowser, defaultProfileId: 'default' } })
          }}
        />
      )}
      <SettingsGroupTitle>{t('Links & viewing')}</SettingsGroupTitle>
      <SettingsRow>
        <SettingsLabel
          title={t('Show agent browser')}
          help={t(
            'Applies to this device only. Background work never switches your thread. Browser activity remains available when the pane stays hidden.',
          )}
        />
        <Dropdown
          label={t('Show agent browser')}
          value={visibility}
          options={[
            { value: 'automatic', label: t('When first used in the active thread') },
            { value: 'manual', label: t('Manually') },
          ]}
          onChange={(value) => deviceStorage.setItem(AGENT_BROWSER_VISIBILITY_KEY, agentBrowserVisibilityFrom(value))}
        />
      </SettingsRow>
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
      <p className="m-0 text-caption text-muted-foreground">
        {t('The Ramu browser keeps its own sign-ins, separate from your system browser and from your threads.')}
      </p>
    </div>
  )
}
