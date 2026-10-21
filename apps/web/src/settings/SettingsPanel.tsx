import { SettingsScopeContext, useSettingsScope } from './SettingsScope'
import { sameValue, settingValue } from '@ramu/shared/settingsCompatibility'
import { LearningLimitsSettings, LearningSettings, MaintenanceModelSettings } from './IntelligenceSettings'
import { SettingsGroupTitle } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { ProviderSettings } from './ProviderSettings'
import { Button } from '@/components/desktop-button'
import { RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resetPanelLayouts } from '../workspace/panelLayout'
import { DEFAULT_SIDEBAR_WIDTH, type AppPreferences, type ModelPreferences } from '@ramu/shared/types'
import { GoalSettings } from './GoalSettings'
import { MemoryBrowser, MemorySettings } from './MemorySettings'
import { SummarySettings } from '../summaries/SummarySettings'
import { AdvisorSettings, SubagentSettings } from './FallbackSettings'
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
import { GitSettings } from './GitSettings'
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
  shortcuts = [],
}: {
  onClose: () => void
  initialSection?: SettingsSection
  initialTarget?: string
  shortcuts?: Shortcut[]
}) {
  useLanguage()

  const app = useAppSettings()
  const [page, setPage] = useState<SettingsSection>(initialSection)
  useEffect(() => setPage(initialSection), [initialSection])
  const scope = useSettingsScope(page)
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
  const hasChanges = settingsChanged || environment.changed
  scope.dirty.current = !scope.loading && hasChanges
  useEffect(() => {
    if (scope.loading) return
    setAppDraft(structuredClone(scope.preferences))
    setDraft(structuredClone(scope.models))
    setSelected(scope.models.defaultSetId)
    setError(null)
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
      if (!settingsChanged) return
      const saved = await scope.save(appDraft, models, [...paths, ...(modelsChanged ? ['$models'] : [])])
      if (saved) {
        setDraft(models)
        if (scope.targets.some((entry) => entry.id === scope.currentId)) {
          await app.reload()
          await store.reload()
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
                <ProviderSettings value={appDraft} onChange={setAppDraft} />
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
            {page === 'access' && <AccessSettings {...draftProps} />}
            {page === 'memory' && (
              <>
                <MemorySettings value={appDraft.memory} onChange={(memory) => setAppDraft({ ...appDraft, memory })} />
                <LearningSettings
                  value={appDraft.intelligence}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                <SummarySettings
                  value={appDraft.intelligence}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                  hasChanges={hasChanges}
                />
                <MaintenanceModelSettings
                  value={appDraft.intelligence}
                  cleanup={appDraft.memory.enabled && appDraft.memory.dream}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                <LearningLimitsSettings
                  value={appDraft.intelligence}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                {appDraft.memory.enabled && <MemoryBrowser />}
              </>
            )}
            {page === 'workflows' && (
              <>
                <GoalSettings value={appDraft.goals} onChange={(goals) => setAppDraft({ ...appDraft, goals })} />
                <SubagentSettings value={appDraft} onChange={setAppDraft} busy={busy} />
                <AdvisorSettings value={appDraft} onChange={setAppDraft} busy={busy} />
              </>
            )}
            {page === 'archived' && <ArchivedThreads />}
            {page === 'chats' && <ChatsSettings {...draftProps} />}
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
  )
}
