import { ProviderSettings } from './ProviderSettings'
import { providerName } from '../../shared/providers'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ArrowDown, ArrowUp, GripVertical, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { DEFAULT_APP_PREFERENCES, DEFAULT_SIDEBAR_WIDTH, type AppPreferences, type ModelPreferences, type ModelStep } from '../../shared/types'
import { AiCompletionSettings } from './AiCompletionSettings'
import { BackgroundControls } from './Automation'
import { Dropdown } from './Menu'
import { effortDisplayName, modelDisplayName, modelStepName, recommendedSets, useModelSets } from './ModelSets'
import { useAppSettings } from './AppSettings'
import { SettingsPage, type SettingsSection } from './SettingsPage'
import { accessName } from './AgentControls'
import { formatKeys } from './commands'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

export function SettingsPanel({ onClose, initialSection = 'appearance', shortcuts = [] }: { onClose: () => void; initialSection?: SettingsSection; shortcuts?: { title: string; category: string; keys: string }[] }) {
  const app = useAppSettings()
  const [page, setPage] = useState<SettingsSection>(initialSection)
  const [appDraft, setAppDraft] = useState<AppPreferences>({ ...app.preferences })
  const store = useModelSets()
  const [draft, setDraft] = useState<ModelPreferences>(() => structuredClone(store.preferences))
  const [selected, setSelected] = useState(draft.defaultSetId)
  const [busy, setBusy] = useState(false)
  const ws = useWorkspace()
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
      if (draft.sets.some((entry) => !entry.name.trim())) throw new Error('Name each set before saving.')
      await Promise.all([app.save(appDraft), store.save({ ...draft, sets: draft.sets.map((entry) => ({ ...entry, steps: entry.steps.map((step) => ({ ...step, name: modelStepName(step, store.catalogs) })) })) })]);
      if (JSON.stringify(appDraft.providerBinaries) !== JSON.stringify(app.preferences.providerBinaries)) void store.reload().catch(() => {})
      onClose()
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  const sizes = (min: number, max: number) => Array.from({ length: max - min + 1 }, (_, index) => ({ value: String(min + index), label: `${min + index} px` }))
  const toggle = (key: 'previewTabs' | 'formatOnSave' | 'lintWhileEditing' | 'languageServers' | 'hideEmptyStaged' | 'defaultAutoFallback' | 'includeTabContext' | 'recapsEnabled' | 'notifyAgentDone', title: string, description: string) => <div className="settings-row settings-toggle"><span><strong>{title}</strong><span className="muted block small">{description}</span></span><Switch aria-label={title} checked={appDraft[key]} disabled={busy} onCheckedChange={(checked) => setAppDraft({ ...appDraft, [key]: checked })} /></div>
  const resetKeys: Partial<Record<typeof page, (keyof AppPreferences)[]>> = {
    providers: ['providerBinaries', 'providerUpdateChecks'],
    automation: ['notifyAgentDone', 'recapsEnabled', 'recapTime'],
    appearance: ['accent', 'fontFamily', 'fontSize', 'sidebarSide', 'sidebarWidth'],
    editor: ['previewTabs', 'formatOnSave', 'languageServers', 'aiCompletion', 'lintWhileEditing', 'defaultChatDockOpen', 'editorFontSize', 'terminalFontSize', 'terminalTabPosition'],
    access: ['defaultAccess', 'defaultAutoFallback'],
    git: ['busyMessageAction', 'includeTabContext', 'pullMode', 'commitStyle', 'commitInstructions', 'hideEmptyStaged', 'recentChats'],
  }
  const pageKeys = resetKeys[page]
  const resetPage = () => { if (pageKeys) setAppDraft((current) => ({ ...current, ...Object.fromEntries(pageKeys.map((key) => [key, DEFAULT_APP_PREFERENCES[key]])) })) }
  return <SettingsPage section={page} onSection={setPage} busy={busy} error={error} onSave={() => void save()} onClose={() => { if (!busy) onClose() }}>
    {page === 'providers' && <ProviderSettings value={appDraft} onChange={setAppDraft} />}
    {page === 'automation' && <div className="settings-form">
      {toggle('notifyAgentDone', 'Agent notifications', 'Tell me when an agent finishes, needs input, or fails. Ramu shows a system notification when it is in the background and a toast when it is open. Clicking either opens the chat.')}
      {toggle('recapsEnabled', 'Daily recaps', 'Review unfinished work, decisions, and background results on Home. Automatic generation uses model tokens.')}
      <div className="settings-row"><span><strong>Generate daily at</strong><span className="muted block small">When the daily recap is written, using your system timezone.</span></span><Input aria-label="Generate daily at" type="time" value={appDraft.recapTime} onChange={(e) => setAppDraft({ ...appDraft, recapTime: e.target.value })} /></div>
      <BackgroundControls />
    </div>}
    {page === 'appearance'  && <div className="settings-form">
      <p className="muted">Graphite surfaces with a clear primary accent.</p>
      <div className="settings-row"><span><strong>Primary color</strong><span className="muted block small">Used for primary actions, activity, and links.</span></span><Dropdown label="Primary color" value={appDraft.accent} options={[{ value: 'blue', label: 'Blue' }, { value: 'violet', label: 'Violet' }, { value: 'teal', label: 'Teal' }]} onChange={(accent) => setAppDraft({ ...appDraft, accent: accent as AppPreferences['accent'] })} /></div>
      <div className="settings-row"><span><strong>Interface font</strong><span className="muted block small">System uses the native macOS font.</span></span><Dropdown label="Interface font" value={appDraft.fontFamily} options={[{ value: 'system', label: 'System' }, { value: 'geist', label: 'Geist' }]} onChange={(fontFamily) => setAppDraft({ ...appDraft, fontFamily: fontFamily as AppPreferences['fontFamily'] })} /></div>
      <div className="settings-row"><strong>Interface font size</strong><Dropdown label="Interface font size" value={String(appDraft.fontSize)} options={sizes(12, 18)} onChange={(value) => setAppDraft({ ...appDraft, fontSize: Number(value) })} /></div>
      <div className="settings-row"><span><strong>Sidebar position</strong><span className="muted block small">Moves the activity icons and sidebar to the other side of the window. Drag the sidebar edge to resize it.</span></span><Dropdown label="Sidebar position" value={appDraft.sidebarSide} options={[{ value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }]} onChange={(value) => setAppDraft({ ...appDraft, sidebarSide: value === 'right' ? 'right' : 'left' })} /></div>
      <div className="settings-row"><span><strong>Layout sizes</strong><span className="muted block small">Return the sidebar, editor/chat split and terminal height to their default sizes in every workspace.</span></span><Button onClick={() => { ws.resetLayoutSizes(); setAppDraft((current) => ({ ...current, sidebarWidth: DEFAULT_SIDEBAR_WIDTH })); void app.save({ ...app.preferences, sidebarWidth: DEFAULT_SIDEBAR_WIDTH }).then(() => setSizesReset(true)) }}>{sizesReset ? 'Sizes reset' : 'Reset sizes'}</Button></div>
      <div className="settings-appearance-sample"><span className={`accent-swatch accent-${appDraft.accent}`} /><span>Project workspace</span><span className="muted">Preview of your primary accent</span></div>
    </div>}
    {page === 'editor' && <div className="settings-form">
      {toggle('previewTabs', 'Preview tabs', 'Single-click previews a file. Double-click or edit to keep it open.')}
      {toggle('formatOnSave', 'Format on save', 'Format with the project\'s own formatter (Prettier, Biome or Oxfmt) before saving. Without one, Monaco formats supported languages.')}
      {toggle('languageServers', 'Language servers', 'Project-aware completion, hover, go to definition and type errors from the project\'s own TypeScript.')}
      <AiCompletionSettings value={appDraft.aiCompletion} busy={busy} onChange={(aiCompletion) => setAppDraft({ ...appDraft, aiCompletion })} />
      {toggle('lintWhileEditing', 'Lint while editing', 'Show problems from the project\'s ESLint, Biome or Oxlint as you type. When off, files are checked when opened and saved.')}
      <div className="settings-row"><span><strong>Default chat sidebar</strong><span className="muted block small">Beside an open editor. Checkouts with a saved sidebar state keep that choice.</span></span><Dropdown label="Default chat sidebar" value={appDraft.defaultChatDockOpen ? 'open' : 'closed'} options={[{ value: 'open', label: 'Open / expanded' }, { value: 'closed', label: 'Closed / collapsed' }]} onChange={(value) => setAppDraft({ ...appDraft, defaultChatDockOpen: value === 'open' })} disabled={busy} /></div>
      <div className="settings-row"><strong>Editor font size</strong><Dropdown label="Editor font size" value={String(appDraft.editorFontSize)} options={sizes(12, 22)} onChange={(value) => setAppDraft({ ...appDraft, editorFontSize: Number(value) })} /></div>
      <div className="settings-row"><strong>Terminal font size</strong><Dropdown label="Terminal font size" value={String(appDraft.terminalFontSize)} options={sizes(12, 22)} onChange={(value) => setAppDraft({ ...appDraft, terminalFontSize: Number(value) })} /></div>
      <div className="settings-row"><span><strong>Default terminal tabs</strong><span className="muted block small">Existing checkouts keep their own layout.</span></span><Dropdown label="Default terminal tabs" value={appDraft.terminalTabPosition} options={[{ value: 'top', label: 'Across the top' }, { value: 'right', label: 'On the right' }]} onChange={(value) => setAppDraft({ ...appDraft, terminalTabPosition: value === 'right' ? 'right' : 'top' })} /></div>
      <p className="muted small">Files and terminals are shared by chats in the same checkout. Isolated worktrees keep separate state.</p>
    </div>}
    {page === 'access' && <div className="settings-form"><div className="settings-row"><span><strong>Default access</strong><span className="muted block small">Applied to new chats. Existing chats keep their access mode.</span></span><Dropdown label="Default access" value={appDraft.defaultAccess} options={(['ask', 'edits', 'auto', 'full'] as const).map((value) => ({ value, label: accessName(value) }))} onChange={(value) => setAppDraft({ ...appDraft, defaultAccess: value as AppPreferences['defaultAccess'] })} /></div>{toggle('defaultAutoFallback', 'Automatic provider fallback', 'Continue with another provider when a usage limit is reached. Applies to new chats.')}</div>}
    {page === 'git' && <div className="settings-form"><div className="settings-row"><span><strong>Messages while working</strong><span className="muted block small">Steer shows your message above the box and sends it after the active tools finish. Queue keeps it there until the whole turn finishes. ⌘Enter / Ctrl+Enter uses the opposite action.</span></span><Dropdown label="Messages while working" value={appDraft.busyMessageAction} options={[{ value: 'queue', label: 'Queue' }, { value: 'steer', label: 'Steer' }]} onChange={(value) => setAppDraft({ ...appDraft, busyMessageAction: value === 'steer' ? 'steer' : 'queue' })} /></div>{toggle('includeTabContext', 'Include open tabs as context', 'Each message includes the active file or selected text. Other open tabs are listed by path so the agent can read them when relevant. Files you @mention or drop into the chat include their content.')}<div className="settings-row"><span><strong>Pull behavior</strong><span className="muted block small">How Pull and Sync bring in remote commits. Rebase replays your local commits on top for a linear history. If a rebase or merge stops on a conflict, Source Control offers Continue and Abort.</span></span><Dropdown label="Pull behavior" value={appDraft.pullMode} options={[{ value: 'rebase', label: 'Rebase' }, { value: 'merge', label: 'Merge' }, { value: 'ff-only', label: 'Fast-forward only' }]} onChange={(value) => setAppDraft({ ...appDraft, pullMode: value === 'merge' || value === 'ff-only' ? value : 'rebase' })} /></div><div className="settings-row"><span><strong>Commit messages</strong><span className="muted block small">How AI drafts commit messages. Conventional follows Conventional Commits (feat(scope): subject). Repository convention copies the style of the repository's recent commits. Custom uses your instructions.</span></span><Dropdown label="Commit message style" value={appDraft.commitStyle} options={[{ value: 'conventional', label: 'Conventional commits' }, { value: 'repository', label: 'Repository convention' }, { value: 'custom', label: 'Custom instructions' }]} onChange={(value) => setAppDraft({ ...appDraft, commitStyle: value === 'repository' || value === 'custom' ? value : 'conventional' })} /></div>{appDraft.commitStyle === 'custom' && <div className="settings-row settings-stack"><span><strong>Commit instructions</strong><span className="muted block small">For example: start with a ticket key like ABC-123, write in English, keep the subject under 50 characters.</span></span><Textarea rows={4} maxLength={2000} value={appDraft.commitInstructions} aria-label="Commit message instructions" placeholder="Describe how commit messages should be written" onChange={(event) => setAppDraft({ ...appDraft, commitInstructions: event.target.value })} /></div>}{toggle('hideEmptyStaged', 'Hide empty Staged section', 'Show Staged only when the index contains changes.')}<div className="settings-row"><span><strong>Recent chats per project</strong><span className="muted block small">Older chats stay available under Show more.</span></span><Dropdown label="Recent chats per project" value={String(appDraft.recentChats)} options={Array.from({ length: 18 }, (_, index) => ({ value: String(index + 3), label: String(index + 3) }))} onChange={(value) => setAppDraft({ ...appDraft, recentChats: Number(value) })} /></div><p className="muted small">Discard and delete actions show their affected files before running. Explorer deletion uses Trash.</p></div>}
    {page === 'shortcuts' && <div className="settings-shortcuts"><p className="muted">Current application shortcuts. Editor shortcuts also follow VS Code conventions.</p>{[{ title: 'Send / default queue or steer action', category: 'Composer', keys: 'Enter' }, { title: 'Reverse queue / steer action', category: 'Composer', keys: 'mod+Enter' }, { title: 'New line', category: 'Composer', keys: 'shift+Enter' }, ...shortcuts].map((shortcut) => <div className="settings-shortcut" key={`${shortcut.title}:${shortcut.keys}`}><span><span className="muted small">{shortcut.category} · </span>{shortcut.title}</span><kbd>{formatKeys(shortcut.keys)}</kbd></div>)}</div>}
    {page === 'models' &&
    <div className="model-settings">
      <div className="settings-intro"><h4>Model sets</h4><p className="muted">Build the steps shown on the selection bar.</p></div>
      <label>Default bar mode<Dropdown label="Default bar mode" value={draft.defaultBarMode ?? 'model'} options={[{ value: 'model', label: 'Model + effort' }, { value: 'effort', label: 'Effort only' }]} onChange={(mode) => setDraft({ ...draft, defaultBarMode: mode === 'effort' ? 'effort' : 'model' })} disabled={busy} /></label>
      <div className="settings-defaults">
        <label>Default set<Dropdown label="Default model set" value={draft.defaultSetId} options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || 'Unnamed set' }))} onChange={(id) => { const entry = draft.sets.find((entry) => entry.id === id)!; setDraft({ ...draft, defaultSetId: id, defaultStepId: entry.steps[0]!.id }) }} disabled={busy} /></label>
        <label>Default step<Dropdown label="Default model step" value={draft.defaultStepId} options={draft.sets.find((entry) => entry.id === draft.defaultSetId)!.steps.map((step) => ({ value: step.id, label: modelStepName(step, store.catalogs) }))} onChange={(id) => setDraft({ ...draft, defaultStepId: id })} disabled={busy} /></label>
      </div>
      <div className="settings-set-toolbar">
        <Dropdown label="Edit model set" value={set.id} options={draft.sets.map((entry) => ({ value: entry.id, label: entry.name || 'Unnamed set' }))} onChange={setSelected} disabled={busy} />
        <Button className="ghost" disabled={busy || draft.sets.length >= 20} onClick={() => { const id = crypto.randomUUID(); const steps = [{ ...set.steps[0]!, id: crypto.randomUUID() }]; setDraft({ ...draft, sets: [...draft.sets, { id, name: 'New set', steps }] }); setSelected(id) }}><Plus size={13} />Add set</Button>
        <Button className="ghost icon small-icon" title="Remove set" aria-label="Remove model set" disabled={busy || draft.sets.length < 2} onClick={() => { const sets = draft.sets.filter((entry) => entry.id !== set.id); const fallback = sets[0]!; setDraft({ ...draft, sets, defaultSetId: draft.defaultSetId === set.id ? fallback.id : draft.defaultSetId, defaultStepId: draft.defaultSetId === set.id ? fallback.steps[0]!.id : draft.defaultStepId }); setSelected(fallback.id) }}><Trash2 size={13} /></Button>
      </div>
      <label className="settings-set-name">Set name<Input value={set.name} maxLength={80} disabled={busy} onChange={(event) => setDraft({ ...draft, sets: draft.sets.map((entry) => entry.id === set.id ? { ...entry, name: event.target.value } : entry) })} /></label>
      <div className="settings-steps">{set.steps.map((step, index) => {
        const model = models.find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
        const key = `${step.provider}:${step.model}`
        const options = models.map((entry) => ({ value: `${entry.provider}:${entry.id}`, label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}` }))
        if (!options.some((option) => option.value === key)) options.unshift({ value: key, label: step.model ? `${step.model} · Unavailable` : `${providerName(step.provider)} default` })
        return <section className={`settings-step${dragFrom === index ? ' dragging' : ''}${dropAt === index ? ' drop-before' : ''}${dropAt === set.steps.length && index === set.steps.length - 1 ? ' drop-after' : ''}`} key={step.id}
          onDragOver={(event) => { if (dragFrom === null) return; event.preventDefault(); const box = event.currentTarget.getBoundingClientRect(); setDropAt(event.clientY < box.top + box.height / 2 ? index : index + 1) }}
          onDrop={(event) => { event.preventDefault(); dropStep() }}
          onDragEnd={endDrag}>
          <div className="settings-step-heading"><span className="settings-step-grip" role="button" aria-label={`Drag step ${index + 1} to reorder`} title="Drag to reorder" draggable={!busy} onDragStart={(event) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)); const card = event.currentTarget.closest('.settings-step'); if (card) event.dataTransfer.setDragImage(card, 24, 20); setDragFrom(index) }} onDragEnd={endDrag}><GripVertical size={14} /></span><span className="settings-step-number">{index + 1}</span><span className="settings-step-name">{modelStepName(step, store.catalogs)}</span><div className="settings-step-actions">
            <Button className="ghost icon small-icon" title="Move step up" aria-label={`Move step ${index + 1} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}><ArrowUp size={13} /></Button>
            <Button className="ghost icon small-icon" title="Move step down" aria-label={`Move step ${index + 1} down`} disabled={busy || index === set.steps.length - 1} onClick={() => move(index, 1)}><ArrowDown size={13} /></Button>
            <Button className="ghost icon small-icon" title="Remove step" aria-label={`Remove step ${index + 1}`} disabled={busy || set.steps.length < 2} onClick={() => updateSteps(set.steps.filter((entry) => entry.id !== step.id))}><Trash2 size={13} /></Button>
          </div></div>
          <div className="settings-step-controls"><label>Model<Dropdown label={`Step ${index + 1} model`} value={key} options={options} disabled={busy} onChange={(value) => { const entry = models.find((entry) => `${entry.provider}:${entry.id}` === value); if (entry) update({ ...step, provider: entry.provider, model: entry.id, effort: step.effort && entry.efforts.includes(step.effort) ? step.effort : entry.defaultEffort }) }} /></label>
          <label>Effort<Dropdown label={`Step ${index + 1} effort`} value={step.effort ?? (step.provider === 'claude-code' || step.provider === 'codex' ? model?.defaultEffort : null) ?? ''} disabled={busy || !model?.efforts.length} options={[...(step.provider === 'claude-code' || step.provider === 'codex' ? [] : [{ value: '', label: 'Default effort' }]), ...(model?.efforts ?? []).map((effort) => ({ value: effort, label: effortDisplayName(effort, step.provider) }))]} onChange={(effort) => update({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })} /></label></div>
        </section>
      })}</div>
      <div className="settings-set-footer"><Button className="ghost" disabled={busy || set.steps.length >= 20} onClick={() => updateSteps([...set.steps, { ...set.steps.at(-1)!, id: crypto.randomUUID() }])}><Plus size={13} />Add step</Button><span className="muted small">{set.steps.length} steps · up to 20</span></div>
      <div className="settings-maintenance"><Button className="ghost" disabled={busy} onClick={() => { const next = recommendedSets(store.catalogs); setDraft(next); setSelected(next.defaultSetId) }}><RotateCcw size={13} />Restore defaults</Button><Button className="ghost" disabled={busy} onClick={() => { setBusy(true); void store.reload().catch((reason) => setError(errorText(reason))).finally(() => setBusy(false)) }}>Refresh available models</Button></div>
    </div>}
    {pageKeys && <div className="settings-maintenance"><Button className="ghost" disabled={busy} onClick={resetPage}><RotateCcw size={13} />Reset to defaults</Button></div>}
  </SettingsPage>
}
