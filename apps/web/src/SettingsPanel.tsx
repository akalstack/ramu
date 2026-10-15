import { SettingsScopeContext, SettingsField, useSettingsScope } from './SettingsScope'
import { sameValue, settingValue } from '@ramu/shared/settingsCompatibility'
import {
  EfficiencySettings,
  LearningSettings,
  MaintenanceModelSettings,
  ResponseSettings,
} from './IntelligenceSettings'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { AppUpdates } from './AppUpdates'
import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { ProviderSettings } from './ProviderSettings'
import { AGENT_PROVIDERS, providerName } from '@ramu/shared/providers'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { resetPanelLayouts } from './panelLayout'
import {
  DEFAULT_APP_PREFERENCES,
  DEFAULT_INTELLIGENCE_PREFERENCES,
  DEFAULT_SIDEBAR_WIDTH,
  type AppPreferences,
  type ModelPreferences,
  type ModelStep,
} from '@ramu/shared/types'
import { GoalSettings } from './GoalSettings'
import { MemoryBrowser, MemorySettings } from './MemorySettings'
import { AdvisorSettings, FallbackSettings, SubagentSettings } from './FallbackSettings'
import { BackgroundControls } from './Automation'
import { RemoteAccessSettings } from './RemoteAccess'
import { Dropdown } from './Menu'
import {
  effortDisplayName,
  modelDisplayName,
  modelStepName,
  recommendedSets,
  useModelSets,
  ModelSetsOverride,
} from './ModelSets'
import { useAppSettings, AppSettingsOverride } from './AppSettings'
import { SETTINGS_SECTIONS, SettingsPage, type SettingsSection } from './SettingsPage'
import { accessName } from './AgentControls'
import { formatKeys } from './commands'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'
import { setRowDragImage } from './dragState'

