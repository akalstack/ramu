import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, CloudDownload, GitCommitHorizontal, RefreshCcw, Trash2, ChevronDown, ChevronRight, GitCompareArrows, Minus, MoreHorizontal, Plus, RefreshCw, Sparkles, Undo2, FileText, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type CommitDraft, type GitStash, type GitBranchInfo, type GitCommit, type GitStatus, type GitStatusEntry, type PullMode, type RepositoryBinding } from '../../../shared/types'
import { useAppSettings } from '../AppSettings'
import { BranchPicker, SyncButton } from '../GitControls'
import { AgentControls, providerName } from '../AgentControls'
import { invoke, ramu, copyText } from '../ipc'
import { Dialog, Dropdown, Menu, useContextMenu } from '../Menu'
import { errorText } from '../TaskPane'
import { notifyError } from '../Notifications'
import { isWorktreeCtx, useWorkspace } from '../workspace'
import { useModelSets } from '../ModelSets'
import { CommitHistoryRow } from './CommitHistoryRow'
import { NoTask } from './ExplorerPanel'

const GIT_HEIGHT_KEY = 'ramu.scmGitHeight'
const GIT_HEIGHT_DEFAULT = 280
const GIT_HEIGHT_MIN = 120
// Room always left for the repository list above the Git section.
const SCM_MIN_HEIGHT = 160

export function ScmPanel() {
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  const bindings = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready' && !b.folderOnly) : []
  // With several repositories every one is listed and can be folded; the first starts open.
  const [open, setOpen] = useState<Record<string, boolean>>({})
  // The Git section (branches, commits, stashes) exists once, pinned below the list, for the repository last opened.
  const [gitHost, setGitHost] = useState<HTMLElement | null>(null)
  const [gitRepoId, setGitRepoId] = useState<string | null>(null)
  const [gitHeight, setGitHeight] = useState(() => Number(localStorage.getItem(GIT_HEIGHT_KEY)) || GIT_HEIGHT_DEFAULT)
  const panelRef = useRef<HTMLDivElement>(null)
  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const handle = event.currentTarget
    const startY = event.clientY, startHeight = gitHeight
    const max = () => Math.max(GIT_HEIGHT_MIN, (panelRef.current?.clientHeight ?? 600) - SCM_MIN_HEIGHT)
    let latest = startHeight
    handle.setPointerCapture(event.pointerId)
    handle.classList.add('is-resizing')
    const move = (e: PointerEvent) => { latest = Math.min(max(), Math.max(GIT_HEIGHT_MIN, startHeight + startY - e.clientY)); setGitHeight(latest) }
    const end = () => {
      handle.classList.remove('is-resizing')
      handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', end); handle.removeEventListener('pointercancel', end)
      localStorage.setItem(GIT_HEIGHT_KEY, String(latest))
    }
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end)
  }
  if (!taskId) return <NoTask />
  const many = bindings.length > 1
  const isOpen = (repoId: string, index: number) => open[repoId] ?? index === 0
  const gitRepo = bindings.find((b) => b.repoId === gitRepoId) ?? bindings.find((b, index) => isOpen(b.repoId, index)) ?? bindings[0]
  return <div className="panel scm-panel" ref={panelRef}>
    <header className="panel-title scm-title">Source Control</header>
    {bindings.length === 0 ? <p className="muted hint">No repository available.</p>
      : many ? <>
        <div className="scm-repos">{bindings.map((b, index) => {
          const expanded = isOpen(b.repoId, index)
          return <RepositoryControl key={`${taskId}:${b.repoId}`} taskId={taskId} binding={b} compact collapsed={!expanded} gitHost={gitHost} showGit={gitRepo?.repoId === b.repoId} gitRepos={bindings} onGitRepo={setGitRepoId} onToggle={() => { setOpen((current) => ({ ...current, [b.repoId]: !expanded })); if (!expanded) setGitRepoId(b.repoId) }} />
        })}</div>
        <div className="scm-git-resizer" role="separator" aria-orientation="horizontal" aria-label="Resize Git section" title="Drag to resize · double-click to reset" onPointerDown={startResize} onDoubleClick={() => { setGitHeight(GIT_HEIGHT_DEFAULT); localStorage.removeItem(GIT_HEIGHT_KEY) }} />
        <div className="scm-git-host" ref={setGitHost} style={{ height: gitHeight }} />
      </>
      : <RepositoryControl key={`${taskId}:${bindings[0]!.repoId}`} taskId={taskId} binding={bindings[0]!} />}
  </div>
}

