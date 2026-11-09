import { SettingsScopeContext, useSettingsScope } from './SettingsScope'
import { sameValue, settingValue } from '@ramu/shared/settingsCompatibility'
import { LearningSettings, MaintenanceModelSettings, ManagedSkills } from './IntelligenceSettings'
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
import { CustomAgentSettings } from './CustomAgents'
import { RemoteAccessSettings } from './RemoteAccess'
import { modelStepName, recommendedSets, useModelSets, ModelSetsOverride } from '../models/ModelSets'
import { useAppSettings, AppSettingsOverride } from './AppSettings'
import { SettingsPage, type SettingsSection } from './SettingsPage'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { AccessSettings, ProviderFallbackSettings } from './AccessSettings'
import { EnvironmentSettings, useProviderEnvironment } from './EnvironmentSettings'
import { AppearanceSettings } from './AppearanceSettings'
import { ArchivedThreads } from './ArchivedThreads'
import { ChatsSettings } from './ChatsSettings'
import { GHOST_BUTTON_CLASS, RESET_KEYS, SETTINGS_FORM_CLASS } from './constants'
import { EditorSettings } from './EditorSettings'
import { BrowserSettings } from './BrowserSettings'
import { VoiceSettings } from './VoiceSettings'
import { ComputerUseSettings } from './ComputerSettings'
import { GitSettings } from './GitSettings'
import { DeployAccounts } from './DeployAccounts'
import { ModelSetsEditor } from './ModelSetsEditor'
import { ResetDialog, type ResetTarget } from './ResetDialog'
import { inResetSection, resetSection } from './resetDefaults'
import { ShortcutsSettings, type Shortcut } from './ShortcutsSettings'
import { SystemSettings } from './SystemSettings'
import { ToggleRow } from './ToggleRow'
import { AgentSetup } from './AgentSetup'

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
  const environment = useProviderEnvironment(scope, page === 'environment')
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
  return (
    <StagingContext.Provider value={staging}>
      <SettingsScopeContext.Provider value={scope}>
        <AppSettingsOverride value={{ ...app, preferences: appDraft }}>
          <ModelSetsOverride value={{ ...store, catalogs: scope.catalogs, preferences: draft }}>
            <SettingsPage
              section={page}
              target={initialTarget}
              onSection={setPage}
              busy={busy || scope.saving}
              hasChanges={hasChanges}
              error={error ?? scope.error}
              onSave={() => void save()}
              onClose={() => {
                if (!busy) onClose()
              }}
            >
              {page === 'environment' && (
                <EnvironmentSettings environment={environment} preferences={appDraft} busy={busy} />
              )}
              {page === 'providers' && (
                <>
                  <SettingsGroupTitle>{t('Providers')}</SettingsGroupTitle>
                  <ProviderSettings value={appDraft} onChange={setAppDraft} onOpenSection={setPage} />
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
              {page === 'agent-setup' && <AgentSetup />}
              {page === 'system' && <SystemSettings {...draftProps} />}
              {page === 'appearance' && (
                <AppearanceSettings {...draftProps} sizesReset={sizesReset} onResetSizes={() => setReset('sizes')} />
              )}
              {page === 'editor' && <EditorSettings {...draftProps} />}
              {page === 'browser' && <BrowserSettings {...draftProps} />}
              {page === 'computer' && <ComputerUseSettings {...draftProps} />}
              {page === 'access' && <AccessSettings {...draftProps} />}
              {page === 'memory' && (
                <>
                  <MemorySettings value={appDraft.memory} onChange={(memory) => setAppDraft({ ...appDraft, memory })} />
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
                  {appDraft.memory.enabled && <MemoryBrowser />}
                  <ManagedSkills />
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
              {page === 'archived' && <ArchivedThreads />}
              {page === 'chats' && (
                <>
                  <ChatsSettings {...draftProps} />
                  <div className={SETTINGS_FORM_CLASS}>
                    <VoiceSettings />
                  </div>
                </>
              )}
              {page === 'git' && <GitSettings {...draftProps} />}
              {page === 'deploy' && (
                <div className={SETTINGS_FORM_CLASS}>
                  <DeployAccounts />
                </div>
              )}
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
              {page === 'models' && <AbilitySettings value={appDraft} onChange={setAppDraft} busy={busy} />}
              {page === 'models' && (
                <ToggleRow
                  {...draftProps}
                  setting="modelCatalogLookups"
                  title="Look up model dates online"
                  description="This host reads public model lists (models.dev and LiteLLM) once a day to tag new models and ones their provider is retiring or calls deprecated. Nothing about you is sent. Off, Ramu tags older versions as legacy on its own."
                />
              )}
              {page === 'models' && (
                <ToggleRow
                  {...draftProps}
                  setting="newModelNotices"
                  title="Tell me about new models"
                  description="When a provider starts offering a model you have not had before, every device shows it once, and the model list tags it New."
                />
              )}
              {pageKeys && (
                <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between">
                  <Button variant="ghost" className={GHOST_BUTTON_CLASS} disabled={busy} onClick={() => setReset(page)}>
                    <RotateCcw size={13} />
                    {t('Reset to defaults')}
                  </Button>
                </div>
              )}
              <ResetDialog reset={reset} onCancel={() => setReset(null)} onConfirm={confirmReset} />
            </SettingsPage>
          </ModelSetsOverride>
        </AppSettingsOverride>
      </SettingsScopeContext.Provider>
    </StagingContext.Provider>
  )
}
