import { SettingsScopeContext, useSettingsScope } from './SettingsScope'
import { sameValue, settingValue } from '@ramu/shared/settingsCompatibility'
import { LearningSettings, MaintenanceModelSettings, MemoryAdvancedSettings } from './IntelligenceSettings'
import { SettingsGroupTitle } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { ProviderSettings } from './ProviderSettings'
import { Button } from '@/components/desktop-button'
import { RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { previewAppearance } from '../appearance'
import { endTrial } from '../theme/themes'
import { commitStaged, StagingContext, withStaged, type StagedChanges } from './stagedChanges'
import { resetPanelLayouts } from '../workspace/panelLayout'
import { DEFAULT_SIDEBAR_WIDTH, type AppPreferences, type ModelPreferences } from '@ramu/shared/types'
import { GoalSettings } from './GoalSettings'
import { MemoryBrowser, MemorySettings } from './MemorySettings'
import { SummarySettings } from '../summaries/SummarySettings'
import { AdvisorSettings, SubagentSettings } from './FallbackSettings'
import { AbilitySettings } from './AbilitySettings'
import { MediaSettings } from './MediaSettings'
import { CustomAgentSettings } from './CustomAgents'
import { RemoteAccessSettings } from './RemoteAccess'
import { modelStepName, recommendedSets, useModelSets, ModelSetsOverride } from '../models/ModelSets'
import { useAppSettings, AppSettingsOverride } from './AppSettings'
import { SettingsPage, type SettingsSection } from './SettingsPage'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { SettingsThreadContext } from './settingsField'
import { AccessSettings, ProviderFallbackSettings } from './AccessSettings'
import { EnvironmentSettings, useProviderEnvironment } from './EnvironmentSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { ChatsSettings } from './ChatsSettings'
import { GHOST_BUTTON_CLASS, RESET_KEYS, SETTINGS_FORM_CLASS } from './constants'
import { EditorSettings } from './EditorSettings'
import { BrowserSettings } from './BrowserSettings'
import { VoiceSettings } from './VoiceSettings'
import { ComputerUseSettings } from './ComputerSettings'
import { TestDevicesPage } from './TestDeviceSettings'
import { GitSettings } from './GitSettings'
import { ModelSetsEditor } from './ModelSetsEditor'
import { ResetDialog, type ResetTarget } from './ResetDialog'
import { inResetSection, resetSection } from './resetDefaults'
import { ShortcutsSettings, type Shortcut } from './ShortcutsSettings'
import { SystemSettings } from './SystemSettings'
import { ToggleRow } from './ToggleRow'
import { AgentSetup, type SetupView } from './AgentSetup'
import { PluginSettings } from './Plugins'
import { IdentitySettings } from './Identities'
import { AccountSettings } from './AccountSettings'
import { SettingsTransfer } from './SettingsTransfer'

const SETUP_TABS: Record<string, SetupView> = {
  'Environment variables': 'environment',
  'MCP servers': 'mcp',
  Skills: 'skills',
}

export function SettingsPanel({
  onClose,
  initialSection = 'appearance',
  initialTarget,
  initialHost,
  shortcuts = [],
}: {
  onClose: () => void
  initialSection?: SettingsSection
  initialTarget?: string
  /** The host Settings opens on; the window's own host and All hosts stay selectable. */
  initialHost?: string
  shortcuts?: Shortcut[]
}) {
  useLanguage()

  const app = useAppSettings()
  const [page, setPage] = useState<SettingsSection>(initialSection)
  useEffect(() => setPage(initialSection), [initialSection])
  // The row to scroll to; a new object each time, so the same link pressed twice scrolls twice.
  const [jump, setJump] = useState<{ title: string } | undefined>(undefined)
  useEffect(() => setJump(initialTarget ? { title: initialTarget } : undefined), [initialTarget])
  const openAt = (section: SettingsSection, title: string) => {
    setPage(section)
    setJump({ title })
  }
  const scope = useSettingsScope(page, initialHost)
  const [appDraft, setAppDraft] = useState<AppPreferences>(() => structuredClone(scope.preferences))
  const store = useModelSets()
  const [draft, setDraft] = useState<ModelPreferences>(() => structuredClone(scope.models))
  const [selected, setSelected] = useState(draft.defaultSetId)
  const [busy, setBusy] = useState(false)
  const ws = useWorkspace()
  const [reset, setReset] = useState<ResetTarget | null>(null)
  const [sizesReset, setSizesReset] = useState(false)
  const [error, setError] = useState<string | null>(store.error)
  const paths =
    scope.targets
      .find((entry) => entry.id === scope.primaryId)
      ?.snapshot?.settings.filter(
        (field) =>
          field.path !== '$models' &&
          !sameValue(settingValue(appDraft, field.path), settingValue(scope.preferences, field.path)),
      )
      .map((field) => field.path) ?? []
  const modelsChanged = !sameValue(draft, scope.models)
  const environment = useProviderEnvironment(scope, page === 'agent-setup')
  // Search and Customize land on a tab of Agent setup by its title; a new object each time, as `jump` is.
  const setupTab = useMemo(() => {
    const view = jump && SETUP_TABS[jump.title]
    return view ? { view } : undefined
  }, [jump])
  const settingsChanged = paths.length > 0 || modelsChanged || scope.edited.size > 0
  const [staged, setStaged] = useState<StagedChanges>(new Map())
  const stage = useCallback(
    <T,>(key: string, value: T, saved: T, apply: (value: T) => unknown) =>
      setStaged((current) => withStaged(current, key, value, saved, apply as (value: never) => unknown)),
    [],
  )
  const staging = useMemo(() => ({ changes: staged, stage }), [staged, stage])
  // Previews last only as long as the panel: closing it without saving shows what is saved.
  useEffect(
    () => () => {
      endTrial()
      previewAppearance(null)
    },
    [],
  )
  const hasChanges = settingsChanged || environment.changed || staged.size > 0
  scope.dirty.current = !scope.loading && hasChanges
  useEffect(() => {
    if (scope.loading) return
    setAppDraft(structuredClone(scope.preferences))
    setDraft(structuredClone(scope.models))
    setSelected(scope.models.defaultSetId)
    setStaged(new Map())
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [scope.loadKey] by design; the values it reads beyond these are current as of that run
  }, [scope.loadKey])
  const save = async () => {
    if (busy || !hasChanges) return
    setBusy(true)
    setError(null)
    try {
      if (modelsChanged && draft.sets.some((entry) => !entry.name.trim()))
        throw new Error(t('Name each set before saving.'))
      const models =
        modelsChanged || scope.edited.has('$models')
          ? {
              ...draft,
              sets: draft.sets.map((entry) => ({
                ...entry,
                steps: entry.steps.map((step) => ({ ...step, name: modelStepName(step, scope.catalogs) })),
              })),
            }
          : draft
      if (environment.changed) await environment.save()
      if (staged.size) {
        const { left, error: failed } = await commitStaged(staged)
        setStaged(left)
        if (failed) throw failed
      }
      if (!settingsChanged) return
      const saved = await scope.save(appDraft, models, [...paths, ...(modelsChanged ? ['$models'] : [])])
      if (saved) {
        setDraft(models)
        if (scope.targets.some((entry) => entry.id === scope.currentId)) {
          await app.reload()
          // Save is done; the lists catch up behind it. The host already drops its catalog when providers change.
          void store.reload({ rediscover: false }).catch(() => {})
        }
      }
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const draftProps = { draft: appDraft, onChange: setAppDraft, busy }
  const pageKeys = RESET_KEYS[page]
  const resetPage = (section: SettingsSection) => {
    if (!RESET_KEYS[section]) return
    for (const field of scope.targets.find((entry) => entry.id === scope.primaryId)?.snapshot?.settings ?? []) {
      if (field.path.includes('.accounts') || field.path.includes('.accountOrder')) continue
      if (inResetSection(section, field.path) && !scope.field(field.path).disabled) scope.mark(field.path)
    }
    setAppDraft((current) => resetSection(current, section))
  }
  const confirmReset = () => {
    if (reset && reset !== 'models' && reset !== 'sizes') resetPage(reset)
    if (reset === 'models') {
      scope.mark('$models')
      const next = recommendedSets(scope.catalogs)
      setDraft(next)
      setSelected(next.defaultSetId)
    }
    if (reset === 'sizes') {
      ws.resetLayoutSizes()
      resetPanelLayouts()
      setAppDraft((current) => ({ ...current, sidebarWidth: DEFAULT_SIDEBAR_WIDTH }))
      scope.mark('sidebarWidth')
      setSizesReset(true)
    }
    setReset(null)
  }
  // Unsaved changes keep Settings open beneath the thread rather than discarding them.
  const threads = {
    open: (taskId: string) => {
      if (!hasChanges && !busy) onClose()
      ws.openTask(taskId)
    },
    has: (taskId: string) => ws.tasks.some((task) => task.id === taskId),
  }
  return (
    <StagingContext.Provider value={staging}>
      <SettingsScopeContext.Provider value={scope}>
        <SettingsThreadContext.Provider value={threads}>
          <AppSettingsOverride value={{ ...app, preferences: appDraft }}>
            <ModelSetsOverride value={{ ...store, catalogs: scope.catalogs, preferences: draft }}>
              <SettingsPage
                section={page}
                target={jump}
                onSection={setPage}
                busy={busy || scope.saving}
                hasChanges={hasChanges}
                error={error ?? scope.error}
                onSave={() => void save()}
                onClose={() => {
                  if (!busy) onClose()
                }}
              >
                {page === 'providers' && (
                  <>
                    <SettingsGroupTitle>{t('Providers')}</SettingsGroupTitle>
                    <ProviderSettings value={appDraft} onChange={setAppDraft} onOpenSection={setPage} />
                    <MediaSettings onOpenAbilities={() => openAt('models', 'Abilities')} />
                    <div className={`${SETTINGS_FORM_CLASS} mt-8`}>
                      <SettingsGroupTitle>{t('Usage')}</SettingsGroupTitle>
                      <ToggleRow
                        {...draftProps}
                        setting="showUsageLimits"
                        title="Show usage limits"
                        description="Show provider usage in the sidebar or status bar."
                      />
                    </div>
                  </>
                )}
                {page === 'remote' && <RemoteAccessSettings />}
                {page === 'agent-setup' && (
                  <AgentSetup
                    show={setupTab}
                    environment={<EnvironmentSettings environment={environment} preferences={appDraft} busy={busy} />}
                  />
                )}
                {page === 'plugins' && <PluginSettings />}
                {page === 'identities' && <IdentitySettings />}
                {page === 'account' && (
                  <>
                    <AccountSettings />
                    {/* Copying settings acts on the window's own host, so it shows only while that host is selected. */}
                    {scope.primaryId === scope.currentId && <SettingsTransfer />}
                  </>
                )}
                {page === 'system' && <SystemSettings {...draftProps} />}
                {page === 'appearance' && (
                  <AppearanceSettings {...draftProps} sizesReset={sizesReset} onResetSizes={() => setReset('sizes')} />
                )}
                {page === 'editor' && <EditorSettings {...draftProps} />}
                {page === 'browser' && <BrowserSettings {...draftProps} />}
                {page === 'computer' && <ComputerUseSettings {...draftProps} />}
                {page === 'devices' && <TestDevicesPage onLeave={hasChanges ? undefined : onClose} />}
                {page === 'access' && <AccessSettings {...draftProps} />}
                {page === 'memory' && (
                  <>
                    <MemorySettings
                      value={appDraft.memory}
                      onChange={(memory) => setAppDraft({ ...appDraft, memory })}
                    />
                    <LearningSettings
                      value={appDraft.intelligence}
                      onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                    />
                    <MaintenanceModelSettings
                      value={appDraft.intelligence}
                      cleanup={appDraft.memory.enabled && appDraft.memory.dream}
                      onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                    />
                    <SummarySettings
                      value={appDraft.intelligence}
                      onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                      hasChanges={hasChanges}
                    />
                    <MemoryAdvancedSettings
                      memory={appDraft.memory}
                      intelligence={appDraft.intelligence}
                      onMemory={(memory) => setAppDraft({ ...appDraft, memory })}
                      onIntelligence={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                    />
                    {appDraft.memory.enabled && <MemoryBrowser />}
                  </>
                )}
                {page === 'workflows' && (
                  <>
                    <GoalSettings value={appDraft.goals} onChange={(goals) => setAppDraft({ ...appDraft, goals })} />
                    <SubagentSettings value={appDraft} onChange={setAppDraft} busy={busy} />
                    <CustomAgentSettings />
                    <AdvisorSettings value={appDraft} onChange={setAppDraft} busy={busy} />
                  </>
                )}
                {page === 'chats' && (
                  <>
                    <ChatsSettings {...draftProps} />
                    <div className={SETTINGS_FORM_CLASS}>
                      <VoiceSettings />
                    </div>
                  </>
                )}
                {page === 'git' && <GitSettings {...draftProps} />}
                {page === 'shortcuts' && <ShortcutsSettings shortcuts={shortcuts} />}
                {page === 'models' && (
                  <ModelSetsEditor
                    draft={draft}
                    setDraft={setDraft}
                    selected={selected}
                    setSelected={setSelected}
                    catalogs={scope.catalogs}
                    busy={busy}
                    onRestore={() => setReset('models')}
                    onRefresh={() => {
                      setBusy(true)
                      void store
                        .reload()
                        .catch((reason) => setError(errorText(reason)))
                        .finally(() => setBusy(false))
                    }}
                  />
                )}
                {page === 'models' && <ProviderFallbackSettings {...draftProps} />}
                {page === 'models' && (
                  <AbilitySettings
                    value={appDraft}
                    onChange={setAppDraft}
                    busy={busy}
                    onOpenMedia={() => openAt('providers', 'Media')}
                  />
                )}
                {page === 'models' && (
                  <ToggleRow
                    {...draftProps}
                    setting="modelCatalogLookups"
                    title="Look up model dates online"
                    description="Once a day, this host reads public model lists (models.dev and LiteLLM) to tag new models and ones their provider is retiring or has deprecated. Nothing about you is sent. When off, Ramu tags older versions as legacy itself."
                  />
                )}
                {page === 'models' && (
                  <ToggleRow
                    {...draftProps}
                    setting="newModelNotices"
                    title="Tell me about new models"
                    description="When a provider adds a model you have not had before, each device shows it once and the model list tags it New."
                  />
                )}
                {pageKeys && (
                  <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between">
                    <Button
                      variant="ghost"
                      className={GHOST_BUTTON_CLASS}
                      disabled={busy}
                      onClick={() => setReset(page)}
                    >
                      <RotateCcw size={13} />
                      {t('Reset to defaults')}
                    </Button>
                  </div>
                )}
                <ResetDialog reset={reset} onCancel={() => setReset(null)} onConfirm={confirmReset} />
              </SettingsPage>
            </ModelSetsOverride>
          </AppSettingsOverride>
        </SettingsThreadContext.Provider>
      </SettingsScopeContext.Provider>
    </StagingContext.Provider>
  )
}