export function SettingsPanel({
  onClose,
  initialSection = 'appearance',
  initialTarget,
  shortcuts = [],
}: {
  onClose: () => void
  initialSection?: SettingsSection
  initialTarget?: string
  shortcuts?: { title: string; category: string; keys: string }[]
}) {
  const language = useLanguage()

  const app = useAppSettings()
  const scope = useSettingsScope()
  const [page, setPage] = useState<SettingsSection>(initialSection)
  useEffect(() => setPage(initialSection), [initialSection])
  const [appDraft, setAppDraft] = useState<AppPreferences>(() => structuredClone(scope.preferences))
  const store = useModelSets()
  const [draft, setDraft] = useState<ModelPreferences>(() => structuredClone(scope.models))
  const [selected, setSelected] = useState(draft.defaultSetId)
  const [busy, setBusy] = useState(false)
  const ws = useWorkspace()
  const [reset, setReset] = useState<SettingsSection | 'models' | 'sizes' | null>(null)
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
  const hasChanges = paths.length > 0 || modelsChanged || scope.edited.size > 0
  scope.dirty.current = !scope.loading && hasChanges
  useEffect(() => {
    if (scope.loading) return
    setAppDraft(structuredClone(scope.preferences))
    setDraft(structuredClone(scope.models))
    setSelected(scope.models.defaultSetId)
    setError(null)
  }, [scope.loadKey])
  const set = draft.sets.find((entry) => entry.id === selected) ?? draft.sets[0]!
  const models = scope.catalogs.flatMap((catalog) => catalog.models)
  const updateSteps = (steps: ModelStep[]) =>
    setDraft((current) => {
      const next = {
        ...current,
        sets: current.sets.map((entry) => (entry.id === set.id ? { ...entry, steps } : entry)),
      }
      if (next.defaultSetId === set.id && !steps.some((step) => step.id === next.defaultStepId))
        next.defaultStepId = steps[0]!.id
      return next
    })
  const update = (step: ModelStep) => updateSteps(set.steps.map((entry) => (entry.id === step.id ? step : entry)))
  // Drag a step by its grip to reorder; a line shows where it will land.
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const endDrag = () => {
    setDragFrom(null)
    setDropAt(null)
  }
  const dropStep = () => {
    if (dragFrom !== null && dropAt !== null) {
      const steps = [...set.steps],
        moved = steps.splice(dragFrom, 1)[0]!
      steps.splice(dropAt > dragFrom ? dropAt - 1 : dropAt, 0, moved)
      updateSteps(steps)
    }
    endDrag()
  }
  const move = (index: number, delta: number) => {
    const steps = [...set.steps]
    const moved = steps.splice(index, 1)[0]!
    steps.splice(index + delta, 0, moved)
    updateSteps(steps)
  }
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
  const sizes = (min: number, max: number) =>
    Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))
  const toggle = (
    key:
      | 'previewTabs'
      | 'hideEmptyStaged'
      | 'autoPull'
      | 'defaultAutoFallback'
      | 'includeTabContext'
      | 'warnModelChange'
      | 'recapsEnabled'
      | 'notifyAgentDone'
      | 'resumeChatsOnRestart'
      | 'asyncQuestions'
      | 'showUsageLimits'
      | 'keepAwake'
      | 'fontSmoothing'
      | 'reduceMotion',
    title: string,
    description: string,
  ) => (
    <SettingsRow setting={key}>
      <SettingsLabel title={t(title)} help={t(description)} />
      <Switch
        aria-label={t(title)}
        checked={appDraft[key]}
        disabled={busy}
        onCheckedChange={(checked) => setAppDraft({ ...appDraft, [key]: checked })}
      />
    </SettingsRow>
  )
  const resetKeys: Partial<Record<typeof page, (keyof AppPreferences)[]>> = {
    system: ['appUpdateChecks', 'appAutoUpdate', 'keepAwake', 'keepAwakeWhen', 'recapsEnabled', 'recapTime'],
    providers: ['providerBinaries', 'providerUpdateChecks', 'showUsageLimits'],
    appearance: ['language', 'accent', 'fontFamily', 'fontSize', 'fontSmoothing', 'reduceMotion', 'sidebarWidth'],
    editor: ['previewTabs', 'editorFontSize', 'terminalFontSize', 'defaultTerminalDock'],
    access: ['defaultAccess', 'defaultAutoFallback', 'fallback'],
    workflows: ['goals', 'subagents', 'advisor'],
    memory: ['memory'],
    chats: [
      'busyMessageAction',
      'includeTabContext',
      'warnModelChange',
      'notifyAgentDone',
      'resumeChatsOnRestart',
      'asyncQuestions',
      'autoBackgroundSeconds',
      'recentChats',
      'cleanupArchivedDays',
    ],
    git: [
      'pullMode',
      'autoPull',
      'commitStyle',
      'commitInstructions',
      'defaultCommitAction',
      'defaultCommitBranch',
      'hideEmptyStaged',
    ],
  }
  const pageKeys = resetKeys[page]
  const resetPage = (section: SettingsSection) => {
    const keys = resetKeys[section]
    if (!keys) return
    const intelligenceKeys =
      section === 'chats'
        ? ['responseStyle', 'responseInstructions', 'responseSkill', 'compression', 'toolSearch', 'rtk']
        : section === 'memory'
          ? ['learning', 'maintenanceModel', 'dailyReviews', 'archiveSkillDays']
          : []
    for (const field of scope.targets.find((entry) => entry.id === scope.primaryId)?.snapshot?.settings ?? []) {
      if (field.path.includes('.accounts')) continue
      if (
        (keys.some((key) => field.path === key || field.path.startsWith(`${key}.`)) ||
          intelligenceKeys.some((key) => field.path === `intelligence.${key}`)) &&
        !scope.field(field.path).disabled
      )
        scope.mark(field.path)
    }
    // Chats and Memory each own part of `intelligence`; reset only their own fields.
    const D = DEFAULT_INTELLIGENCE_PREFERENCES
    const intelligence = (current: AppPreferences) =>
      section === 'chats'
        ? {
            ...current.intelligence,
            responseStyle: D.responseStyle,
            responseInstructions: D.responseInstructions,
            responseSkill: D.responseSkill,
            compression: D.compression,
            toolSearch: D.toolSearch,
            rtk: D.rtk,
          }
        : section === 'memory'
          ? {
              ...current.intelligence,
              learning: D.learning,
              maintenanceModel: D.maintenanceModel,
              dailyReviews: D.dailyReviews,
              archiveSkillDays: D.archiveSkillDays,
            }
          : current.intelligence
    setAppDraft((current) => ({
      ...current,
      ...Object.fromEntries(keys.map((key) => [key, DEFAULT_APP_PREFERENCES[key]])),
      intelligence: intelligence(current),
      // Account identities are recovery metadata, not disposable appearance settings.
      ...(section === 'providers'
        ? {
            providerBinaries: Object.fromEntries(
              AGENT_PROVIDERS.map((provider) => [
                provider,
                {
                  ...current.providerBinaries[provider],
                  binary: '',
                  accountId: 'default',
                  autoUpdate: false,
                  enabled: true,
                  usageKeychain: false,
                  harness: '',
                },
              ]),
            ),
          }
        : {}),
    }))
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
            {page === 'providers' && (
              <>
                <SettingsGroupTitle>{t('Providers')}</SettingsGroupTitle>
                <ProviderSettings value={appDraft} onChange={setAppDraft} />
                <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 mt-8">
                  <SettingsGroupTitle>{t('Usage')}</SettingsGroupTitle>
                  {toggle('showUsageLimits', 'Show usage limits', 'Show provider usage in the sidebar or status bar.')}
                </div>
              </>
            )}
            {page === 'remote' && <RemoteAccessSettings />}
            {page === 'system' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <SettingsGroupTitle>{t('Background service')}</SettingsGroupTitle>
                <BackgroundControls onInstalled={() => setAppDraft((current) => ({ ...current, keepAwake: true }))} />
                {toggle(
                  'keepAwake',
                  'Keep computer awake',
                  'Stop your Mac sleeping from idle while the service runs. Display sleep and manual sleep still work.',
                )}
                {appDraft.keepAwake && (
                  <SettingsRow setting="keepAwakeWhen">
                    <SettingsLabel
                      title={t('When to keep awake')}
                      help={t('Choose whether to keep awake on battery power.')}
                    />
                    <Dropdown
                      label={t('When to keep awake')}
                      value={appDraft.keepAwakeWhen}
                      options={[
                        { value: 'plugged-in', label: t('Plugged in only (recommended)') },
                        { value: 'always', label: t('Plugged in and on battery') },
                      ]}
                      onChange={(when) =>
                        setAppDraft({ ...appDraft, keepAwakeWhen: when === 'always' ? 'always' : 'plugged-in' })
                      }
                    />
                  </SettingsRow>
                )}
                <SettingsGroupTitle>{t('Daily recaps')}</SettingsGroupTitle>
                {toggle(
                  'recapsEnabled',
                  'Daily recaps',
                  'Show recent chats and unfinished work on Home. Uses model tokens to write the summary.',
                )}
                {appDraft.recapsEnabled && (
                  <SettingsRow setting="recapTime">
                    <SettingsLabel
                      title={t('Generate daily at')}
                      help={t('Create the recap at this time in your system timezone.')}
                    />
                    <Input
                      aria-label={t('Generate daily at')}
                      type="time"
                      value={appDraft.recapTime}
                      onChange={(e) => setAppDraft({ ...appDraft, recapTime: e.target.value })}
                    />
                  </SettingsRow>
                )}
                <SettingsGroupTitle>{t('Updates')}</SettingsGroupTitle>
                <AppUpdates value={appDraft} onChange={setAppDraft} />
              </div>
            )}
            {page === 'appearance' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <SettingsRow setting="language">
                  <SettingsLabel
                    title={t('Language')}
                    help={t('Choose your preferred language. Changes apply after saving.')}
                  />
                  <Dropdown
                    label={t('App language')}
                    value={appDraft.language}
                    options={[
                      { value: 'system', label: t('Follow system') },
                      { value: 'id', label: 'Bahasa Indonesia' },
                      { value: 'en', label: 'English' },
                    ]}
                    onChange={(language) =>
                      setAppDraft({ ...appDraft, language: language as AppPreferences['language'] })
                    }
                  />
                </SettingsRow>
                <SettingsRow setting="accent">
                  <SettingsLabel
                    title={t('Primary color')}
                    help={t('Used for primary actions, activity, and links.')}
                  />
                  <Dropdown
                    label={t('Primary color')}
                    value={appDraft.accent}
                    options={[
                      { value: 'blue', label: t('Blue') },
                      { value: 'violet', label: t('Violet') },
                      { value: 'teal', label: t('Teal') },
                    ]}
                    onChange={(accent) => setAppDraft({ ...appDraft, accent: accent as AppPreferences['accent'] })}
                  />
                </SettingsRow>
                <SettingsRow setting="fontFamily">
                  <SettingsLabel title={t('Interface font')} help={t('Choose the font used throughout Ramu.')} />
                  <Dropdown
                    label={t('Interface font')}
                    value={appDraft.fontFamily}
                    options={[
                      { value: 'system', label: t('System') },
                      { value: 'geist', label: 'Geist' },
                    ]}
                    onChange={(fontFamily) =>
                      setAppDraft({ ...appDraft, fontFamily: fontFamily as AppPreferences['fontFamily'] })
                    }
                  />
                </SettingsRow>
                <SettingsRow setting="fontSize">
                  <strong>{t('Interface font size')}</strong>
                  <Dropdown
                    label={t('Interface font size')}
                    value={String(appDraft.fontSize)}
                    options={sizes(12, 18)}
                    onChange={(value) => setAppDraft({ ...appDraft, fontSize: Number(value) })}
                  />
                </SettingsRow>
                {toggle(
                  'reduceMotion',
                  'Reduce motion',
                  'Disable interface animations. System reduced motion is always respected.',
                )}
                {toggle('fontSmoothing', 'Crisper text', 'Use lighter text rendering on macOS.')}
                <SettingsRow>
                  <SettingsLabel
                    title={t('Layout sizes')}
                    help={t(
                      'Return the sidebar, editor/chat split and terminal height to their default sizes in every workspace.',
                    )}
                  />
                  <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setReset('sizes')}>
                    {sizesReset ? t('Sizes reset') : t('Reset sizes')}
                  </Button>
                </SettingsRow>
                <div className="settings-appearance-sample flex items-center gap-2.5 p-3.5 [border:1px_solid_transparent] rounded-(--radius-s) flex-wrap mt-4 bg-fill">
                  <span
                    className={`accent-swatch w-4 h-4 rounded-full accent-${appDraft.accent} [&.accent-blue]:bg-[#0a84ff] [&.accent-violet]:bg-[#7652d4] [&.accent-teal]:bg-[#087f7b]`}
                  />
                  <span>{t('Project workspace')}</span>
                  <span className="muted text-muted-foreground">{t('Preview of your primary accent')}</span>
                </div>
              </div>
            )}
            {page === 'editor' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <SettingsGroupTitle>{t('Editor')}</SettingsGroupTitle>
                {toggle(
                  'previewTabs',
                  'Preview tabs',
                  'Single-click previews a file. Double-click or edit to keep it open.',
                )}
                <SettingsRow setting="editorFontSize">
                  <strong>{t('Editor font size')}</strong>
                  <Dropdown
                    label={t('Editor font size')}
                    value={String(appDraft.editorFontSize)}
                    options={sizes(10, 22)}
                    onChange={(value) => setAppDraft({ ...appDraft, editorFontSize: Number(value) })}
                  />
                </SettingsRow>
                <SettingsGroupTitle>{t('Terminal')}</SettingsGroupTitle>
                <SettingsRow setting="terminalFontSize">
                  <strong>{t('Terminal font size')}</strong>
                  <Dropdown
                    label={t('Terminal font size')}
                    value={String(appDraft.terminalFontSize)}
                    options={sizes(8, 22)}
                    onChange={(value) => setAppDraft({ ...appDraft, terminalFontSize: Number(value) })}
                  />
                </SettingsRow>
                <SettingsRow setting="defaultTerminalDock">
                  <SettingsLabel
                    title={t('Default terminal position')}
                    help={t(
                      'Choose where the terminal panel opens. Checkouts with a saved terminal position keep that choice.',
                    )}
                  />
                  <Dropdown
                    label={t('Default terminal position')}
                    value={appDraft.defaultTerminalDock}
                    options={[
                      { value: 'bottom', label: t('Bottom') },
                      { value: 'right', label: t('Right') },
                    ]}
                    onChange={(value) =>
                      setAppDraft({ ...appDraft, defaultTerminalDock: value === 'right' ? 'right' : 'bottom' })
                    }
                  />
                </SettingsRow>
                <p className="muted text-muted-foreground small text-caption">
                  {t(
                    'Files and terminals are shared by chats in the same checkout. Isolated worktrees keep separate state.',
                  )}
                </p>
              </div>
            )}
            {page === 'access' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <SettingsGroupTitle>{t('Permissions')}</SettingsGroupTitle>
                <SettingsRow setting="defaultAccess">
                  <SettingsLabel
                    title={t('Default access')}
                    help={t('Starting access for new chats. Existing chats keep theirs.')}
                  />
                  <Dropdown
                    label={t('Default access')}
                    value={appDraft.defaultAccess}
                    options={(['edits', 'auto', 'full'] as const).map((value) => ({ value, label: accessName(value) }))}
                    onChange={(value) =>
                      setAppDraft({ ...appDraft, defaultAccess: value as AppPreferences['defaultAccess'] })
                    }
                  />
                </SettingsRow>
                <SettingsGroupTitle>{t('Provider fallback')}</SettingsGroupTitle>
                {toggle(
                  'defaultAutoFallback',
                  'Automatic provider fallback',
                  'Switch to another provider when a usage limit is reached. Applies to new chats.',
                )}
                <FallbackSettings value={appDraft} onChange={setAppDraft} busy={busy} />
              </div>
            )}
            {page === 'memory' && (
              <>
                <MemorySettings value={appDraft.memory} onChange={(memory) => setAppDraft({ ...appDraft, memory })} />
                <MaintenanceModelSettings
                  value={appDraft.intelligence}
                  cleanup={appDraft.memory.enabled && appDraft.memory.dream}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                <LearningSettings
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
            {page === 'chats' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <ResponseSettings
                  value={appDraft.intelligence}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                <SettingsGroupTitle>{t('Sending messages')}</SettingsGroupTitle>
                <SettingsRow setting="busyMessageAction">
                  <SettingsLabel
                    title={t('Messages while working')}
                    help={t(
                      'Steer adds your message after the current tools finish. Queue waits for the whole turn. Cmd/Ctrl+Enter does the other one.',
                    )}
                  />
                  <Dropdown
                    label={t('Messages while working')}
                    value={appDraft.busyMessageAction}
                    options={[
                      { value: 'steer', label: t('Steer') },
                      { value: 'queue', label: t('Queue') },
                    ]}
                    onChange={(value) =>
                      setAppDraft({ ...appDraft, busyMessageAction: value === 'steer' ? 'steer' : 'queue' })
                    }
                  />
                </SettingsRow>
                {toggle(
                  'warnModelChange',
                  'Warn before changing model',
                  "A new model can't reuse the cache of a conversation in progress, so the first message after switching uses more of your usage.",
                )}
                {toggle(
                  'includeTabContext',
                  'Include open tabs as context',
                  'Send the active file or selection with each message, plus the paths of other open tabs. Unsaved edits are included.',
                )}
                <SettingsGroupTitle>{t('While agents work')}</SettingsGroupTitle>
                {toggle(
                  'notifyAgentDone',
                  'Agent notifications',
                  'Notify when an agent finishes, needs input, or fails.',
                )}
                {toggle(
                  'resumeChatsOnRestart',
                  'Continue chats after restart',
                  'Resume unfinished chats when the service restarts. Stopped and completed chats stay stopped.',
                )}
                {toggle(
                  'asyncQuestions',
                  'Keep working while asking questions',
                  'Let the agent continue independent work while it waits for your answer.',
                )}
                <SettingsRow setting="autoBackgroundSeconds">
                  <SettingsLabel
                    title={t('Move slow commands to background')}
                    help={t('Let the agent keep working when a command runs longer than this.')}
                  />
                  <Dropdown
                    label={t('Move slow commands to background')}
                    value={String(appDraft.autoBackgroundSeconds)}
                    options={[
                      { value: '0', label: t('Never') },
                      { value: '30', label: t('After 30 seconds') },
                      { value: '60', label: t('After 1 minute') },
                      { value: '120', label: t('After 2 minutes') },
                      { value: '300', label: t('After 5 minutes') },
                    ]}
                    onChange={(value) => setAppDraft({ ...appDraft, autoBackgroundSeconds: Number(value) })}
                  />
                </SettingsRow>
                <EfficiencySettings
                  value={appDraft.intelligence}
                  onChange={(intelligence) => setAppDraft({ ...appDraft, intelligence })}
                />
                <SettingsGroupTitle>{t('Chat history')}</SettingsGroupTitle>
                <SettingsRow setting="recentChats">
                  <SettingsLabel
                    title={t('Recent chats per project')}
                    help={t('Older chats stay available under Show more.')}
                  />
                  <Dropdown
                    label={t('Recent chats per project')}
                    value={String(appDraft.recentChats)}
                    options={Array.from({ length: 18 }, (_, index) => ({
                      value: String(index + 3),
                      label: String(index + 3),
                    }))}
                    onChange={(value) => setAppDraft({ ...appDraft, recentChats: Number(value) })}
                  />
                </SettingsRow>
                <SettingsRow setting="cleanupArchivedDays">
                  <SettingsLabel
                    title={t('Delete archived chats after')}
                    help={t('Worktrees and branches are kept.')}
                  />
                  <Dropdown
                    label={t('Delete archived chats after')}
                    value={String(appDraft.cleanupArchivedDays)}
                    options={[
                      { value: '0', label: t('Never') },
                      { value: '7', label: t('7 days') },
                      { value: '30', label: t('30 days') },
                      { value: '90', label: t('90 days') },
                      { value: '365', label: t('1 year') },
                    ]}
                    onChange={(value) => setAppDraft({ ...appDraft, cleanupArchivedDays: Number(value) || 0 })}
                  />
                </SettingsRow>
              </div>
            )}
            {page === 'git' && (
              <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
                <SettingsGroupTitle>{t('Sync')}</SettingsGroupTitle>
                {toggle(
                  'autoPull',
                  'Automatic pull',
                  'Pull when the checkout is clean and can fast-forward. Skipped while an agent is working, files are unsaved, or Git is busy.',
                )}
                <SettingsRow setting="pullMode">
                  <SettingsLabel
                    title={t('Pull behavior')}
                    help={t(
                      'How Pull and Sync combine local and remote commits. Tracked edits are stashed and restored for you.',
                    )}
                  />
                  <Dropdown
                    label={t('Pull behavior')}
                    value={appDraft.pullMode}
                    options={[
                      { value: 'rebase', label: 'Rebase' },
                      { value: 'merge', label: 'Merge' },
                      { value: 'ff-only', label: t('Fast-forward only') },
                    ]}
                    onChange={(value) =>
                      setAppDraft({
                        ...appDraft,
                        pullMode: value === 'merge' || value === 'ff-only' ? value : 'rebase',
                      })
                    }
                  />
                </SettingsRow>
                <SettingsGroupTitle>{t('Commits')}</SettingsGroupTitle>
                <SettingsRow setting="commitStyle">
                  <SettingsLabel title={t('Commit messages')} help={t('Style for generated commit messages.')} />
                  <Dropdown
                    label={t('Commit message style')}
                    value={appDraft.commitStyle}
                    options={[
                      { value: 'conventional', label: t('Conventional commits') },
                      { value: 'repository', label: t('Repository convention') },
                      { value: 'custom', label: t('Custom instructions') },
                    ]}
                    onChange={(value) =>
                      setAppDraft({
                        ...appDraft,
                        commitStyle: value === 'repository' || value === 'custom' ? value : 'conventional',
                      })
                    }
                  />
                </SettingsRow>
                {appDraft.commitStyle === 'custom' && (
                  <SettingsRow setting="commitInstructions" className="settings-stack">
                    <SettingsLabel
                      title={t('Commit instructions')}
                      help={t(
                        'For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.',
                      )}
                    />
                    <Textarea
                      rows={4}
                      maxLength={2000}
                      value={appDraft.commitInstructions}
                      aria-label={t('Commit message instructions')}
                      placeholder={t('Describe how commit messages should be written')}
                      onChange={(event) => setAppDraft({ ...appDraft, commitInstructions: event.target.value })}
                    />
                  </SettingsRow>
                )}
                <SettingsRow setting="defaultCommitBranch">
                  <SettingsLabel
                    title={t('Commit from default branch')}
                    help={t('What to do when you commit and push while on the default branch.')}
                  />
                  <Dropdown
                    label={t('Commit from default branch')}
                    value={appDraft.defaultCommitBranch}
                    options={[
                      { value: 'new-branch', label: t('Create feature branch') },
                      { value: 'current', label: t('Continue on current branch') },
                    ]}
                    onChange={(value) =>
                      setAppDraft({ ...appDraft, defaultCommitBranch: value === 'current' ? 'current' : 'new-branch' })
                    }
                  />
                </SettingsRow>
                <SettingsGroupTitle>{t('Source control')}</SettingsGroupTitle>
                {toggle(
                  'hideEmptyStaged',
                  'Hide empty Staged section',
                  'Show Staged only when the index contains changes.',
                )}
                <p className="muted text-muted-foreground small text-caption">
                  {t(
                    'Discard and delete actions show their affected files before running. Explorer deletion is permanent.',
                  )}
                </p>
              </div>
            )}
            {page === 'shortcuts' && (
              <div className="settings-shortcuts">
                <p className="muted text-muted-foreground">
                  {t('Current application shortcuts. Editor shortcuts also follow VS Code conventions.')}
                </p>
                {[
                  { title: t('Send / default queue or steer action'), category: t('Composer'), keys: 'Enter' },
                  { title: t('Reverse queue / steer action'), category: t('Composer'), keys: 'mod+Enter' },
                  { title: t('New line'), category: t('Composer'), keys: 'shift+Enter' },
                  ...shortcuts,
                ].map((shortcut) => (
                  <div
                    className="settings-shortcut [&_kbd]:flex-none flex items-center gap-4 justify-between p-[9px_0] [border-bottom:1px_solid_var(--line)]"
                    key={`${shortcut.title}:${shortcut.keys}`}
                  >
                    <span>
                      <span className="muted text-muted-foreground small text-caption">{shortcut.category} · </span>
                      {shortcut.title}
                    </span>
                    <Kbd>{formatKeys(shortcut.keys)}</Kbd>
                  </div>
                ))}
              </div>
            )}
            {page === 'providers' && (
              <SettingsField path="$models">
                <div className="model-settings mt-8 [&_label]:flex [&_label]:flex-col [&_label]:gap-[5px] [&_label]:text-muted-foreground [&_label]:text-caption [&_label]:min-w-0 [&_.dropdown-trigger]:w-full [&_.dropdown-trigger]:text-foreground flex flex-col gap-4">
                  <div className="settings-intro">
                    <h4>{t('Model sets')}</h4>
                    <p className="muted text-muted-foreground">
                      {t('Create model and effort presets for the chat selection bar.')}
                    </p>
                  </div>
                  <label>
                    {t('Default bar mode')}
                    <Dropdown
                      label={t('Default bar mode')}
                      value={draft.defaultBarMode ?? 'model'}
                      options={[
                        { value: 'model', label: t('Model + effort') },
                        { value: 'effort', label: t('Effort only') },
                      ]}
                      onChange={(mode) =>
                        setDraft({ ...draft, defaultBarMode: mode === 'effort' ? 'effort' : 'model' })
                      }
                      disabled={busy}
                    />
                  </label>
                  <div className="settings-defaults grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3">
                    <label>
                      {t('Default set')}
                      <Dropdown
                        label={t('Default model set')}
                        value={draft.defaultSetId}
                        options={draft.sets.map((entry) => ({
                          value: entry.id,
                          label: entry.name || t('Unnamed set'),
                        }))}
                        onChange={(id) => {
                          const entry = draft.sets.find((entry) => entry.id === id)!
                          setDraft({ ...draft, defaultSetId: id, defaultStepId: entry.steps[0]!.id })
                        }}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      {t('Default step')}
                      <Dropdown
                        label={t('Default model step')}
                        value={draft.defaultStepId}
                        options={draft.sets
                          .find((entry) => entry.id === draft.defaultSetId)!
                          .steps.map((step) => ({ value: step.id, label: modelStepName(step, scope.catalogs) }))}
                        onChange={(id) => setDraft({ ...draft, defaultStepId: id })}
                        disabled={busy}
                      />
                    </label>
                  </div>
                  <div className="settings-set-toolbar [&_>_.dropdown-trigger]:flex-1 [&_>_.dropdown-trigger]:min-w-0 flex items-center gap-2">
                    <Dropdown
                      settingNavigation
                      label={t('Edit model set')}
                      value={set.id}
                      options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || t('Unnamed set') }))}
                      onChange={setSelected}
                      disabled={busy}
                    />
                    <Button
                      variant="ghost"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
                      disabled={busy || draft.sets.length >= 20}
                      onClick={() => {
                        const id = crypto.randomUUID()
                        const steps = [{ ...set.steps[0]!, id: crypto.randomUUID() }]
                        setDraft({ ...draft, sets: [...draft.sets, { id, name: 'New set', steps }] })
                        setSelected(id)
                      }}
                    >
                      <Plus size={13} />
                      {t('Add set')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                      title={t('Remove set')}
                      aria-label={t('Remove model set')}
                      disabled={busy || draft.sets.length < 2}
                      onClick={() => {
                        const sets = draft.sets.filter((entry) => entry.id !== set.id)
                        const fallback = sets[0]!
                        setDraft({
                          ...draft,
                          sets,
                          defaultSetId: draft.defaultSetId === set.id ? fallback.id : draft.defaultSetId,
                          defaultStepId: draft.defaultSetId === set.id ? fallback.steps[0]!.id : draft.defaultStepId,
                        })
                        setSelected(fallback.id)
                      }}
                    >
                      <Trash2 size={13} />
                    </Button>
                  </div>
                  <label className="settings-set-name">
                    {t('Set name')}
                    <Input
                      value={set.name}
                      maxLength={80}
                      disabled={busy}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          sets: draft.sets.map((entry) =>
                            entry.id === set.id ? { ...entry, name: event.target.value } : entry,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="settings-steps flex flex-col gap-2">
                    {set.steps.map((step, index) => {
                      const model = models.find(
                        (entry) =>
                          entry.provider === step.provider &&
                          (entry.id === step.model || (!step.model && entry.isDefault)),
                      )
                      const key = `${step.provider}:${step.model}`
                      const options = models.map((entry) => ({
                        value: `${entry.provider}:${entry.id}`,
                        label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}`,
                      }))
                      if (!options.some((option) => option.value === key))
                        options.unshift({
                          value: key,
                          label: step.model
                            ? t('{0} · Unavailable', { '0': step.model })
                            : t('{0} default', { '0': providerName(step.provider) }),
                        })
                      return (
                        <section
                          className={`settings-step [&.dragging]:[opacity:0.45] [&.drop-before::before]:[content:''] [&.drop-before::before]:absolute [&.drop-before::before]:left-0 [&.drop-before::before]:right-0 [&.drop-before::before]:h-0.5 [&.drop-before::before]:[border-radius:1px] [&.drop-before::before]:[background:var(--accent)] [&.drop-before::before]:pointer-events-none [&.drop-before::before]:top-[-5px] [&.drop-after::after]:[content:''] [&.drop-after::after]:absolute [&.drop-after::after]:left-0 [&.drop-after::after]:right-0 [&.drop-after::after]:h-0.5 [&.drop-after::after]:[border-radius:1px] [&.drop-after::after]:[background:var(--accent)] [&.drop-after::after]:pointer-events-none [&.drop-after::after]:bottom-[-5px] p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) flex flex-col gap-2 relative bg-fill${dragFrom === index ? ' dragging' : ''}${dropAt === index ? ' drop-before' : ''}${dropAt === set.steps.length && index === set.steps.length - 1 ? ' drop-after' : ''}`}
                          key={step.id}
                          onDragOver={(event) => {
                            if (dragFrom === null) return
                            event.preventDefault()
                            const box = event.currentTarget.getBoundingClientRect()
                            setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1)
                          }}
                          onDrop={(event) => {
                            event.preventDefault()
                            dropStep()
                          }}
                          onDragEnd={endDrag}
                        >
                          <div className="settings-step-heading flex items-center gap-2">
                            <span
                              className="settings-step-grip [&:hover]:text-foreground [&:hover]:bg-hover [&:active]:[cursor:grabbing] inline-grid place-items-center w-[18px] h-[22px] flex-none ml-[-4px] text-muted-foreground cursor-grab rounded-(--radius-xs)"
                              role="button"
                              aria-label={t('Drag step {0} to reorder', { '0': index + 1 })}
                              title={t('Drag to reorder')}
                              draggable={!busy}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move'
                                event.dataTransfer.setData('text/plain', String(index))
                                const card = event.currentTarget.closest('.settings-step')
                                setRowDragImage(event, card)
                                setDragFrom(index)
                              }}
                              onDragEnd={endDrag}
                            >
                              <GripVertical size={14} />
                            </span>
                            <span className="settings-step-number w-[18px] flex-none text-muted-foreground text-caption text-center">
                              {index + 1}
                            </span>
                            <span className="settings-step-name flex-1 min-w-0 [overflow-wrap:anywhere]">
                              {modelStepName(step, scope.catalogs)}
                            </span>
                            <div className="settings-step-actions flex gap-0.5">
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                                title={t('Move step up')}
                                aria-label={t('Move step {0} up', { '0': index + 1 })}
                                disabled={busy || index === 0}
                                onClick={() => move(index, -1)}
                              >
                                <ArrowUp size={13} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                                title={t('Move step down')}
                                aria-label={t('Move step {0} down', { '0': index + 1 })}
                                disabled={busy || index === set.steps.length - 1}
                                onClick={() => move(index, 1)}
                              >
                                <ArrowDown size={13} />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                                title={t('Remove step')}
                                aria-label={t('Remove step {0}', { '0': index + 1 })}
                                disabled={busy || set.steps.length < 2}
                                onClick={() => updateSteps(set.steps.filter((entry) => entry.id !== step.id))}
                              >
                                <Trash2 size={13} />
                              </Button>
                            </div>
                          </div>
                          <div className="settings-step-controls grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3">
                            <label>
                              Model
                              <Dropdown
                                label={t('Step {0} model', { '0': index + 1 })}
                                value={key}
                                options={options}
                                disabled={busy}
                                onChange={(value) => {
                                  const entry = models.find((entry) => `${entry.provider}:${entry.id}` === value)
                                  if (entry)
                                    update({
                                      ...step,
                                      provider: entry.provider,
                                      model: entry.id,
                                      effort:
                                        step.effort && entry.efforts.includes(step.effort)
                                          ? step.effort
                                          : entry.defaultEffort,
                                    })
                                }}
                              />
                            </label>
                            <label>
                              {t('Effort')}
                              <Dropdown
                                label={t('Step {0} effort', { '0': index + 1 })}
                                value={
                                  step.effort ??
                                  (step.provider === 'claude-code' || step.provider === 'codex'
                                    ? model?.defaultEffort
                                    : null) ??
                                  ''
                                }
                                disabled={busy || !model?.efforts.length}
                                options={[
                                  ...(step.provider === 'claude-code' || step.provider === 'codex'
                                    ? []
                                    : [{ value: '', label: t('Default effort') }]),
                                  ...(model?.efforts ?? []).map((effort) => ({
                                    value: effort,
                                    label: effortDisplayName(effort, step.provider),
                                  })),
                                ]}
                                onChange={(effort) =>
                                  update({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })
                                }
                              />
                            </label>
                          </div>
                        </section>
                      )
                    })}
                  </div>
                  <div className="settings-set-footer [&_>_span]:ml-auto flex items-center gap-2">
                    <Button
                      variant="ghost"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
                      disabled={busy || set.steps.length >= 20}
                      onClick={() => updateSteps([...set.steps, { ...set.steps.at(-1)!, id: crypto.randomUUID() }])}
                    >
                      <Plus size={13} />
                      {t('Add step')}
                    </Button>
                    <span className="muted text-muted-foreground small text-caption">
                      {set.steps.length} {t(' steps · up to 20')}
                    </span>
                  </div>
                  <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between">
                    <Button
                      variant="ghost"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
                      disabled={busy}
                      onClick={() => setReset('models')}
                    >
                      <RotateCcw size={13} />
                      {t('Restore model sets')}
                    </Button>
                    <Button
                      variant="ghost"
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
                      disabled={busy}
                      onClick={() => {
                        setBusy(true)
                        void store
                          .reload()
                          .catch((reason) => setError(errorText(reason)))
                          .finally(() => setBusy(false))
                      }}
                    >
                      {t('Refresh available models')}
                    </Button>
                  </div>
                </div>
              </SettingsField>
            )}
            {pageKeys && (
              <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between">
                <Button
                  variant="ghost"
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover"
                  disabled={busy}
                  onClick={() => setReset(page)}
                >
                  <RotateCcw size={13} />
                  {t('Reset to defaults')}
                </Button>
              </div>
            )}
            <AlertDialog
              open={reset !== null}
              onOpenChange={(open) => {
                if (!open) setReset(null)
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {reset === 'sizes'
                      ? t('Reset layout sizes?')
                      : reset
                        ? t('Reset {0} to defaults?', {
                            '0': t(
                              reset === 'models'
                                ? 'Model sets'
                                : SETTINGS_SECTIONS.find((entry) => entry.id === reset)!.label,
                            ),
                          })
                        : ''}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {reset === 'sizes'
                      ? t(
                          'The sidebar width, editor/chat split and terminal height will return to their default sizes in every workspace. This applies immediately.',
                        )
                      : t(
                          'This replaces your changes in this section with the default settings. Choose Save changes to apply them.',
                        )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
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
                    }}
                  >
                    {t('Reset')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SettingsPage>
        </ModelSetsOverride>
      </AppSettingsOverride>
    </SettingsScopeContext.Provider>
  )
}
