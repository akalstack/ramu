import { ContentSkeleton } from '@/components/content-skeleton'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ButtonGroup } from '@/components/ui/button-group'
import { t, useLanguage } from './../i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Check, CloudDownload, CloudUpload, GitBranch, RefreshCcw, Trash2, ChevronDown, ChevronRight, GitCompareArrows, Minus, MoreHorizontal, Plus, RefreshCw, Sparkles, Undo2, FileText, Copy } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type CommitAction, type CommitDraft, type GitStash, type GitBranchInfo, type GitCommit, type GitStatus, type GitStatusEntry, type PullMode, type RepositoryBinding } from '../../../shared/types'
import { useAppSettings } from '../AppSettings'
import { BranchPicker, SyncButton } from '../GitControls'
import { AgentControls, providerName } from '../AgentControls'
import { invoke, ramu, copyText } from '../ipc'
import { Dialog, Dropdown, Menu, useContextMenu } from '../Menu'
import { errorText } from '../TaskPane'
import { chooseCommitBranch } from '../CommitBranchDialog'
import { registerCommitTarget } from '../commitShortcut'
import { formatKeys } from '../commands'
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
  useLanguage()
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
  return <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] scm-panel [&:has(.git-inspector.collapsed)_.scm-git-resizer]:hidden flex flex-col w-full h-full min-h-0 p-[2px_8px_0]" ref={panelRef}>
    {bindings.length === 0 ? <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">{t("No repository available.")}</p>
      : <>
        <OverlayScrollArea className="scm-repos flex-1 min-h-0 overflow-y-auto">{bindings.map((b, index) => {
          const expanded = isOpen(b.repoId, index)
          return <RepositoryControl key={`${taskId}:${b.repoId}`} taskId={taskId} binding={b} compact collapsed={many && !expanded} gitHost={gitHost} showGit={gitRepo?.repoId === b.repoId} gitRepos={bindings} onGitRepo={setGitRepoId} onToggle={many ? () => { setOpen((current) => ({ ...current, [b.repoId]: !expanded })); if (!expanded) setGitRepoId(b.repoId) } : undefined} />
        })}</OverlayScrollArea>
        <div className="scm-git-resizer [&::after]:[content:''] [&::after]:absolute [&::after]:inset-[4px_0] [&::after]:h-[var(--pane-border-width)] [&::after]:[background:var(--pane-border-color)] [&::after]:[transition:background_0.15s] [&:hover::after]:[background:var(--accent)] [&.is-resizing::after]:[background:var(--accent)] flex-none h-[9px] m-[-4px_-8px] relative z-2 cursor-row-resize" role="separator" aria-orientation="horizontal" aria-label={t("Resize Git section")} title={t("Drag to resize · double-click to reset")} onPointerDown={startResize} onDoubleClick={() => { setGitHeight(GIT_HEIGHT_DEFAULT); localStorage.removeItem(GIT_HEIGHT_KEY) }} />
        <div className="scm-git-host [&:has(.git-inspector.collapsed)]:h-auto! [&_.git-inspector]:flex-1 [&_.git-inspector]:h-auto [&_.git-inspector]:min-h-0 [&_.git-inspector]:max-h-[none] [&_.git-inspector]:[border-top:0] [&_.git-inspector:not(.collapsed)]:flex-1 [&_.git-inspector:not(.collapsed)]:h-auto [&_.git-inspector:not(.collapsed)]:min-h-0 [&_.git-inspector:not(.collapsed)]:max-h-[none] [&_.git-inspector:not(.collapsed)]:[border-top:0] flex-none flex flex-col min-h-0" ref={setGitHost} style={{ height: gitHeight }} />
      </>}
  </div>
}

const PULL_NAME: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

const LETTER: Record<string, string> = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', 'type-changed': 'T', untracked: 'U', unmerged: '!' }

