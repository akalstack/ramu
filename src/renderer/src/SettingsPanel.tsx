import { SettingsRow } from '@/components/settings-row'
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog'
import { AppUpdates } from './AppUpdates'
import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { ProviderSettings } from './ProviderSettings'
import { providerName } from '../../shared/providers'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DEFAULT_APP_PREFERENCES, DEFAULT_SIDEBAR_WIDTH, type AppPreferences, type ModelPreferences, type ModelStep } from '../../shared/types'
import { GoalSettings } from './GoalSettings'
import { AdvisorSettings, FallbackSettings, SubagentSettings } from './FallbackSettings'
import { BackgroundControls } from './Automation'
import { Dropdown } from './Menu'
import { effortDisplayName, modelDisplayName, modelStepName, recommendedSets, useModelSets } from './ModelSets'
import { useAppSettings } from './AppSettings'
import { SETTINGS_SECTIONS, SettingsPage, type SettingsSection } from './SettingsPage'
import { accessName } from './AgentControls'
import { formatKeys } from './commands'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

export function SettingsPanel({ onClose, initialSection = 'appearance', shortcuts = [] }: { onClose: () => void; initialSection?: SettingsSection; shortcuts?: { title: string; category: string; keys: string }[] }) {
  const language = useLanguage()

  const app = useAppSettings()
  const [page, setPage] = useState<SettingsSection>(initialSection)
  useEffect(() => setPage(initialSection), [initialSection])
  const [appDraft, setAppDraft] = useState<AppPreferences>({ ...app.preferences })
  const store = useModelSets()
  const [draft, setDraft] = useState<ModelPreferences>(() => structuredClone(store.preferences))
  const [selected, setSelected] = useState(draft.defaultSetId)
  const [busy, setBusy] = useState(false)
  const ws = useWorkspace()
  const [reset, setReset] = useState<SettingsSection | 'sizes' | null>(null)
  const [sizesReset, setSizesReset] = useState(false)
  const [error, setError] = useState<string | null>(store.error)
  const set = draft.sets.find((entry) => entry.id === selected) ?? draft.sets[0]!
  const models = store.catalogs.flatMap((catalog) => catalog.models)
  const updateSteps = (steps: ModelStep[]) => setDraft((current) => {
    const next = { ...current, sets: current.sets.map((entry) => entry.id === set.id ? { ...entry, steps } : entry) }
    if (next.defaultSetId === set.id && !steps.some((step) => step.id === next.defaultStepId)) next.defaultStepId = steps[0]!.id
    return next
  })
  const update = (step: ModelStep) => updateSteps(set.steps.map((entry) => entry.id === step.id ? step : entry))
  // Drag a step by its grip to reorder; a line shows where it will land.
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const endDrag = () => { setDragFrom(null); setDropAt(null) }
  const dropStep = () => {
    if (dragFrom !== null && dropAt !== null) {
      const steps = [...set.steps], moved = steps.splice(dragFrom, 1)[0]!
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
    setBusy(true); setError(null)
    try {
      if (draft.sets.some((entry) => !entry.name.trim())) throw new Error(t('Name each set before saving.'))
      await Promise.all([app.save(appDraft), store.save({ ...draft, sets: draft.sets.map((entry) => ({ ...entry, steps: entry.steps.map((step) => ({ ...step, name: modelStepName(step, store.catalogs) })) })) })]);
      if (JSON.stringify(appDraft.providerBinaries) !== JSON.stringify(app.preferences.providerBinaries)) void store.reload().catch(() => {})
      onClose()
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const sizes = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))
  const toggle = (key: 'previewTabs' | 'lintWhileEditing' | 'hideEmptyStaged' | 'autoPull' | 'defaultAutoFallback' | 'includeTabContext' | 'recapsEnabled' | 'notifyAgentDone' | 'resumeChatsOnRestart' | 'asyncQuestions' | 'showUsageLimits' | 'keepAwake' | 'fontSmoothing', title: string, description: string) => <SettingsRow className="settings-toggle"><span><strong>{t(title)}</strong><span className="muted text-muted-foreground block block small text-caption">{t(description)}</span></span><Switch aria-label={t(title)} checked={appDraft[key]} disabled={busy} onCheckedChange={(checked) => setAppDraft({ ...appDraft, [key]: checked })} /></SettingsRow>
  const resetKeys: Partial<Record<typeof page, (keyof AppPreferences)[]>> = {
    updates: ['appUpdateChecks', 'appAutoUpdate'],
    providers: ['providerBinaries', 'providerUpdateChecks', 'showUsageLimits'],
    automation: ['keepAwake', 'keepAwakeWhen', 'notifyAgentDone', 'resumeChatsOnRestart', 'asyncQuestions', 'autoBackgroundSeconds', 'recapsEnabled', 'recapTime'],
    appearance: ['language', 'accent', 'fontFamily', 'fontSize', 'fontSmoothing', 'sidebarWidth'],
    editor: ['previewTabs', 'lintWhileEditing', 'editorFontSize', 'terminalFontSize', 'terminalTabPosition'],
    access: ['defaultAccess', 'defaultAutoFallback', 'fallback'],
    subagents: ['subagents'],
    advisor: ['advisor'],
    goals: ['goals'],
    git: ['busyMessageAction', 'includeTabContext', 'pullMode', 'autoPull', 'commitStyle', 'commitInstructions', 'hideEmptyStaged', 'recentChats'],
  }
  const pageKeys = resetKeys[page]
  const resetPage = (section: SettingsSection) => {
    const keys = resetKeys[section]
    if (!keys) return
    setAppDraft((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, DEFAULT_APP_PREFERENCES[key]])),
      // Account identities are recovery metadata, not disposable appearance settings.
      ...(section === 'providers' ? { providerBinaries: Object.fromEntries(Object.entries(current.providerBinaries).map(([provider, config]) => [provider, { binary: '', accounts: config?.accounts, accountId: 'default', autoUpdate: false }])) } : {}),
    }))
  }
  return <SettingsPage section={page} onSection={setPage} busy={busy} error={error} onSave={() => void save()} onClose={() => { if (!busy) onClose() }}>
    {page === 'updates' && <AppUpdates value={appDraft} onChange={setAppDraft} />}
    {page === 'providers' && <><ProviderSettings value={appDraft} onChange={setAppDraft} /><div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">{toggle('showUsageLimits', 'Show usage limits', 'Show the 5-hour and weekly plan usage at the bottom of the sidebar, or in the status bar when the sidebar is hidden.')}</div></>}
    {page === 'automation' && <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      {toggle('notifyAgentDone', 'Agent notifications', 'Tell me when an agent finishes, needs input, or fails. Ramu shows a system notification when it is in the background and a toast when it is open. Clicking either opens the chat.')}
      {toggle('resumeChatsOnRestart', 'Continue chats after restart', 'Automatically continue unfinished chats when Ramu’s background service restarts. Completed chats and chats you stopped stay stopped.')}
      <SettingsRow className=""><span><strong>{t("Keep working while commands run")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Agents start long commands such as dev servers and test suites in the background. A Claude command still running after this long is moved there for them. Off leaves it to you: use Run in background on a running command.")}</span></span><Dropdown label={t("Keep working while commands run")} value={String(appDraft.autoBackgroundSeconds)} options={[{ value: '0', label: t("Off") }, { value: '30', label: t("After 30 seconds") }, { value: '60', label: t("After 1 minute") }, { value: '120', label: t("After 2 minutes") }, { value: '300', label: t("After 5 minutes") }]} onChange={(value) => setAppDraft({ ...appDraft, autoBackgroundSeconds: Number(value) })} /></SettingsRow>
      {toggle('asyncQuestions', 'Keep working while asking questions', 'Agents can ask and continue independent work. Related answers are sent together; work that needs an answer waits. Existing pending questions keep their behavior when this is changed.')}
      {toggle('recapsEnabled', 'Daily recaps', 'Review unfinished work, decisions, and background results on Home. Automatic generation uses model tokens.')}
      <SettingsRow className=""><span><strong>{t("Generate daily at")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("When the daily recap is written, using your system timezone.")}</span></span><Input aria-label={t("Generate daily at")} type="time" value={appDraft.recapTime} onChange={(e) => setAppDraft({ ...appDraft, recapTime: e.target.value })} /></SettingsRow>
      {toggle('keepAwake', 'Keep computer awake', 'On macOS, prevent idle sleep while the local service is running, even without login startup installed. Display sleep and manually putting the computer to sleep still work. Enabled on the first background-service installation; you can turn it off anytime.')}
      {appDraft.keepAwake && <SettingsRow className=""><span><strong>{t('When to keep awake')}</strong><span className="muted text-muted-foreground block block small text-caption">{t('Plugged in only saves battery. Choose both power sources to keep working after unplugging.')}</span></span><Dropdown label={t('When to keep awake')} value={appDraft.keepAwakeWhen} options={[{ value: 'plugged-in', label: t('Plugged in only (recommended)') }, { value: 'always', label: t('Plugged in and on battery') }]} onChange={(when) => setAppDraft({ ...appDraft, keepAwakeWhen: when === 'always' ? 'always' : 'plugged-in' })} /></SettingsRow>}
      <BackgroundControls onInstalled={() => setAppDraft((current) => ({ ...current, keepAwake: true }))} />
    </div>}
    {page === 'appearance'  && <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      <SettingsRow className=""><span><strong>{t("Language")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Choose your preferred language. Changes apply after saving.")}</span></span><Dropdown label={t("App language")} value={appDraft.language} options={[{ value: 'system', label: t("Follow system") }, { value: 'id', label: 'Bahasa Indonesia' }, { value: 'en', label: 'English' }]} onChange={(language) => setAppDraft({ ...appDraft, language: language as AppPreferences['language'] })} /></SettingsRow>
      <p className="muted text-muted-foreground">{t("Graphite surfaces with a clear primary accent.")}</p>
      <SettingsRow className=""><span><strong>{t("Primary color")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Used for primary actions, activity, and links.")}</span></span><Dropdown label={t("Primary color")} value={appDraft.accent} options={[{ value: 'blue', label: t("Blue") }, { value: 'violet', label: t("Violet") }, { value: 'teal', label: t("Teal") }]} onChange={(accent) => setAppDraft({ ...appDraft, accent: accent as AppPreferences['accent'] })} /></SettingsRow>
      <SettingsRow className=""><span><strong>{t("Interface font")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("System uses the native macOS font.")}</span></span><Dropdown label={t("Interface font")} value={appDraft.fontFamily} options={[{ value: 'system', label: t("System") }, { value: 'geist', label: 'Geist' }]} onChange={(fontFamily) => setAppDraft({ ...appDraft, fontFamily: fontFamily as AppPreferences['fontFamily'] })} /></SettingsRow>
      <SettingsRow className=""><strong>{t("Interface font size")}</strong><Dropdown label={t("Interface font size")} value={String(appDraft.fontSize)} options={sizes(12, 18)} onChange={(value) => setAppDraft({ ...appDraft, fontSize: Number(value) })} /></SettingsRow>
      {toggle('fontSmoothing', 'Crisper text', 'Render text with lighter grayscale antialiasing. Turn off to use the heavier macOS text rendering.')}
      <SettingsRow className=""><span><strong>{t("Layout sizes")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Return the sidebar, editor/chat split and terminal height to their default sizes in every workspace.")}</span></span><Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={() => setReset('sizes')}>{sizesReset ? t("Sizes reset") : t("Reset sizes")}</Button></SettingsRow>
      <div className="settings-appearance-sample flex items-center gap-2.5 p-3.5 [border:1px_solid_transparent] rounded-(--radius-s) flex-wrap mt-4 bg-fill"><span className={`accent-swatch w-4 h-4 rounded-full accent-${appDraft.accent} [&.accent-blue]:bg-[#0a84ff] [&.accent-violet]:bg-[#7652d4] [&.accent-teal]:bg-[#087f7b]`} /><span>{t("Project workspace")}</span><span className="muted text-muted-foreground">{t("Preview of your primary accent")}</span></div>
    </div>}
    {page === 'editor' && <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      {toggle('previewTabs', 'Preview tabs', 'Single-click previews a file. Double-click or edit to keep it open.')}
      {toggle('lintWhileEditing', 'Lint while editing', 'Show problems from the project\'s ESLint, Biome or Oxlint as you type. When off, files are checked when opened and saved.')}
      <SettingsRow className=""><strong>{t("Editor font size")}</strong><Dropdown label={t("Editor font size")} value={String(appDraft.editorFontSize)} options={sizes(12, 22)} onChange={(value) => setAppDraft({ ...appDraft, editorFontSize: Number(value) })} /></SettingsRow>
      <SettingsRow className=""><strong>{t("Terminal font size")}</strong><Dropdown label={t("Terminal font size")} value={String(appDraft.terminalFontSize)} options={sizes(12, 22)} onChange={(value) => setAppDraft({ ...appDraft, terminalFontSize: Number(value) })} /></SettingsRow>
      <SettingsRow className=""><span><strong>{t("Default terminal tabs")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Existing checkouts keep their own layout.")}</span></span><Dropdown label={t("Default terminal tabs")} value={appDraft.terminalTabPosition} options={[{ value: 'top', label: t("Across the top") }, { value: 'right', label: t("On the right") }]} onChange={(value) => setAppDraft({ ...appDraft, terminalTabPosition: value === 'right' ? 'right' : 'top' })} /></SettingsRow>
      <p className="muted text-muted-foreground small text-caption">{t("Files and terminals are shared by chats in the same checkout. Isolated worktrees keep separate state.")}</p>
    </div>}
    {page === 'access' && <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0"><SettingsRow className=""><span><strong>{t("Default access")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Applied to new chats. Existing chats keep their access mode.")}</span></span><Dropdown label={t("Default access")} value={appDraft.defaultAccess} options={(['edits', 'auto', 'full'] as const).map((value) => ({ value, label: accessName(value) }))} onChange={(value) => setAppDraft({ ...appDraft, defaultAccess: value as AppPreferences['defaultAccess'] })} /></SettingsRow>{toggle('defaultAutoFallback', 'Automatic provider fallback', 'Continue with another provider when a usage limit is reached. Applies to new chats.')}<FallbackSettings value={appDraft} onChange={setAppDraft} busy={busy} /></div>}
    {page === 'subagents' && <SubagentSettings value={appDraft} onChange={setAppDraft} busy={busy} />}
    {page === 'goals' && <GoalSettings value={appDraft.goals} onChange={(goals) => setAppDraft({ ...appDraft, goals })} />}
    {page === 'advisor' && <AdvisorSettings value={appDraft} onChange={setAppDraft} busy={busy} />}
    {page === 'git' && <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0"><SettingsRow className=""><span><strong>{t("Messages while working")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Steer shows your message above the box and sends it after the active tools finish. Queue keeps it there until the whole turn finishes. ⌘Enter / Ctrl+Enter uses the opposite action.")}</span></span><Dropdown label={t("Messages while working")} value={appDraft.busyMessageAction} options={[{ value: 'queue', label: t("Queue") }, { value: 'steer', label: t("Steer") }]} onChange={(value) => setAppDraft({ ...appDraft, busyMessageAction: value === 'steer' ? 'steer' : 'queue' })} /></SettingsRow>{toggle('includeTabContext', 'Include open tabs as context', 'Each message includes the active file or selected text. Other open tabs are listed by path so the agent can read them when relevant. Files you @mention or drop into the chat include their content.')}{toggle('autoPull', 'Automatic pull', 'After automatic fetch, fast-forward the repository selected in the status bar when it is clean. Skip while an agent is working, files are unsaved, branches have diverged, or a Git operation is in progress. Runs every 3 minutes and on window focus.')}<SettingsRow className=""><span><strong>{t("Pull behavior")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("How Pull and Sync bring in remote commits. All manual pull modes automatically stash and restore tracked working changes. Rebase replays your local commits on top for a linear history. If a rebase or merge stops on a conflict, Source Control offers Continue and Abort.")}</span></span><Dropdown label={t("Pull behavior")} value={appDraft.pullMode} options={[{ value: 'rebase', label: 'Rebase' }, { value: 'merge', label: 'Merge' }, { value: 'ff-only', label: t("Fast-forward only") }]} onChange={(value) => setAppDraft({ ...appDraft, pullMode: value === 'merge' || value === 'ff-only' ? value : 'rebase' })} /></SettingsRow><SettingsRow className=""><span><strong>{t("Commit messages")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("How AI drafts commit messages. Conventional follows Conventional Commits (feat(scope): subject). Repository convention copies the style of the repository's recent commits. Custom uses your instructions.")}</span></span><Dropdown label={t("Commit message style")} value={appDraft.commitStyle} options={[{ value: 'conventional', label: t("Conventional commits") }, { value: 'repository', label: t("Repository convention") }, { value: 'custom', label: t("Custom instructions") }]} onChange={(value) => setAppDraft({ ...appDraft, commitStyle: value === 'repository' || value === 'custom' ? value : 'conventional' })} /></SettingsRow>{appDraft.commitStyle === 'custom' && <SettingsRow className="settings-stack"><span><strong>{t("Commit instructions")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.")}</span></span><Textarea rows={4} maxLength={2000} value={appDraft.commitInstructions} aria-label={t("Commit message instructions")} placeholder={t("Describe how commit messages should be written")} onChange={(event) => setAppDraft({ ...appDraft, commitInstructions: event.target.value })} /></SettingsRow>}{toggle('hideEmptyStaged', 'Hide empty Staged section', 'Show Staged only when the index contains changes.')}<SettingsRow className=""><span><strong>{t("Recent chats per project")}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Older chats stay available under Show more.")}</span></span><Dropdown label={t("Recent chats per project")} value={String(appDraft.recentChats)} options={Array.from({ length: 18 }, (_, index) => ({ value: String(index + 3), label: String(index + 3) }))} onChange={(value) => setAppDraft({ ...appDraft, recentChats: Number(value) })} /></SettingsRow><p className="muted text-muted-foreground small text-caption">{t("Discard and delete actions show their affected files before running. Explorer deletion uses Trash.")}</p></div>}
    {page === 'shortcuts' && <div className="settings-shortcuts"><p className="muted text-muted-foreground">{t("Current application shortcuts. Editor shortcuts also follow VS Code conventions.")}</p>{[{ title: t("Send / default queue or steer action"), category: t("Composer"), keys: 'Enter' }, { title: t("Reverse queue / steer action"), category: t("Composer"), keys: 'mod+Enter' }, { title: t("New line"), category: t("Composer"), keys: 'shift+Enter' }, ...shortcuts].map((shortcut) => <div className="settings-shortcut [&_kbd]:flex-none flex items-center gap-4 justify-between p-[9px_0] [border-bottom:1px_solid_var(--line)]" key={`${shortcut.title}:${shortcut.keys}`}><span><span className="muted text-muted-foreground small text-caption">{shortcut.category} · </span>{shortcut.title}</span><Kbd>{formatKeys(shortcut.keys)}</Kbd></div>)}</div>}
    {page === 'models' &&
    <div className="model-settings [&_label]:flex [&_label]:flex-col [&_label]:gap-[5px] [&_label]:text-muted-foreground [&_label]:text-caption [&_label]:min-w-0 [&_.dropdown-trigger]:w-full [&_.dropdown-trigger]:text-foreground flex flex-col gap-4">
      <div className="settings-intro"><h4>{t("Model sets")}</h4><p className="muted text-muted-foreground">{t("Build the steps shown on the selection bar.")}</p></div>
      <label>{t("Default bar mode")}<Dropdown label={t("Default bar mode")} value={draft.defaultBarMode ?? 'model'} options={[{ value: 'model', label: t("Model + effort") }, { value: 'effort', label: t("Effort only") }]} onChange={(mode) => setDraft({ ...draft, defaultBarMode: mode === 'effort' ? 'effort' : 'model' })} disabled={busy} /></label>
      <div className="settings-defaults grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3">
        <label>{t("Default set")}<Dropdown label={t("Default model set")} value={draft.defaultSetId} options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || t("Unnamed set") }))} onChange={(id) => { const entry = draft.sets.find((entry) => entry.id === id)!; setDraft({ ...draft, defaultSetId: id, defaultStepId: entry.steps[0]!.id }) }} disabled={busy} /></label>
        <label>{t("Default step")}<Dropdown label={t("Default model step")} value={draft.defaultStepId} options={draft.sets.find((entry) => entry.id === draft.defaultSetId)!.steps.map((step) => ({ value: step.id, label: modelStepName(step, store.catalogs) }))} onChange={(id) => setDraft({ ...draft, defaultStepId: id })} disabled={busy} /></label>
      </div>
      <div className="settings-set-toolbar [&_>_.dropdown-trigger]:flex-1 [&_>_.dropdown-trigger]:min-w-0 flex items-center gap-2">
        <Dropdown label={t("Edit model set")} value={set.id} options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || t("Unnamed set") }))} onChange={setSelected} disabled={busy} />
        <Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy || draft.sets.length >= 20} onClick={() => { const id = crypto.randomUUID(); const steps = [{ ...set.steps[0]!, id: crypto.randomUUID() }]; setDraft({ ...draft, sets: [...draft.sets, { id, name: 'New set', steps }] }); setSelected(id) }}><Plus size={13} />{t("Add set")}</Button>
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Remove set")} aria-label={t("Remove model set")} disabled={busy || draft.sets.length < 2} onClick={() => { const sets = draft.sets.filter((entry) => entry.id !== set.id); const fallback = sets[0]!; setDraft({ ...draft, sets, defaultSetId: draft.defaultSetId === set.id ? fallback.id : draft.defaultSetId, defaultStepId: draft.defaultSetId === set.id ? fallback.steps[0]!.id : draft.defaultStepId }); setSelected(fallback.id) }}><Trash2 size={13} /></Button>
      </div>
      <label className="settings-set-name">{t("Set name")}<Input value={set.name} maxLength={80} disabled={busy} onChange={(event) => setDraft({ ...draft, sets: draft.sets.map((entry) => entry.id === set.id ? { ...entry, name: event.target.value } : entry) })} /></label>
      <div className="settings-steps flex flex-col gap-2">{set.steps.map((step, index) => {
        const model = models.find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
        const key = `${step.provider}:${step.model}`
        const options = models.map((entry) => ({ value: `${entry.provider}:${entry.id}`, label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}` }))
        if (!options.some((option) => option.value === key)) options.unshift({ value: key, label: step.model ? t("{0} · Unavailable", { "0": step.model }) : t("{0} default", { "0": providerName(step.provider) }) })
        return <section className={`settings-step [&.dragging]:[opacity:0.45] [&.drop-before::before]:[content:''] [&.drop-before::before]:absolute [&.drop-before::before]:left-0 [&.drop-before::before]:right-0 [&.drop-before::before]:h-0.5 [&.drop-before::before]:[border-radius:1px] [&.drop-before::before]:[background:var(--accent)] [&.drop-before::before]:pointer-events-none [&.drop-before::before]:top-[-5px] [&.drop-after::after]:[content:''] [&.drop-after::after]:absolute [&.drop-after::after]:left-0 [&.drop-after::after]:right-0 [&.drop-after::after]:h-0.5 [&.drop-after::after]:[border-radius:1px] [&.drop-after::after]:[background:var(--accent)] [&.drop-after::after]:pointer-events-none [&.drop-after::after]:bottom-[-5px] p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) flex flex-col gap-2 relative bg-fill${dragFrom === index ? ' dragging' : ''}${dropAt === index ? ' drop-before' : ''}${dropAt === set.steps.length && index === set.steps.length - 1 ? ' drop-after' : ''}`} key={step.id}
          onDragOver={(event) => { if (dragFrom === null) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1) }}
          onDrop={(event) => { event.preventDefault(); dropStep() }}
          onDragEnd={endDrag}>
          <div className="settings-step-heading flex items-center gap-2"><span className="settings-step-grip [&:hover]:text-foreground [&:hover]:bg-hover [&:active]:[cursor:grabbing] inline-grid place-items-center w-[18px] h-[22px] flex-none ml-[-4px] text-muted-foreground cursor-grab rounded-(--radius-xs)" role="button" aria-label={t("Drag step {0} to reorder", { "0": index + 1 })} title={t("Drag to reorder")} draggable={!busy} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); const card = event.currentTarget.closest('.settings-step'); if (card) event.dataTransfer.setDragImage(card, 24, 20); setDragFrom(index) }} onDragEnd={endDrag}><GripVertical size={14} /></span><span className="settings-step-number w-[18px] flex-none text-muted-foreground text-caption text-center">{index + 1}</span><span className="settings-step-name flex-1 min-w-0 [overflow-wrap:anywhere]">{modelStepName(step, store.catalogs)}</span><div className="settings-step-actions flex gap-0.5">
            <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Move step up")} aria-label={t("Move step {0} up", { "0": index + 1 })} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
            <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Move step down")} aria-label={t("Move step {0} down", { "0": index + 1 })} disabled={busy || index === set.steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
            <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Remove step")} aria-label={t("Remove step {0}", { "0": index + 1 })} disabled={busy || set.steps.length < 2} onClick={() => updateSteps(set.steps.filter((entry) => entry.id !== step.id))}><Trash2 size={13} /></Button>
          </div></div>
          <div className="settings-step-controls grid [grid-template-columns:minmax(0,_1fr)_minmax(0,_1fr)] gap-3"><label>Model<Dropdown label={t("Step {0} model", { "0": index + 1 })} value={key} options={options} disabled={busy} onChange={(value) => { const entry = models.find((entry) => `${entry.provider}:${entry.id}` === value); if (entry) update({ ...step, provider: entry.provider, model: entry.id, effort: step.effort && entry.efforts.includes(step.effort) ? step.effort : entry.defaultEffort }) }} /></label>
          <label>{t("Effort")}<Dropdown label={t("Step {0} effort", { "0": index + 1 })} value={step.effort ?? (step.provider === 'claude-code' || step.provider === 'codex' ? model?.defaultEffort : null) ?? ''} disabled={busy || !model?.efforts.length} options={[...(step.provider === 'claude-code' || step.provider === 'codex' ? [] : [{ value: '', label: t("Default effort") }]), ...(model?.efforts ?? []).map((effort) => ({ value: effort, label: effortDisplayName(effort, step.provider) }))]} onChange={(effort) => update({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })} /></label></div>
        </section>
      })}</div>
      <div className="settings-set-footer [&_>_span]:ml-auto flex items-center gap-2"><Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy || set.steps.length >= 20} onClick={() => updateSteps([...set.steps, { ...set.steps.at(-1)!, id: crypto.randomUUID() }])}><Plus size={13} />{t("Add step")}</Button><span className="muted text-muted-foreground small text-caption">{set.steps.length} {t(" steps · up to 20")}</span></div>
      <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between"><Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy} onClick={() => setReset('models')}><RotateCcw size={13} />{t("Restore defaults")}</Button><Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy} onClick={() => { setBusy(true); void store.reload().catch((reason) => setError(errorText(reason))).finally(() => setBusy(false)) }}>{t("Refresh available models")}</Button></div>
    </div>}
    {pageKeys && <div className="settings-maintenance flex items-center gap-2 pt-3 justify-between"><Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover" disabled={busy} onClick={() => setReset(page)}><RotateCcw size={13} />{t("Reset to defaults")}</Button></div>}
    <AlertDialog open={reset !== null} onOpenChange={(open) => { if (!open) setReset(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{reset === 'sizes' ? t('Reset layout sizes?') : reset ? t('Reset {0} to defaults?', { '0': t(SETTINGS_SECTIONS.find((entry) => entry.id === reset)!.label) }) : ''}</AlertDialogTitle>
          <AlertDialogDescription>{reset === 'sizes' ? t('The sidebar width, editor/chat split and terminal height will return to their default sizes in every workspace. This applies immediately.') : t('This replaces your changes in this section with the default settings. Choose Save changes to apply them.')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => {
            if (reset && reset !== 'models' && reset !== 'sizes') resetPage(reset)
            if (reset === 'models') { const next = recommendedSets(store.catalogs); setDraft(next); setSelected(next.defaultSetId) }
            if (reset === 'sizes') {
              ws.resetLayoutSizes()
              setAppDraft((current) => ({ ...current, sidebarWidth: DEFAULT_SIDEBAR_WIDTH }))
              void app.save({ ...app.preferences, sidebarWidth: DEFAULT_SIDEBAR_WIDTH }).then(() => setSizesReset(true), (reason) => setError(errorText(reason)))
            }
            setReset(null)
          }}>{t('Reset')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsPage>
}