const PULL_NAME: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

const LETTER: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', untracked: 'U', unmerged: '!' }

function RepositoryControl({ taskId, binding, compact = false, collapsed = false, gitHost = null, showGit = true, gitRepos = [], onGitRepo, onToggle }: { taskId: string; binding: RepositoryBinding; compact?: boolean; collapsed?: boolean; gitHost?: HTMLElement | null; showGit?: boolean; gitRepos?: RepositoryBinding[]; onGitRepo?: (repoId: string) => void; onToggle?: () => void }) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [stashes, setStashes] = useState<GitStash[]>([])
  const [operationName, setOperationName] = useState('')
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<CommitDraft | null>(null)
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_AGENT_SETTINGS)
  const reportError = useCallback((message: string) => notifyError(message, `Git · ${binding.repoName}`), [binding.repoName])
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [confirmation, setConfirmation] = useState<{ kind: 'discard'; paths: string[] } | { kind: 'undo'; oid: string; title: string } | { kind: 'branch' } | { kind: 'stash'; staged?: boolean } | { kind: 'delete-branch'; name: string } | { kind: 'drop-stash'; oid: string; title: string } | null>(null)
  const [contextEntry, setContextEntry] = useState<{ entry: GitStatusEntry; staged: boolean } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(true)
  const [stagedOpen, setStagedOpen] = useState(true)
  const [changesOpen, setChangesOpen] = useState(true)

  const load = useCallback(async () => {
    const results = await Promise.allSettled([invoke('git.status', taskId, binding.repoId), invoke('git.history', taskId, binding.repoId), invoke('git.branches', taskId, binding.repoId), invoke('git.stashes', taskId, binding.repoId)])
    if (results[0].status === 'fulfilled') setStatus(results[0].value)
    if (results[1].status === 'fulfilled') setCommits(results[1].value)
    if (results[2].status === 'fulfilled') setBranches(results[2].value)
    if (results[3].status === 'fulfilled') setStashes(results[3].value)
    for (const result of results) if (result.status === 'rejected') reportError(errorText(result.reason))
  }, [taskId, binding.repoId, reportError])
  useEffect(() => {
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = ramu.on('fs:changed', ({ cwd }) => {
      if (cwd === binding.cwd) { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
    })
    const refresh = () => void load()
    window.addEventListener('ramu:git-updated', refresh)
    return () => { off(); clearTimeout(timer); window.removeEventListener('ramu:git-updated', refresh) }
  }, [load, binding.cwd])
  useEffect(() => {
    let cancelled = false
    const view = ws.taskUi[taskId]?.views.find((v) => v.id === ws.taskUi[taskId]?.activeAgentViewId)
    if (view?.kind === 'agent') void invoke('agent.get', view.sessionId).then((s) => { if (!cancelled) setSettings(s.settings) })
    const off = ramu.on('agent:event', ({ sessionId, event }) => {
      if (view?.kind === 'agent' && sessionId === view.sessionId && event.kind === 'settings') setSettings(event.settings)
    })
    return () => { cancelled = true; off() }
  }, [taskId, ws.taskUi[taskId]?.activeAgentViewId])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn() } catch (e) { reportError(errorText(e)) }
    finally { setBusy(false); void load(); window.dispatchEvent(new Event('ramu:git-updated')) }
  }
  const requireSaved = () => {
    if (Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved editor buffers before changing files or branches.')
  }
  const staged = status?.entries.filter((e) => e.staged && e.staged !== 'unmerged') ?? []
  const conflicts = status?.entries.filter((e) => e.staged === 'unmerged') ?? []
  const unstaged = status?.entries.filter((e) => e.unstaged && e.unstaged !== 'unmerged') ?? []
  const canStash = !!status?.oid && !!status.entries.length && !conflicts.length && !status.operation
  const { initialSettings } = useModelSets()
  const [resolving, setResolving] = useState(false)
  // Conflicts get their own chat in this checkout, so the transcript is a record of what was decided and why.
  const resolveWithAi = async () => {
    const project = ws.projectOf(taskId)
    if (!project || !conflicts.length) return
    setResolving(true)
    let created: string | null = null
    try {
      requireSaved()
      const context = ws.workspaceOf(taskId)
      const isolated = isWorktreeCtx(context) ? context.slice('worktree:'.length) : undefined
      const kind = status?.operation ?? 'merge'
      const prompt = [
        `Resolve ${conflicts.length} ${kind} ${conflicts.length === 1 ? 'conflict' : 'conflicts'} in ${binding.repoName}.`,
        '', '<ramu-context>',
        `Repository: ${binding.repoName} (${binding.cwd})`,
        'Conflicted files:', ...conflicts.map((entry) => `- ${entry.path}`), '',
        'For each file: read it, work out what each side intended (git log/diff if unclear), edit it into one correct result with no conflict markers, and git add it.',
        'Run cheap quick checks (typecheck or nearby tests) if available.',
        `Do not commit, continue, abort or skip the ${kind}, and do not push. I will review and continue from Source Control.`,
        'Reply briefly: one line per file on how it was resolved, plus anything you were unsure about. No preamble.',
        '</ramu-context>',
      ].join('\n')
      const task = await invoke('tasks.create', { projectId: project.id, title: `Resolve ${kind} conflicts in ${binding.repoName}`, mode: isolated ? 'worktree' : 'current', workspaceId: isolated })
      created = task.id
      const session = await invoke('agent.start', task.id, prompt, settings.model ? settings : initialSettings, [], [])
      created = null
      await ws.refresh()
      ws.openTask(task.id)
      ws.openView(task.id, { kind: 'agent', sessionId: session.id })
    } catch (e) {
      if (created) { await invoke('tasks.delete', created, false).catch(() => {}); await ws.refresh().catch(() => {}) }
      reportError(errorText(e))
    } finally { setResolving(false) }
  }
  const sync = () => void run(async () => { requireSaved(); await invoke('git.sync', taskId, binding.repoId) })
  const pull = (mode?: PullMode) => void run(async () => { requireSaved(); await invoke('git.pull', taskId, binding.repoId, mode) })
  const popStash = (stash: GitStash) => run(async () => { requireSaved(); await invoke('git.popStash', taskId, binding.repoId, stash.oid) })
  const applyStash = (stash: GitStash) => run(async () => { requireSaved(); await invoke('git.applyStash', taskId, binding.repoId, stash.oid) })
  const [gitTab, setGitTab] = useState<'commits' | 'stashes'>('commits')
  // In a multi-repository list the Git section is portalled into the single pinned slot; nothing renders until that slot mounts.
  const inGitSlot = (node: ReactNode) => compact ? gitHost && createPortal(node, gitHost) : node
  const copyPath = async (path: string) => { try { await copyText(path) } catch (reason) { reportError(errorText(reason)) } }
  const fileContext = useContextMenu('Source control file actions', contextEntry ? [
    { key: 'diff', label: 'Open changes', onSelect: () => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: contextEntry.entry.path, staged: contextEntry.staged }) },
    { key: 'open', label: <><FileText size={14} />Open file</>, disabled: (contextEntry.staged ? contextEntry.entry.staged : contextEntry.entry.unstaged) === 'deleted', onSelect: () => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: contextEntry.entry.path }) },
    { key: 'stage', label: <>{contextEntry.staged ? <Minus size={14} /> : <Plus size={14} />}{contextEntry.staged ? 'Unstage changes' : 'Stage changes'}</>, disabled: busy, onSelect: () => void run(() => invoke(contextEntry.staged ? 'git.unstage' : 'git.stage', taskId, binding.repoId, [contextEntry.entry.path])) },
    ...(!contextEntry.staged ? [{ key: 'discard', label: <><Undo2 size={14} />Discard changes…</>, danger: true, disabled: busy, onSelect: () => setConfirmation({ kind: 'discard', paths: [contextEntry.entry.path] }) }] : []),
    { key: 'copy', label: <><Copy size={14} />Copy relative path</>, onSelect: () => void copyPath(contextEntry.entry.path) },
  ] : [])
  const row = (e: GitStatusEntry, isStaged: boolean) => <div key={`${isStaged}:${e.path}`} className="change-row" onContextMenu={(event) => { setContextEntry({ entry: e, staged: isStaged }); fileContext.onContextMenu(event) }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { setContextEntry({ entry: e, staged: isStaged }); fileContext.onKeyDown(event) } }}>
    <Button className="change-name" title={e.origPath ? `${e.origPath} → ${e.path}` : e.path} onClick={() => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: e.path, staged: isStaged })}><span className="change-base">{e.path.slice(e.path.lastIndexOf('/') + 1)}</span>{e.path.includes('/') && <span className="change-dir">{e.path.slice(0, e.path.lastIndexOf('/'))}</span>}</Button>
    <span className="change-actions">
      {!isStaged && <Button className="ghost icon small-icon" disabled={busy} aria-label={`Discard changes to ${e.path}`} title="Discard changes" onClick={() => setConfirmation({ kind: 'discard', paths: [e.path] })}><Undo2 size={13} /></Button>}
      <Button className="ghost icon small-icon" disabled={busy} aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${e.path}`} title={isStaged ? 'Unstage' : 'Stage'} onClick={() => void run(() => invoke(isStaged ? 'git.unstage' : 'git.stage', taskId, binding.repoId, [e.path]))}>{isStaged ? <Minus size={13} /> : <Plus size={13} />}</Button>
    </span>
    <span className={`letter ${isStaged ? e.staged : e.unstaged}`} title={e.origPath ? 'Renamed' : undefined}>{LETTER[(isStaged ? e.staged : e.unstaged) ?? '']}</span>
  </div>
  const draftMessage = async () => {
    setGenerating(true)
    try {
      const value = await invoke('git.generateCommit', taskId, binding.repoId, settings)
      setDraft(value); setMessage(value.message)
      return value
    } catch (e) { reportError(errorText(e)); return null }
    finally { setGenerating(false) }
  }
  const generate = () => void draftMessage()
  // With no message typed, Commit drafts one from the staged changes first and commits it as written.
  const commit = async () => {
    let text = message, fingerprint = draft?.fingerprint
    if (!text.trim()) {
      const value = await draftMessage()
      if (!value?.message.trim()) return
      text = value.message; fingerprint = value.fingerprint
    }
    await run(async () => {
      await invoke('git.commit', taskId, binding.repoId, text, fingerprint)
      setMessage(''); setDraft(null)
    })
  }

  return <div className={`scm-repo-body${compact ? ' compact' : ''}${collapsed ? ' collapsed' : ''}`}>
    {fileContext.menu}
    {confirmation && <Dialog title={confirmation.kind === 'discard' ? 'Discard changes?' : confirmation.kind === 'undo' ? 'Undo last commit?' : confirmation.kind === 'branch' ? 'Create branch' : confirmation.kind === 'stash' ? (confirmation.staged ? 'Stash staged changes' : 'Stash changes') : confirmation.kind === 'delete-branch' ? 'Delete branch?' : 'Delete stash?'} confirmLabel={confirmation.kind === 'discard' ? 'Discard changes' : confirmation.kind === 'undo' ? 'Undo commit' : confirmation.kind === 'branch' ? 'Create branch' : confirmation.kind === 'stash' ? 'Stash' : 'Delete'} danger={confirmation.kind === 'discard' || confirmation.kind === 'drop-stash' || confirmation.kind === 'delete-branch'} busy={busy} onCancel={() => { if (!busy) setConfirmation(null) }} onConfirm={() => void run(async () => {
      requireSaved()
      if (confirmation.kind === 'discard') await invoke('git.discard', taskId, binding.repoId, confirmation.paths)
      else if (confirmation.kind === 'undo') { await invoke('git.undoCommit', taskId, binding.repoId, confirmation.oid); setMessage(confirmation.title); setDraft(null) }
      else if (confirmation.kind === 'branch') await invoke('git.createBranch', taskId, binding.repoId, operationName.trim())
      else if (confirmation.kind === 'stash') await invoke('git.stash', taskId, binding.repoId, operationName.trim(), confirmation.staged)
      else if (confirmation.kind === 'delete-branch') await invoke('git.deleteBranch', taskId, binding.repoId, confirmation.name)
      else await invoke('git.dropStash', taskId, binding.repoId, confirmation.oid)
      setConfirmation(null)
    })}>
      {confirmation.kind === 'discard' ? <><p>Tracked edits return to their staged version. Untracked files move to Trash. Staged changes are kept.</p><pre className="confirm-paths">{confirmation.paths.join('\n')}</pre></> : confirmation.kind === 'undo' ? <><p>The last local commit will be undone. Its files stay in your checkout and index.</p><p className="strong">{confirmation.title}</p></> : confirmation.kind === 'branch' || confirmation.kind === 'stash' ? <><label className="explorer-name-field">{confirmation.kind === 'branch' ? 'Branch name' : 'Stash message'}<Input autoFocus value={operationName} onChange={(event) => setOperationName(event.target.value)} /></label><p className="muted small">{confirmation.kind === 'branch' ? 'Creates and switches to a new local branch. The checkout must be clean.' : (confirmation.kind === 'stash' && confirmation.staged ? 'Saves only staged changes and removes them from the checkout. Unstaged edits stay.' : 'Preserves tracked and untracked changes. Ignored files stay in place.')}</p></> : <><p>{confirmation.kind === 'delete-branch' ? 'Deletes the local branch only. Git will refuse an unmerged branch or one in use by a worktree.' : 'This saved stash will be permanently removed.'}</p><p className="strong">{confirmation.kind === 'delete-branch' ? confirmation.name : confirmation.title}</p></>}
    </Dialog>}
    <div className="scm-content">
      <section className="scm-repo">
        <div className="scm-section-head">
          {onToggle ? <Button type="button" className="scm-repo-toggle grow" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span className="strong">{binding.repoName}</span>{collapsed && !!status?.entries.length && <span className="scm-count">{status.entries.length}</span>}</Button> : <><ChevronDown size={14} /><span className="grow strong">{binding.repoName}</span></>}
          <Button className="ghost icon small-icon" title="Stash all changes…" aria-label="Stash all changes" disabled={busy || !canStash} onClick={() => { setOperationName(''); setConfirmation({ kind: 'stash' }) }}><Archive size={13} /></Button>
          <Button className="ghost icon small-icon" title="Refresh source control" aria-label="Refresh source control" onClick={() => void load()}><RefreshCw size={13} /></Button>
          <Menu disabled={busy} label="Source control actions" icon={<MoreHorizontal size={14} />} className="ghost icon small-icon" align="end" items={[
            { key: 'stage-all', label: <><Plus size={14} />Stage all changes</>, disabled: !unstaged.length, onSelect: () => void run(() => invoke('git.stage', taskId, binding.repoId, unstaged.map((entry) => entry.path))) },
            { key: 'unstage-all', label: <><Minus size={14} />Unstage all changes</>, disabled: !staged.length, onSelect: () => void run(() => invoke('git.unstage', taskId, binding.repoId, staged.map((entry) => entry.path))) },
            { key: 'discard-all', label: <><Undo2 size={14} />Discard all unstaged changes…</>, danger: true, disabled: !unstaged.length, onSelect: () => setConfirmation({ kind: 'discard', paths: unstaged.map((entry) => entry.path) }) },
            { key: 'undo-commit', label: <><Undo2 size={14} />Undo last commit…</>, disabled: commits.length < 2 || !!status?.upstream && !status.ahead || !!status?.detached || !!conflicts.length, onSelect: () => setConfirmation({ kind: 'undo', oid: commits[0]!.oid, title: commits[0]!.subject }) },
            { key: 'open-all', label: 'Open all changes', disabled: !status?.entries.length, onSelect: () => status?.entries.filter((entry) => entry.staged !== 'unmerged').forEach((entry) => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: entry.path, staged: !!entry.staged && !entry.unstaged })) },
            { key: 'branches-sep', separator: true },
            { key: 'create-branch', label: 'Create branch…', onSelect: () => { setOperationName(''); setConfirmation({ kind: 'branch' }) } },
            { key: 'delete-branch', label: 'Delete local branch', disabled: !branches.some((branch) => !branch.current && !branch.worktree), submenu: branches.filter((branch) => !branch.current && !branch.worktree).map((branch) => ({ key: branch.name, label: branch.name, onSelect: () => setConfirmation({ kind: 'delete-branch', name: branch.name }) })) },
            { key: 'stash-sep', separator: true },
            { key: 'stash', label: <><Archive size={14} />Stash all changes…</>, disabled: !canStash, onSelect: () => { setOperationName(''); setConfirmation({ kind: 'stash' }) } },
            { key: 'stash-staged', label: <><Archive size={14} />Stash staged changes…</>, disabled: !canStash || !staged.length, onSelect: () => { setOperationName(''); setConfirmation({ kind: 'stash', staged: true }) } },
            { key: 'pop-latest', label: <><ArchiveRestore size={14} />Pop latest stash</>, disabled: !stashes.length, onSelect: () => void popStash(stashes[0]!) },
            { key: 'pop-stash', label: 'Pop stash', disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => void popStash(stash) })) },
            { key: 'apply-stash', label: 'Apply stash', disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => void applyStash(stash) })) },
            { key: 'drop-stash', label: 'Delete stash', disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => setConfirmation({ kind: 'drop-stash', oid: stash.oid, title: stash.subject }) })) },
            { key: 'sep', separator: true },
            { key: 'sync', label: <><RefreshCcw size={14} />{status?.upstream ? 'Sync changes' : 'Publish branch'}</>, disabled: !status?.branch || !!status.operation, onSelect: sync },
            { key: 'pull', label: <><ArrowDown size={14} />Pull ({PULL_NAME[preferences.pullMode]})</>, disabled: !!status?.operation, onSelect: () => pull() },
            { key: 'pull-with', label: 'Pull with', disabled: !!status?.operation, submenu: (['rebase', 'merge', 'ff-only'] as const).filter((mode) => mode !== preferences.pullMode).map((mode) => ({ key: mode, label: PULL_NAME[mode], onSelect: () => pull(mode) })) },
            { key: 'push', label: <><ArrowUp size={14} />{status?.upstream ? 'Push' : 'Publish branch'}</>, disabled: !!status?.operation, onSelect: () => void run(() => invoke('git.push', taskId, binding.repoId)) },
            { key: 'fetch', label: <><ArrowDown size={14} />Fetch</>, onSelect: () => void run(() => invoke('git.fetch', taskId, binding.repoId)) },
          ]} />
        </div>
        {status?.operation && <div className="scm-operation" role="status">
          <span>{status.operation === 'rebase' ? 'Rebase in progress.' : 'Merge in progress.'} {conflicts.length ? `Resolve ${conflicts.length} conflicted ${conflicts.length === 1 ? 'file' : 'files'}, stage them, then continue.` : 'Conflicts are resolved and staged.'}</span>
          <div className="scm-operation-actions">
            {!!conflicts.length && <Button className="small" disabled={busy || resolving} onClick={() => void resolveWithAi()}><Sparkles size={13} />{resolving ? 'Starting…' : 'Resolve with AI'}</Button>}
            <Button className="primary small" disabled={busy || !!conflicts.length} onClick={() => void run(() => invoke('git.continueOperation', taskId, binding.repoId))}>Continue</Button>
            <Button className="small" disabled={busy} onClick={() => void run(() => invoke('git.abortOperation', taskId, binding.repoId))}>Abort {status.operation}</Button>
          </div>
        </div>}
        <div className="commit-input-wrap">
          <Textarea className="commit-msg" rows={2} value={message} placeholder={`Message for ${binding.repoName} (leave empty to auto-generate with AI)`} aria-label={`Commit message for ${binding.repoName}`} onChange={(e) => { setMessage(e.target.value); if (!e.target.value.trim()) setDraft(null) }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && staged.length && !conflicts.length && !busy && !generating) void commit() }} />
          <Button className="ghost icon small-icon commit-ai" title="Draft a commit message from staged changes" aria-label={`AI commit message for ${binding.repoName}`} disabled={busy || generating || !staged.length || !!conflicts.length} onClick={generate}><Sparkles size={14} className={generating ? 'shimmer' : ''} /></Button>
        </div>
        <Button className="scm-commit primary" aria-label={`Commit ${staged.length} staged`} disabled={busy || generating || !staged.length || !!conflicts.length} title={message.trim() ? undefined : 'Drafts a message with AI, then commits'} onClick={() => void commit()}><Check size={14} />{generating ? 'Drafting message…' : busy ? 'Working…' : 'Commit'}</Button>
        {status && !staged.length && !status.operation && status.branch && status.remote && (!status.upstream || status.ahead > 0 || status.behind > 0) && <SyncButton status={status} busy={busy} pullMode={preferences.pullMode} className="scm-sync" showLabel onSync={sync} />}
        {draft && <div className="muted small ai-draft-label">Drafted with {providerName(draft.provider)} · Review before committing.</div>}
        <Collapsible className="scm-ai-settings"><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronRight size={13} />AI message settings</CollapsibleTrigger><CollapsibleContent><div className="composer-controls"><AgentControls settings={settings} onChange={setSettings} disabled={generating} showAccess={false} /></div></CollapsibleContent></Collapsible>
        {!!conflicts.length && <><div className="sub-title warn"><span>Merge Changes ({conflicts.length})</span>{!status?.operation && <Button className="ghost small" disabled={busy || resolving} onClick={() => void resolveWithAi()}><Sparkles size={12} />{resolving ? 'Starting…' : 'Resolve with AI'}</Button>}</div>{conflicts.map((e) => <div key={e.path} className="change-row"><Button className="change-name" onClick={() => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path })}>{e.path}</Button><Button className="icon" disabled={busy} aria-label={`Mark ${e.path} resolved`} onClick={() => void run(() => invoke('git.stage', taskId, binding.repoId, [e.path]))}><Check size={13} /></Button></div>)}</>}
        {(!preferences.hideEmptyStaged || !!staged.length) && <><div className="sub-title"><Button className="scm-group-toggle" aria-expanded={stagedOpen} onClick={() => setStagedOpen((open) => !open)}><ChevronRight size={13} className={stagedOpen ? 'caret open' : 'caret'} />Staged <span className="scm-count">{staged.length}</span></Button>{!!staged.length && <Button className="ghost icon small-icon" aria-label="Unstage all" title="Unstage all" disabled={busy} onClick={() => void run(() => invoke('git.unstage', taskId, binding.repoId, staged.map((e) => e.path)))}><Minus size={13} /></Button>}</div>
        {stagedOpen && staged.map((e) => row(e, true))}</>}
        <div className="sub-title"><Button className="scm-group-toggle" aria-expanded={changesOpen} onClick={() => setChangesOpen((open) => !open)}><ChevronRight size={13} className={changesOpen ? 'caret open' : 'caret'} />Changes <span className="scm-count">{unstaged.length}</span></Button>{!!unstaged.length && <Button className="ghost icon small-icon" aria-label="Stage all" title="Stage all" disabled={busy} onClick={() => void run(() => invoke('git.stage', taskId, binding.repoId, unstaged.map((e) => e.path)))}><Plus size={13} /></Button>}</div>
        {changesOpen && unstaged.map((e) => row(e, false))}
        {!status?.entries.length && status && <p className="muted small scm-empty">No changes in this checkout.</p>}
      </section>
    </div>
    {showGit && inGitSlot(<Tabs value={gitTab} onValueChange={(value) => setGitTab(value as 'commits' | 'stashes')} render={<section />} className={`git-inspector${historyOpen ? '' : ' collapsed'}`}>
      <div className="git-inspector-head">
        <Button className="git-inspector-heading" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}><ChevronRight size={13} className={historyOpen ? 'caret open' : 'caret'} />Git</Button>
        {gitHost && <Dropdown label="Switch repository" value={binding.repoId} className="git-repo-picker" options={gitRepos.map((repo) => ({ value: repo.repoId, label: repo.repoName }))} onChange={(repoId) => onGitRepo?.(repoId)} />}
      </div>
      {historyOpen && <>
        <div className="git-toolbar">
          <TabsList className="git-tabs" aria-label="Git view">
            <TabsTrigger value="commits" className="ghost icon small-icon git-tab" aria-label="Commits" title="Commits"><GitCommitHorizontal size={14} /></TabsTrigger>
            <TabsTrigger value="stashes" className="ghost icon small-icon git-tab" aria-label={`Stashes (${stashes.length})`} title={`Stashes (${stashes.length})`}><Archive size={13} /></TabsTrigger>
          </TabsList>
          <span className="grow git-tab-title">{gitTab === 'commits' ? 'Commits' : 'Stashes'}</span>
          {gitTab === 'commits' ? <>
            <Button className="ghost icon small-icon" aria-label="Fetch repository" title="Fetch" disabled={busy} onClick={() => void run(() => invoke('git.fetch', taskId, binding.repoId))}><CloudDownload size={13} /></Button>
            <Button className="ghost icon small-icon" aria-label="Sync repository" title={status?.upstream ? `Sync changes: pull ${status.behind} (${PULL_NAME[preferences.pullMode]}), then push ${status.ahead}` : 'Publish branch'} disabled={busy || !status?.branch || !!status.operation || !status.remote} onClick={sync}><RefreshCcw size={13} className={busy ? 'spin' : ''} /></Button>
          </> : <>
            <Button className="ghost icon small-icon" aria-label="Stash changes" title="Stash changes…" disabled={busy || !canStash} onClick={() => { setOperationName(''); setConfirmation({ kind: 'stash' }) }}><Plus size={13} /></Button>
          </>}
        </div>
        <TabsContent value="commits">
          <BranchPicker binding={binding} status={status} branches={branches} busy={busy} className="git-branch-btn" onChange={(branch) => void run(async () => { requireSaved(); await invoke('git.checkout', taskId, binding.repoId, branch) })} />
          <div className="git-tracking muted">{status?.upstream ? `${status.ahead ? `${status.ahead} outgoing` : ''}${status.ahead && status.behind ? ' · ' : ''}${status.behind ? `${status.behind} incoming` : ''}${!status.ahead && !status.behind ? 'Up to date' : ''} · ${status.upstream}` : 'No upstream configured'}</div>
          {status?.upstream && <Button className="git-compare" onClick={() => ws.openView(taskId, { kind: 'git', repoId: binding.repoId, title: `Compare with ${status.upstream}` })}><GitCompareArrows size={13} /><span>Compare with {status.upstream}</span></Button>}
          <div className="git-history">{commits.length ? commits.map((commit) => <CommitHistoryRow key={commit.oid} taskId={taskId} binding={binding} commit={commit} />) : <p className="muted small">No commits yet.</p>}</div>
        </TabsContent><TabsContent value="stashes" className="git-history git-stashes">
          {stashes.length ? stashes.map((stash) => <div key={stash.oid} className="change-row stash-row">
            <span className="change-name stash-name" title={`${stash.ref} · ${stash.subject}`}><Archive size={13} /><span>{stash.subject.replace(/^On [^:]+: /, '')}</span></span>
            <Button className="ghost icon small-icon" disabled={busy} aria-label={`Apply ${stash.subject}`} title="Apply (keep the stash)" onClick={() => void applyStash(stash)}><Copy size={13} /></Button>
            <Button className="ghost icon small-icon" disabled={busy} aria-label={`Pop ${stash.subject}`} title="Pop (apply and remove)" onClick={() => void popStash(stash)}><ArchiveRestore size={13} /></Button>
            <Button className="ghost icon small-icon" disabled={busy} aria-label={`Delete ${stash.subject}`} title="Delete stash" onClick={() => setConfirmation({ kind: 'drop-stash', oid: stash.oid, title: stash.subject })}><Trash2 size={13} /></Button>
          </div>) : <p className="muted small git-empty">No stashes. Stash saves your working changes so you can switch tasks and bring them back later.</p>}
        </TabsContent>
      </>}
    </Tabs>)}
  </div>
}