function RepositoryControl({ taskId, binding, compact = false, collapsed = false, gitHost = null, showGit = true, gitRepos = [], onGitRepo, onToggle }: { taskId: string; binding: RepositoryBinding; compact?: boolean; collapsed?: boolean; gitHost?: HTMLElement | null; showGit?: boolean; gitRepos?: RepositoryBinding[]; onGitRepo?: (repoId: string) => void; onToggle?: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const { preferences, save: savePreferences } = useAppSettings()
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [loading, setLoading] = useState(true)
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
  const [confirmation, setConfirmation] = useState<{ kind: 'smart-commit'; action: CommitAction } | { kind: 'discard'; paths: string[] } | { kind: 'undo'; oid: string; title: string } | { kind: 'branch' } | { kind: 'stash'; staged?: boolean } | { kind: 'delete-branch'; name: string } | { kind: 'drop-stash'; oid: string; title: string } | null>(null)
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
    setLoading(false)
  }, [taskId, binding.repoId, reportError])
  useEffect(() => {
    setLoading(true)
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
      const task = await invoke('tasks.create', { projectId: project.id, title: t("Resolve {0} conflicts in {1}", { "0": kind, "1": binding.repoName }), mode: isolated ? 'worktree' : 'current', workspaceId: isolated })
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
    { key: 'diff', label: t("Open changes"), onSelect: () => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: contextEntry.entry.path, staged: contextEntry.staged }) },
    { key: 'open', label: <><FileText size={14} />{t("Open file")}</>, disabled: (contextEntry.staged ? contextEntry.entry.staged : contextEntry.entry.unstaged) === 'deleted', onSelect: () => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: contextEntry.entry.path }) },
    { key: 'stage', label: <>{contextEntry.staged ? <Minus size={14} /> : <Plus size={14} />}{contextEntry.staged ? t("Unstage changes") : t("Stage changes")}</>, disabled: busy, onSelect: () => void run(() => invoke(contextEntry.staged ? 'git.unstage' : 'git.stage', taskId, binding.repoId, [contextEntry.entry.path])) },
    ...(!contextEntry.staged ? [{ key: 'discard', label: <><Undo2 size={14} />{t("Discard changes…")}</>, danger: true, disabled: busy, onSelect: () => setConfirmation({ kind: 'discard', paths: [contextEntry.entry.path] }) }] : []),
    { key: 'copy', label: <><Copy size={14} />{t("Copy relative path")}</>, onSelect: () => void copyPath(contextEntry.entry.path) },
  ] : [])
  const row = (e: GitStatusEntry, isStaged: boolean) => <div key={`${isStaged}:${e.path}`} className="change-row [&:hover]:bg-hover [&_button.icon]:w-[var(--action-compact)] [&_button.icon]:h-[var(--action-compact)] [&_button.icon]:bg-transparent [&_button.icon]:[border:none] [&_button.icon]:text-muted-foreground [&_button.icon]:opacity-0 [&:hover_button.icon]:opacity-100 [&_button.icon:focus-visible]:opacity-100 [&_button.icon:hover:not(:disabled)]:bg-accent [&_button.icon:hover:not(:disabled)]:text-foreground [&:hover_.change-actions]:flex [&:focus-within_.change-actions]:flex flex items-center gap-1 rounded-(--radius-s)" onContextMenu={(event) => { setContextEntry({ entry: e, staged: isStaged }); fileContext.onContextMenu(event) }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { setContextEntry({ entry: e, staged: isStaged }); fileContext.onKeyDown(event) } }}>
    <Button variant="secondary" className="bg-fill hover:bg-fill-hover change-name min-h-0 leading-4 text-control [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground flex-1 min-w-0 text-left bg-transparent [border:none] p-[1px_4px] gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis [direction:rtl] text-soft block justify-start" title={e.origPath ? `${e.origPath} → ${e.path}` : e.path} onClick={() => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: e.path, staged: isStaged })} onDoubleClick={() => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: e.path, staged: isStaged, preview: false })}><span className="change-base">{e.path.slice(e.path.lastIndexOf('/') + 1)}</span>{e.path.includes('/') && <span className="change-dir">{e.path.slice(0, e.path.lastIndexOf('/'))}</span>}</Button>
    <span className="change-actions hidden items-center gap-0.5 flex-none">
      {!isStaged && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Discard changes to {0}", { "0": e.path })} title={t("Discard changes")} onClick={() => setConfirmation({ kind: 'discard', paths: [e.path] })}><Undo2 size={13} /></Button>}
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={`${isStaged ? 'Unstage' : 'Stage'} ${e.path}`} title={isStaged ? 'Unstage' : 'Stage'} onClick={() => void run(() => invoke(isStaged ? 'git.unstage' : 'git.stage', taskId, binding.repoId, [e.path]))}>{isStaged ? <Minus size={13} /> : <Plus size={13} />}</Button>
    </span>
    <span className={`letter [&.modified]:text-warn [&.added]:text-ok [&.untracked]:text-ok [&.deleted]:text-bad [.commit-file-M_&]:text-warn [.commit-file-R_&]:text-warn tabular-nums font-mono text-caption w-3.5 text-center text-muted-foreground ${isStaged ? e.staged : e.unstaged}`} title={e.origPath ? t("Renamed") : undefined}>{LETTER[(isStaged ? e.staged : e.unstaged) ?? '']}</span>
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
  const commit = async (action: 'commit' | 'amend' | 'push' | 'sync' | 'new-branch' = 'commit', stagePaths?: string[]) => {
    if (loading || busy || generating || conflicts.length) return
    const branchOptions = action === 'push' || action === 'sync' || action === 'new-branch' ? await chooseCommitBranch(taskId, binding.repoId, action === 'new-branch', action === 'sync' ? 'sync' : 'push') : undefined
    if (branchOptions === null) return
    if (branchOptions?.newBranch) requireSaved()
    if (stagePaths?.length) await invoke('git.stage', taskId, binding.repoId, stagePaths)
    let text = message, fingerprint = draft?.fingerprint
    const amendHead = action === 'amend' ? status?.oid ?? undefined : undefined
    if (action === 'amend' && !amendHead) return
    if (!text.trim() && action !== 'amend') {
      const value = await draftMessage()
      if (!value?.message.trim()) return
      text = value.message; fingerprint = value.fingerprint
    }
    await run(async () => {
      if (action === 'sync') requireSaved()
      await invoke('git.commit', taskId, binding.repoId, text, fingerprint, amendHead, branchOptions)
      setMessage(''); setDraft(null)
      if (action === 'push') await invoke('git.push', taskId, binding.repoId, branchOptions?.newBranch ?? branchOptions?.expectedBranch ?? undefined)
      if (action === 'sync') await invoke('git.sync', taskId, binding.repoId)
    })
  }

  const canCommit = !loading && !busy && !generating && !!(staged.length || unstaged.length) && !conflicts.length
  const commitAction = preferences.defaultCommitAction
  const actionLabel = (action: CommitAction) => t(action === 'push' ? 'Commit & Push' : action === 'sync' ? 'Commit & Sync' : 'Commit')
  const commitLabel = actionLabel(commitAction)
  const canRunCommit = (action: CommitAction) => canCommit && (action === 'commit' || (!!status?.branch && !!status.remote && !status.operation))
  const requestCommit = (action: CommitAction = commitAction) => {
    if (!canRunCommit(action)) return
    if (!staged.length) setConfirmation({ kind: 'smart-commit', action })
    else void commit(action).catch((reason) => reportError(errorText(reason)))
  }
  const selectCommitAction = (action: CommitAction) => {
    void (async () => {
      if (action !== preferences.defaultCommitAction) await savePreferences({ ...preferences, defaultCommitAction: action })
      requestCommit(action)
    })().catch((reason) => reportError(errorText(reason)))
  }
  const canAmend = !loading && !busy && !generating && !!status?.oid && !status.operation && !conflicts.length
  const canUndo = !busy && !generating && !!status?.oid && commits.length > 1 && !status.detached && !status.operation && !conflicts.length && !(status.upstream && status.ahead === 0)
  const requestUndo = (commit: GitCommit) => setConfirmation({ kind: 'undo', oid: commit.oid, title: commit.subject })
  // Like VS Code: with a clean tree and something to sync, the primary button becomes Sync Changes (or Publish Branch) instead of Commit.
  const syncOnly = !!status && !status.entries.length && !status.operation && !!status.branch && !!status.remote && (!status.upstream || status.ahead > 0 || status.behind > 0)
  const canPickRemoteAction = !!status?.branch && !!status.remote && !status.operation
  // The Commit & Push shortcut (commitShortcut.ts) runs this section's own commit, typed message included.
  const publishable = !!status?.branch && !!status.remote && !status.operation && !conflicts.length
  const shortcut = useRef({ staged: 0, unstaged: [] as string[], publishable: false, commit })
  shortcut.current = { staged: staged.length, unstaged: unstaged.map((entry) => entry.path), publishable, commit }
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => registerCommitTarget({
    taskId, repoId: binding.repoId,
    staged: () => shortcut.current.staged,
    changes: () => shortcut.current.staged + shortcut.current.unstaged.length,
    focused: () => !!root.current?.contains(document.activeElement),
    // Smart commit: with nothing staged, every change is staged first.
    commitAndPush: async () => {
      const { staged, unstaged, publishable } = shortcut.current
      if (!publishable) return reportError(t("This repository has no branch with a remote to push to, or a conflict is unresolved."))
      try { await shortcut.current.commit('push', staged ? undefined : unstaged) } catch (reason) { reportError(errorText(reason)) }
    },
  }), [taskId, binding.repoId, reportError])

  return <div ref={root} className={`scm-repo-body${compact ? ' compact' : ''}${collapsed ? ' collapsed' : ''}`}>
    {fileContext.menu}
    {confirmation && <Dialog title={confirmation.kind === 'smart-commit' ? t("Stage all changes and commit?") : confirmation.kind === 'discard' ? t("Discard changes?") : confirmation.kind === 'undo' ? t("Undo last commit?") : confirmation.kind === 'branch' ? t("Create branch") : confirmation.kind === 'stash' ? (confirmation.staged ? t("Stash staged changes") : t("Stash changes")) : confirmation.kind === 'delete-branch' ? t("Delete branch?") : t("Delete stash?")} confirmLabel={confirmation.kind === 'smart-commit' ? (confirmation.action === 'commit' ? t("Stage all and commit") : actionLabel(confirmation.action)) : confirmation.kind === 'discard' ? t("Discard changes") : confirmation.kind === 'undo' ? t("Undo commit") : confirmation.kind === 'branch' ? t("Create branch") : confirmation.kind === 'stash' ? t("Stash") : t("Delete")} danger={confirmation.kind === 'discard' || confirmation.kind === 'drop-stash' || confirmation.kind === 'delete-branch'} busy={busy} onCancel={() => { if (!busy) setConfirmation(null) }} onConfirm={() => { if (confirmation.kind === 'smart-commit') { setConfirmation(null); void commit(confirmation.action, unstaged.map((entry) => entry.path)).catch((reason) => reportError(errorText(reason))); return } void run(async () => {
      requireSaved()
      if (confirmation.kind === 'discard') await invoke('git.discard', taskId, binding.repoId, confirmation.paths)
      else if (confirmation.kind === 'undo') { const message = await invoke('git.undoCommit', taskId, binding.repoId, confirmation.oid); setMessage(message); setDraft(null) }
      else if (confirmation.kind === 'branch') await invoke('git.createBranch', taskId, binding.repoId, operationName.trim())
      else if (confirmation.kind === 'stash') await invoke('git.stash', taskId, binding.repoId, operationName.trim(), confirmation.staged)
      else if (confirmation.kind === 'delete-branch') await invoke('git.deleteBranch', taskId, binding.repoId, confirmation.name)
      else await invoke('git.dropStash', taskId, binding.repoId, confirmation.oid)
      setConfirmation(null)
    }) }}>
      {confirmation.kind === 'smart-commit' ? <p>{t("No changes are staged. All unstaged changes in this repository will be staged and committed.")}</p> : confirmation.kind === 'discard' ? <><p>{t("Tracked edits return to their staged version. Untracked files move to Trash. Staged changes are kept.")}</p><pre className="confirm-paths max-h-[240px] overflow-auto p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) text-caption bg-fill">{confirmation.paths.join('\n')}</pre></> : confirmation.kind === 'undo' ? <><p>{t("The last local commit will be undone. Its files stay in your checkout and index.")}</p><p className="strong font-semibold">{confirmation.title}</p></> : confirmation.kind === 'branch' || confirmation.kind === 'stash' ? <><label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch">{confirmation.kind === 'branch' ? t("Branch name") : t("Stash message")}<Input autoFocus value={operationName} onChange={(event) => setOperationName(event.target.value)} /></label><p className="muted text-muted-foreground small text-caption">{confirmation.kind === 'branch' ? t("Creates and switches to a new local branch. The checkout must be clean.") : (confirmation.kind === 'stash' && confirmation.staged ? t("Saves only staged changes and removes them from the checkout. Unstaged edits stay.") : t("Preserves tracked and untracked changes. Ignored files stay in place."))}</p></> : <><p>{confirmation.kind === 'delete-branch' ? t("Deletes the local branch only. Git will refuse an unmerged branch or one in use by a worktree.") : t("This saved stash will be permanently removed.")}</p><p className="strong font-semibold">{confirmation.kind === 'delete-branch' ? confirmation.name : confirmation.title}</p></>}
    </Dialog>}
    <OverlayScrollArea className="scm-content [.scm-repo-body.compact_&]:flex-none [.scm-repo-body.compact_&]:overflow-visible flex-1 min-h-0 overflow-y-auto">
      <section className="scm-repo [&_.scm-commit]:mb-1.5 [&_.commit-msg]:block [&_.commit-msg]:w-full [&_.commit-msg]:min-h-12 [&_.commit-msg]:p-[8px_36px_8px_10px] [&_.commit-msg]:leading-[18px] [&_.commit-msg]:bg-fill [&_.commit-msg]:[border-color:transparent] [&_.commit-msg]:rounded-(--radius-s) [&_.commit-msg]:text-control [&_.commit-msg]:resize-y [&_.sub-title]:m-[4px_0_0] [&_.sub-title]:mt-1 [&_.sub-title]:p-[0_4px] [&_.sub-title]:min-h-7 [&_.sub-title]:rounded-(--radius-s) [&_.sub-title]:gap-1 [&_.sub-title_.with-icon]:gap-1.5 [&_.change-row]:p-[0_4px_0_23px] [&_.change-row]:gap-1.5 [&_.change-row]:min-h-[22px] [&_.change-row]:text-control [&_.sub-title:has(.scm-group-toggle):hover]:bg-hover [&_.sub-title:has(.scm-group-toggle):focus-within]:bg-hover [.scm-repo-body.collapsed_&_>_:not(.scm-section-head)]:hidden [.scm-repo-body.collapsed_&]:pb-0.5 [&_.scm-repo-toggle]:justify-start [&_.scm-repo-toggle]:bg-transparent! [&_.scm-repo-toggle]:p-0 [&_.scm-repo-toggle]:h-auto [&_.scm-repo-toggle:hover]:justify-start [&_.scm-repo-toggle:hover]:bg-transparent! [&_.scm-repo-toggle:hover]:p-0 [&_.scm-repo-toggle:hover]:h-auto [&_.sub-title_.scm-count]:bg-accent [&_.sub-title_.scm-count]:text-soft [&_.sub-title_.scm-count]:font-semibold [&_.change-name]:[direction:ltr] [&_.change-name]:flex [&_.change-name]:items-baseline [&_.change-name]:gap-1.5 [&_.change-name]:min-w-0 [&_.change-name]:overflow-hidden [&_.change-name]:flex-auto [&_.change-name]:whitespace-nowrap [&_.change-name]:text-control [&_.change-base]:text-foreground [&_.change-base]:flex-initial [&_.change-base]:max-w-[none] [&_.change-base]:min-w-0 [&_.change-base]:overflow-hidden [&_.change-base]:text-ellipsis [&_.change-base]:whitespace-nowrap [&_.change-dir]:overflow-hidden [&_.change-dir]:text-ellipsis [&_.change-dir]:text-muted-foreground [&_.change-dir]:[direction:rtl] [&_.change-dir]:text-left [&_.change-dir]:[flex:1_1_0] [&_.change-dir]:min-w-0 [&_.change-dir]:whitespace-nowrap [&_.change-dir]:text-caption [&_.change-row_>_.letter]:flex-none [&_.change-row_>_.letter]:w-[18px] [&_.change-row_>_.letter]:mr-1 [&_.change-row_>_.letter]:font-semibold flex flex-col [border-bottom:none] gap-1 pb-2 mb-0">
        <div className="scm-section-head [&_>_svg]:flex-none [&_.strong]:overflow-hidden [&_.strong]:text-ellipsis [&_.strong]:whitespace-nowrap flex items-center gap-1.5 min-h-8 p-[0_4px] m-0 text-control">
          {onToggle ? <Button variant="tree" type="button" className="scm-repo-toggle [&_.strong]:overflow-hidden [&_.strong]:text-ellipsis [&_.strong]:whitespace-nowrap [&_.scm-count]:ml-1.5 flex items-center justify-start gap-1 min-w-0 p-0 [border:0] bg-transparent text-inherit [font:inherit] text-left cursor-pointer grow flex-1 min-w-0 text-left" aria-expanded={!collapsed} onClick={onToggle}>{collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<span className="strong font-semibold">{binding.repoName}</span>{collapsed && !!status?.entries.length && <span className="scm-count ml-auto text-muted-foreground inline-flex items-center justify-center min-w-[18px] h-[18px] p-[0_4px] rounded-(--radius-row) bg-accent text-caption leading-[18px]">{status.entries.length}</span>}</Button> : <><ChevronDown size={14} /><span className="grow flex-1 min-w-0 text-left strong font-semibold">{binding.repoName}</span></>}
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Stash all changes…")} aria-label={t("Stash all changes")} disabled={busy || !canStash} onClick={() => { setOperationName(''); setConfirmation({ kind: 'stash' }) }}><Archive size={13} /></Button>
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Refresh source control")} aria-label={t("Refresh source control")} onClick={() => void load()}><RefreshCw size={13} /></Button>
          <Menu disabled={loading || busy || generating} label={t("Source control actions")} icon={<MoreHorizontal size={14} />} className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" align="end" items={[
            { key: 'stage-all', label: <><Plus size={14} />{t("Stage all changes")}</>, disabled: !unstaged.length, onSelect: () => void run(() => invoke('git.stage', taskId, binding.repoId, unstaged.map((entry) => entry.path))) },
            { key: 'unstage-all', label: <><Minus size={14} />{t("Unstage all changes")}</>, disabled: !staged.length, onSelect: () => void run(() => invoke('git.unstage', taskId, binding.repoId, staged.map((entry) => entry.path))) },
            { key: 'discard-all', label: <><Undo2 size={14} />{t("Discard all unstaged changes…")}</>, danger: true, disabled: !unstaged.length, onSelect: () => setConfirmation({ kind: 'discard', paths: unstaged.map((entry) => entry.path) }) },
            { key: 'undo-commit', label: <><Undo2 size={14} />{t("Undo last commit…")}</>, disabled: !canUndo, onSelect: () => { const head = commits.find(commit => commit.oid === status?.oid); if (head) requestUndo(head) } },
            { key: 'open-all', label: t("Open all changes"), disabled: !status?.entries.length, onSelect: () => status?.entries.filter((entry) => entry.staged !== 'unmerged').forEach((entry) => ws.openView(taskId, { kind: 'diff', repoId: binding.repoId, path: entry.path, staged: !!entry.staged && !entry.unstaged, preview: false })) },
            { key: 'branches-sep', separator: true },
            { key: 'create-branch', label: t("Create branch…"), onSelect: () => { setOperationName(''); setConfirmation({ kind: 'branch' }) } },
            { key: 'delete-branch', label: t("Delete local branch"), disabled: !branches.some((branch) => !branch.current && !branch.worktree), submenu: branches.filter((branch) => !branch.current && !branch.worktree).map((branch) => ({ key: branch.name, label: branch.name, onSelect: () => setConfirmation({ kind: 'delete-branch', name: branch.name }) })) },
            { key: 'stash-sep', separator: true },
            { key: 'stash', label: <><Archive size={14} />{t("Stash all changes…")}</>, disabled: !canStash, onSelect: () => { setOperationName(''); setConfirmation({ kind: 'stash' }) } },
            { key: 'stash-staged', label: <><Archive size={14} />{t("Stash staged changes…")}</>, disabled: !canStash || !staged.length, onSelect: () => { setOperationName(''); setConfirmation({ kind: 'stash', staged: true }) } },
            { key: 'pop-latest', label: <><ArchiveRestore size={14} />{t("Pop latest stash")}</>, disabled: !stashes.length, onSelect: () => void popStash(stashes[0]!) },
            { key: 'pop-stash', label: t("Pop stash"), disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => void popStash(stash) })) },
            { key: 'apply-stash', label: t("Apply stash"), disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => void applyStash(stash) })) },
            { key: 'drop-stash', label: t("Delete stash"), disabled: !stashes.length, submenu: stashes.map((stash) => ({ key: stash.oid, label: stash.subject, title: stash.subject, onSelect: () => setConfirmation({ kind: 'drop-stash', oid: stash.oid, title: stash.subject }) })) },
            { key: 'sep', separator: true },
            { key: 'sync', label: <><RefreshCcw size={14} />{status?.upstream ? t("Sync changes") : t("Publish branch")}</>, disabled: !status?.branch || !!status.operation, onSelect: sync },
            { key: 'pull', label: <><ArrowDown size={14} />{t("Pull ({0})", { "0": PULL_NAME[preferences.pullMode] })}</>, disabled: !!status?.operation, onSelect: () => pull() },
            { key: 'pull-with', label: t("Pull with"), disabled: !!status?.operation, submenu: (['rebase', 'merge', 'ff-only'] as const).filter((mode) => mode !== preferences.pullMode).map((mode) => ({ key: mode, label: PULL_NAME[mode], onSelect: () => pull(mode) })) },
            { key: 'push', label: <><ArrowUp size={14} />{status?.upstream ? t("Push") : t("Publish branch")}</>, disabled: !!status?.operation, onSelect: () => void run(() => invoke('git.push', taskId, binding.repoId)) },
            { key: 'fetch', label: <><CloudDownload size={14} />{t("Fetch")}</>, onSelect: () => void run(() => invoke('git.fetch', taskId, binding.repoId)) },
          ]} />
        </div>
        {status?.operation && <div className="scm-operation flex flex-col gap-2 p-2.5 mb-2 [border:1px_solid_color-mix(in_srgb,_var(--warn)_40%,_transparent)] rounded-(--radius-s) [background:var(--warn-wash)] text-soft text-control leading-[18px]" role="status">
          <span>{status.operation === 'rebase' ? t("Rebase in progress.") : t("Merge in progress.")} {conflicts.length ? t("Resolve {0} conflicted {1}, stage them, then continue.", { "0": conflicts.length, "1": conflicts.length === 1 ? 'file' : 'files' }) : t("Conflicts are resolved and staged.")}</span>
          <div className="scm-operation-actions [&_button]:flex-1 [&_button]:justify-center [&_button]:h-[26px] [&_button]:whitespace-nowrap [&_button:first-child:not(.primary)]:[flex:1_1_100%] flex flex-wrap gap-1.5">
            {!!conflicts.length && <Button variant="secondary" size="sm" className="bg-fill hover:bg-fill-hover small text-caption" disabled={busy || resolving} onClick={() => void resolveWithAi()}><Sparkles size={13} />{resolving ? t("Starting…") : t("Resolve with AI")}</Button>}
            <Button variant="default" size="sm" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100 small text-caption" disabled={busy || !!conflicts.length} onClick={() => void run(() => invoke('git.continueOperation', taskId, binding.repoId))}>{t("Continue")}</Button>
            <Button variant="secondary" size="sm" className="bg-fill hover:bg-fill-hover small text-caption" disabled={busy} onClick={() => void run(() => invoke('git.abortOperation', taskId, binding.repoId))}>{status.operation === 'rebase' ? t("Abort rebase") : t("Abort merge")}</Button>
          </div>
        </div>}
        <div className="commit-input-wrap relative m-[4px_0_8px]">
          <Textarea className="commit-msg min-h-[56px] resize-y" rows={2} maxLength={100000} value={message} placeholder={t("Message (empty drafts one with AI)")} aria-label={t("Commit message for {0}", { "0": binding.repoName })} onChange={(e) => { setMessage(e.target.value); if (!e.target.value.trim()) setDraft(null) }} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canCommit) requestCommit() }} />
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) commit-ai absolute right-1.5 top-1.5" title={t("Draft a commit message from staged changes")} aria-label={t("AI commit message for {0}", { "0": binding.repoName })} disabled={busy || generating || !staged.length || !!conflicts.length} onClick={generate}><Sparkles size={14} className={generating ? 'shimmer text-control [background:linear-gradient(90deg,_var(--muted)_30%,_var(--text)_50%,_var(--muted)_70%)] [background-size:200%_100%] [-webkit-background-clip:text] [background-clip:text] [color:transparent] [animation:shimmer_1.8s_linear_infinite]' : ''} /></Button>
        </div>
        {!syncOnly && <ButtonGroup className="scm-commit-split [&_>_button.scm-commit]:flex-1 [&_>_button.scm-commit]:w-auto [&_>_button.scm-commit]:min-w-0 [&_>_button.scm-commit]:m-0 [&_>_button.scm-commit]:[border-radius:var(--radius-s)_0_0_var(--radius-s)] flex gap-0 mb-1.5" aria-label={t("Commit")}>
          <Button variant="default" className="scm-commit primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" aria-label={commitLabel} disabled={!canRunCommit(commitAction)} title={!staged.length ? t("Stage all changes and commit?") : message.trim() ? undefined : t("Drafts a message with AI, then commits")} onClick={() => requestCommit()}><Check size={14} />{generating ? t("Drafting message…") : busy ? t("Working…") : commitLabel}</Button>
          <Menu disabled={!canRunCommit(commitAction)} label={t("Commit options")} icon={<ChevronDown size={14} />} className="scm-commit-menu primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100 icon p-0 size-(--action-size) flex-none justify-center" align="end"  items={[
            { key: 'commit', label: t("Commit"), selected: commitAction === 'commit', onSelect: () => selectCommitAction('commit') },
            { key: 'new-branch', label: t("Commit on new branch"), disabled: !canCommit || !staged.length || !!status?.operation, onSelect: () => void commit('new-branch').catch((reason) => reportError(errorText(reason))) },
            { key: 'amend', label: t("Commit (Amend)"), title: t("Replace the latest commit; leave the message empty to keep its message"), disabled: !canAmend, onSelect: () => void commit('amend') },
            { key: 'separator', separator: true },
            { key: 'push', label: t("Commit & Push"), selected: commitAction === 'push', title: t("Shortcut: {0}", { "0": formatKeys('mod+alt+p') }), disabled: !canPickRemoteAction, onSelect: () => selectCommitAction('push') },
            { key: 'sync', label: t("Commit & Sync"), selected: commitAction === 'sync', disabled: !canPickRemoteAction, onSelect: () => selectCommitAction('sync') },
          ]} />
        </ButtonGroup>}
        {syncOnly && <SyncButton status={status} busy={busy} pullMode={preferences.pullMode} className="scm-commit primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover mb-1.5" showLabel onSync={sync} />}
        {draft && <div className="muted text-muted-foreground small text-caption ai-draft-label p-[3px_0] text-caption">{t("Drafted with ")}{providerName(draft.provider)} {t(" · Review before committing.")}</div>}
        <Collapsible className="scm-ai-settings [&_[data-slot='collapsible-trigger']]:cursor-pointer [&_[data-slot='collapsible-trigger']]:flex [&_[data-slot='collapsible-trigger']]:items-center [&_[data-slot='collapsible-trigger']]:gap-1.5 [&_[data-slot='collapsible-trigger']]:min-h-7 [&_[data-slot='collapsible-trigger']]:p-[0_4px] [&_[data-slot='collapsible-trigger']]:[list-style:none] [&_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&[data-open]_summary_svg]:[transform:rotate(90deg)] [&_.composer-controls]:m-[5px_0_0] [&_.composer-controls]:p-[4px_0] [&_.composer-controls]:[border:none] text-caption text-muted-foreground m-0"><CollapsibleTrigger render={<Button variant="ghost" />}><ChevronRight size={13} />{t("AI message settings")}</CollapsibleTrigger><CollapsibleContent><div className="composer-controls flex items-center flex-wrap gap-0.5 p-[0_0_8px] mb-1.5 [border-bottom:1px_solid_var(--line)]"><AgentControls settings={settings} onChange={setSettings} disabled={generating} showAccess={false} /></div></CollapsibleContent></Collapsible>
        {loading && <ContentSkeleton />}
        {!!conflicts.length && <><div className="sub-title tabular-nums flex justify-between items-center text-muted-foreground text-control m-[12px_2px_4px] warn text-warn"><span>{t("Merge changes ({0})", { "0": conflicts.length })}</span>{!status?.operation && <Button variant="ghost" size="sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption" disabled={busy || resolving} onClick={() => void resolveWithAi()}><Sparkles size={12} />{resolving ? t("Starting…") : t("Resolve with AI")}</Button>}</div>{conflicts.map((e) => <div key={e.path} className="change-row [&:hover]:bg-hover [&_button.icon]:w-[var(--action-compact)] [&_button.icon]:h-[var(--action-compact)] [&_button.icon]:bg-transparent [&_button.icon]:[border:none] [&_button.icon]:text-muted-foreground [&_button.icon]:opacity-0 [&:hover_button.icon]:opacity-100 [&_button.icon:focus-visible]:opacity-100 [&_button.icon:hover:not(:disabled)]:bg-accent [&_button.icon:hover:not(:disabled)]:text-foreground [&:hover_.change-actions]:flex [&:focus-within_.change-actions]:flex flex items-center gap-1 rounded-(--radius-s)"><Button variant="secondary" className="bg-fill hover:bg-fill-hover change-name min-h-0 leading-4 text-control [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground flex-1 min-w-0 text-left bg-transparent [border:none] p-[1px_4px] gap-1.5 whitespace-nowrap overflow-hidden text-ellipsis [direction:rtl] text-soft block justify-start" onClick={() => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path })}>{e.path}</Button><Button variant="secondary" size="icon-sm" className="bg-fill hover:bg-fill-hover icon p-0 size-(--action-size) flex-none justify-center" disabled={busy} aria-label={t("Mark {0} resolved", { "0": e.path })} onClick={() => void run(() => invoke('git.stage', taskId, binding.repoId, [e.path]))}><Check size={13} /></Button></div>)}</>}
        {(!preferences.hideEmptyStaged || !!staged.length) && <><div className="sub-title tabular-nums flex justify-between items-center text-muted-foreground text-control m-[12px_2px_4px]"><Button variant="tree" className="scm-group-toggle [&:hover]:text-foreground [&:hover]:bg-transparent [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&:focus-visible]:bg-transparent [&:focus-visible]:[border:0] [&:focus-visible]:text-foreground [&_>_.caret]:flex-none [&_>_.caret]:w-[13px] flex items-center flex-1 gap-1.5 min-w-0 p-0 [border:0] bg-transparent text-soft text-left text-control h-7 min-h-7 [border-radius:0] font-medium leading-[18px] justify-start" aria-expanded={stagedOpen} onClick={() => setStagedOpen((open) => !open)}><ChevronRight size={13} className={stagedOpen ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} />{t("Staged")}{!!staged.length && <span className="scm-count ml-auto text-muted-foreground inline-flex items-center justify-center min-w-[18px] h-[18px] p-[0_4px] rounded-(--radius-row) bg-accent text-caption leading-[18px]">{staged.length}</span>}</Button>{!!staged.length && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Unstage all")} title={t("Unstage all")} disabled={busy} onClick={() => void run(() => invoke('git.unstage', taskId, binding.repoId, staged.map((e) => e.path)))}><Minus size={13} /></Button>}</div>
        {stagedOpen && staged.map((e) => row(e, true))}</>}
        <div className="sub-title tabular-nums flex justify-between items-center text-muted-foreground text-control m-[12px_2px_4px]"><Button variant="tree" className="scm-group-toggle [&:hover]:text-foreground [&:hover]:bg-transparent [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:text-foreground [&:focus-visible]:bg-transparent [&:focus-visible]:[border:0] [&:focus-visible]:text-foreground [&_>_.caret]:flex-none [&_>_.caret]:w-[13px] flex items-center flex-1 gap-1.5 min-w-0 p-0 [border:0] bg-transparent text-soft text-left text-control h-7 min-h-7 [border-radius:0] font-medium leading-[18px] justify-start" aria-expanded={changesOpen} onClick={() => setChangesOpen((open) => !open)}><ChevronRight size={13} className={changesOpen ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} />{t("Changes")}{!!unstaged.length && <span className="scm-count ml-auto text-muted-foreground inline-flex items-center justify-center min-w-[18px] h-[18px] p-[0_4px] rounded-(--radius-row) bg-accent text-caption leading-[18px]">{unstaged.length}</span>}</Button>{!!unstaged.length && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Stage all")} title={t("Stage all")} disabled={busy} onClick={() => void run(() => invoke('git.stage', taskId, binding.repoId, unstaged.map((e) => e.path)))}><Plus size={13} /></Button>}</div>
        {changesOpen && unstaged.map((e) => row(e, false))}
        {!status?.entries.length && status && <p className="muted text-muted-foreground small text-caption scm-empty p-[8px_0]">{t("No changes in this checkout.")}</p>}
      </section>
    </OverlayScrollArea>
    {showGit && inGitSlot(<Tabs value={gitTab} onValueChange={(value) => setGitTab(value as 'commits' | 'stashes')} render={<section />} className={`git-inspector [&:not(.collapsed)]:h-[40%] [&:not(.collapsed)]:min-h-[220px] [&:not(.collapsed)]:max-h-[50%] [&_.git-tabs]:flex [&_.git-tabs]:flex-none [&_.git-tabs]:w-full [&_.git-tabs]:h-7 [&_.git-tabs]:gap-0.5 [&_.git-tabs]:p-0.5 [&_.git-tabs]:m-[0_0_4px] [&_.git-tabs]:rounded-(--radius-s) [&_.git-tabs]:bg-hover [&_.git-tabs_.git-tab]:flex-1 [&_.git-tabs_.git-tab]:h-6 [&_.git-tabs_.git-tab]:min-h-6 [&_.git-tabs_.git-tab]:p-[0_8px] [&_.git-tabs_.git-tab]:gap-1.5 [&_.git-tabs_.git-tab]:[border:0] [&_.git-tabs_.git-tab]:rounded-(--radius-s) [&_.git-tabs_.git-tab]:bg-transparent [&_.git-tabs_.git-tab]:[box-shadow:none] [&_.git-tabs_.git-tab]:text-muted-foreground [&_.git-tabs_.git-tab]:text-caption [&_.git-tabs_.git-tab]:font-medium [&_.git-tabs_.git-tab:hover]:text-foreground [&_.git-tabs_.git-tab:hover]:bg-transparent [&_.git-tabs_.git-tab:is([aria-selected='true'],_[data-active])]:bg-raised [&_.git-tabs_.git-tab:is([aria-selected='true'],_[data-active])]:text-foreground [&_.git-tabs_.git-tab:is([aria-selected='true'],_[data-active])]:[box-shadow:0_1px_2px_rgba(0,_0,_0,_0.25)] [&_.git-pane]:flex-auto [&_.git-pane]:min-h-0 [&_.git-pane:not([hidden])]:flex [&_.git-pane:not([hidden])]:flex-col [&_.git-history]:flex-auto [&_.git-history]:min-h-0 flex-none flex flex-col gap-0 min-w-0 p-[0_0_6px] ${historyOpen ? '' : ' collapsed'}`}>
      <div className="git-inspector-head [&_.dropdown-trigger.git-repo-picker]:flex-initial [&_.dropdown-trigger.git-repo-picker]:w-auto [&_.dropdown-trigger.git-repo-picker]:min-w-0 [&_.dropdown-trigger.git-repo-picker]:h-6 [&_.dropdown-trigger.git-repo-picker]:min-h-6 [&_.dropdown-trigger.git-repo-picker]:p-[0_4px_0_6px] [&_.dropdown-trigger.git-repo-picker]:gap-1 [&_.dropdown-trigger.git-repo-picker]:[border:0] [&_.dropdown-trigger.git-repo-picker]:rounded-(--radius-s) [&_.dropdown-trigger.git-repo-picker]:bg-transparent [&_.dropdown-trigger.git-repo-picker]:[box-shadow:none] [&_.dropdown-trigger.git-repo-picker]:text-muted-foreground [&_.dropdown-trigger.git-repo-picker]:text-control [&_.dropdown-trigger.git-repo-picker:is(:hover,_[data-popup-open])]:bg-hover [&_.dropdown-trigger.git-repo-picker:is(:hover,_[data-popup-open])]:text-foreground [&_.dropdown-trigger.git-repo-picker_>_[data-slot='select-value']]:flex-initial [&_.dropdown-trigger.git-repo-picker_>_[data-slot='select-value']]:min-w-0 [&_.dropdown-trigger.git-repo-picker_>_[data-slot='select-value']]:overflow-hidden [&_.dropdown-trigger.git-repo-picker_>_[data-slot='select-value']]:text-ellipsis [&_.dropdown-trigger.git-repo-picker_>_[data-slot='select-value']]:whitespace-nowrap [&_.dropdown-trigger.git-repo-picker_>_svg:last-child]:ml-0 flex items-center gap-0.5 min-w-0 min-h-[34px]">
        <Button variant="tree" className="git-inspector-heading" aria-expanded={historyOpen} onClick={() => setHistoryOpen((v) => !v)}><ChevronRight size={13} className={historyOpen ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} />Git</Button>
        {gitHost && gitRepos.length > 1 && <Dropdown label={t("Switch repository")} value={binding.repoId} className="git-repo-picker" options={gitRepos.map((repo) => ({ value: repo.repoId, label: repo.repoName }))} onChange={(repoId) => onGitRepo?.(repoId)} />}
        {!historyOpen && status?.branch && <span className="git-head-summary [&_>_span:first-of-type]:min-w-0 [&_>_span:first-of-type]:overflow-hidden [&_>_span:first-of-type]:text-ellipsis [&_svg]:flex-none inline-flex items-center gap-[5px] min-w-0 p-[0_6px_0_4px] text-muted-foreground text-caption whitespace-nowrap" title={status.upstream ?? undefined}><GitBranch size={12} /><span>{status.branch}</span>{!!status.behind && <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums">↓{status.behind}</span>}{!!status.ahead && <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums">↑{status.ahead}</span>}</span>}
        <span className="grow flex-1 min-w-0 text-left" />
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Fetch repository")} title={t("Fetch from remote")} disabled={busy || !status?.remote} onClick={() => void run(() => invoke('git.fetch', taskId, binding.repoId))}><CloudDownload size={13} /></Button>
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Sync repository")} title={status?.upstream ? t("Sync changes: pull {0} ({1}), then push {2}", { "0": status.behind, "1": PULL_NAME[preferences.pullMode], "2": status.ahead }) : t("Publish branch")} disabled={busy || !status?.branch || !!status.operation || !status.remote} onClick={sync}>{status?.upstream || !status?.remote ? <RefreshCcw size={13} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} /> : <CloudUpload size={13} />}</Button>
      </div>
      {historyOpen && <>
        <div className="git-branch flex flex-col gap-0 p-[0_0_6px]">
          <div className="git-branch-row [&_.dropdown-trigger.git-branch-btn]:flex-initial [&_.dropdown-trigger.git-branch-btn]:w-auto [&_.dropdown-trigger.git-branch-btn]:min-w-0 [&_.dropdown-trigger.git-branch-btn]:h-7 [&_.dropdown-trigger.git-branch-btn]:min-h-7 [&_.dropdown-trigger.git-branch-btn]:p-[0_6px] [&_.dropdown-trigger.git-branch-btn]:gap-1.5 [&_.dropdown-trigger.git-branch-btn]:[border:0] [&_.dropdown-trigger.git-branch-btn]:rounded-(--radius-s) [&_.dropdown-trigger.git-branch-btn]:bg-transparent [&_.dropdown-trigger.git-branch-btn]:[box-shadow:none] [&_.dropdown-trigger.git-branch-btn]:text-foreground [&_.dropdown-trigger.git-branch-btn]:text-control [&_.dropdown-trigger.git-branch-btn]:font-medium [&_.dropdown-trigger.git-branch-btn]:justify-start [&_.dropdown-trigger.git-branch-btn:is(:hover,_[data-popup-open]):not(:disabled)]:bg-hover [&_.dropdown-trigger.git-branch-btn_>_svg:first-child]:text-muted-foreground [&_.dropdown-trigger.git-branch-btn_>_svg:last-child]:ml-0 [&_.dropdown-trigger.git-branch-btn_>_[data-slot='select-value']]:flex-initial [&_.dropdown-trigger.git-branch-btn_>_[data-slot='select-value']]:min-w-0 [&_.dropdown-trigger.git-branch-btn_>_[data-slot='select-value']]:overflow-hidden [&_.dropdown-trigger.git-branch-btn_>_[data-slot='select-value']]:text-ellipsis [&_.dropdown-trigger.git-branch-btn_>_[data-slot='select-value']]:whitespace-nowrap flex items-center gap-0.5 min-w-0">
            <BranchPicker binding={binding} status={status} branches={branches} busy={busy} className="git-branch-btn" onChange={(branch) => void run(async () => { requireSaved(); await invoke('git.checkout', taskId, binding.repoId, branch) })} />
            {status?.upstream && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Compare with {0}", { "0": status.upstream })} title={t("Compare with {0}", { "0": status.upstream })} onClick={() => ws.openView(taskId, { kind: 'git', repoId: binding.repoId, title: t("Compare with {0}", { "0": status.upstream }) })}><GitCompareArrows size={13} /></Button>}
          </div>
          {status && <div className="git-tracking [&_>_*]:flex-none [&_>_*_+_*::before]:[content:'·'] [&_>_*_+_*::before]:mr-1.5 [&_>_*_+_*::before]:text-muted-foreground [&_>_span:only-child]:overflow-hidden [&_>_span:only-child]:text-ellipsis [&_>_span:only-child]:flex-initial flex items-center gap-1.5 min-w-0 p-[0_6px_0_25px] min-h-[18px] text-muted-foreground text-caption leading-[18px] whitespace-nowrap overflow-hidden tabular-nums">{
            status.upstream ? <>
              <span className="git-upstream flex-initial! min-w-0 overflow-hidden text-ellipsis" title={status.upstream}>{status.upstream}</span>
              {status.ahead || status.behind ? <>
                {!!status.ahead && <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums" title={t("{0} commits to push", { "0": status.ahead })}><ArrowUp size={11} />{t("{0} outgoing", { "0": status.ahead })}</span>}
                {!!status.behind && <span className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums" title={t("{0} commits to pull", { "0": status.behind })}><ArrowDown size={11} />{t("{0} incoming", { "0": status.behind })}</span>}
              </> : <span className="git-synced [&_svg]:text-ok inline-flex items-center gap-[3px]"><Check size={11} />{t("Up to date")}</span>}
            </> : status.detached ? <span>{t("Not on a branch. Switch to one to commit and sync.")}</span>
              : !status.oid ? <span>{t("No commits yet.")}</span>
              : !status.remote ? <span>{t("Local only. Add a remote to push.")}</span>
              : <span>{t("Not published yet. Sync to publish it.")}</span>
          }</div>}
        </div>
        <TabsList className="git-tabs" aria-label={t("Git view")}>
          <TabsTrigger value="commits" className="git-tab" aria-label={t("Commits")}>{t("Commits")}</TabsTrigger>
          <TabsTrigger value="stashes" className="git-tab" aria-label={t("Stashes ({0})", { "0": stashes.length })}>{t("Stashes")}{!!stashes.length && <span className="git-tab-count inline-grid place-items-center min-w-4 h-4 p-[0_4px] rounded-(--radius-s) bg-accent text-soft text-[length:10px] leading-[1] tabular-nums">{stashes.length}</span>}</TabsTrigger>
        </TabsList>
        <TabsContent value="commits" className="git-pane">
          <OverlayScrollArea className="git-history">{loading ? <ContentSkeleton /> : commits.length ? <div className="git-graph [&_.commit-file-tree]:m-[2px_0_4px] [&_.commit-file-tree]:pl-5 [&_.commit-file-tree::before]:[content:none] flex flex-col">{commits.map((commit) => <CommitHistoryRow key={commit.oid} taskId={taskId} binding={binding} commit={commit} branch={status?.branch ?? null} onUndo={commit.oid === status?.oid ? () => requestUndo(commit) : undefined} undoDisabled={!canUndo} />)}</div> : <p className="muted text-muted-foreground small text-caption git-empty m-[2px_0] p-1.5 text-caption leading-[1.5]">{t("No commits yet.")}</p>}</OverlayScrollArea>
        </TabsContent>
        <TabsContent value="stashes" className="git-pane git-stashes"><OverlayScrollArea className="git-history">
          {stashes.map((stash) => <div key={stash.oid} className="stash-row">
            <span className="stash-name" title={`${stash.ref} · ${stash.subject}`}><Archive size={13} /><span>{stash.subject.replace(/^On [^:]+: /, '')}</span></span>
            <span className="stash-actions">
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Apply {0}", { "0": stash.subject })} title={t("Apply (keep the stash)")} onClick={() => void applyStash(stash)}><Copy size={13} /></Button>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Pop {0}", { "0": stash.subject })} title={t("Pop (apply and remove)")} onClick={() => void popStash(stash)}><ArchiveRestore size={13} /></Button>
              <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" disabled={busy} aria-label={t("Delete {0}", { "0": stash.subject })} title={t("Delete stash")} onClick={() => setConfirmation({ kind: 'drop-stash', oid: stash.oid, title: stash.subject })}><Trash2 size={13} /></Button>
            </span>
          </div>)}
          {loading && <ContentSkeleton />}
          {!loading && !stashes.length && <p className="muted text-muted-foreground small text-caption git-empty m-[2px_0] p-1.5 text-caption leading-[1.5]">{t("No saved stashes.")}</p>}
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover git-stash-new" disabled={busy || !canStash} title={canStash ? undefined : t("Nothing to stash")} onClick={() => { setOperationName(''); setConfirmation({ kind: 'stash' }) }}><Plus size={13} />{t("Stash changes…")}</Button>
        </OverlayScrollArea></TabsContent>
      </>}
    </Tabs>)}
  </div>
}
