import { t, useLanguage } from './i18n'
// Renderer-side workspace state: projects, tasks, open task tabs and their view tabs.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NO_PROJECT, type TaskStatus } from '../../shared/types'
import type {
  Project,
  Repository,
  RepositoryBinding,
  Task,
  TaskUiState,
  ViewDescriptor,
  WorkspaceUiState,
  WorktreeWorkspace,
} from '../../shared/types'
import { useAppSettings } from './AppSettings'
import { invoke, ramu } from './ipc'
import { splitTerminal, terminalFocusAfterClose, terminalGroups, unsplitTerminal } from '../../shared/terminalGroups'

type ViewInput = ViewDescriptor extends infer V ? (V extends ViewDescriptor ? Omit<V, 'id'> : never) : never

export interface WorkspaceApi {
  projects: Project[]
  repos: Record<string, Repository[]>
  workspaces: WorktreeWorkspace[]
  composingWorkspace: string | null
  tasks: Task[]
  ui: WorkspaceUiState
  taskUi: Record<string, TaskUiState>
  bindings: Record<string, RepositoryBinding[]>
  dirty: Record<string, boolean>
  /** Project whose start screen is showing (New chat), or null. */
  composing: string | null
  /** Chats that finished (or need you) while you were looking elsewhere; cleared when you open them. */
  unread: ReadonlySet<string>
  /** Back to the Chats landing: recaps, the review inbox and the start box, with no chat open. */
  showHome(): void
  newTask(projectId?: string): void
  cancelNewTask(): void
  /** Opens a project as a workspace: its files, terminals and changes, no task needed. */
  openProject(projectId: string): void
  /** Display name for a context: a task title or a project name. */
  titleOf(ctx: string): string
  refresh(): Promise<void>
  refreshBindings(taskId: string): Promise<RepositoryBinding[]>
  setSidebar(s: WorkspaceUiState['sidebar']): void
  openTask(taskId: string): void
  closeTask(taskId: string): void
  /** Drops a deleted or archived task from the open set without prompting. */
  forgetTask(taskId: string): void
  activateTask(taskId: string): void
  workspaceOf(taskId: string): string
  openView(taskId: string, view: ViewInput): void
  /** Turns a preview tab into a regular one, so the next preview no longer replaces it. */
  keepView(taskId: string, viewId: string): void
  reopenClosedView(taskId: string): void
  renameFileViews(taskId: string, repoId: string, path: string, destination: string): void
  closeView(taskId: string, viewId: string): void
  closeViews(taskId: string, viewIds: string[]): void
  activateView(taskId: string, viewId: string): void
  showChat(taskId: string): void
  setTerminalPanel(taskId: string, settings: Partial<Pick<TaskUiState, 'terminalOpen' | 'terminalLayout' | 'terminalGroups' | 'terminalTabPosition' | 'terminalHeight' | 'terminalDock'>>): void
  splitTerminal(taskId: string, direction: 'horizontal' | 'vertical'): void
  unsplitTerminal(taskId: string, terminalId: string): void
  setDockWidth(taskId: string, width: number): void
  /** Forget every dragged editor/chat split and terminal height, in all workspaces. */
  resetLayoutSizes(): void
  setDirty(viewId: string, dirty: boolean): void
  binding(taskId: string, repoId: string): RepositoryBinding | undefined
  task(taskId: string): Task | undefined
  projectOf(taskId: string): Project | undefined
}

const Ctx = createContext<WorkspaceApi | null>(null)

export function useWorkspace(): WorkspaceApi {
  const ws = useContext(Ctx)
  if (!ws) throw new Error('WorkspaceProvider missing')
  return ws
}

/** Files, diffs and commit views open in one reusable preview tab until edited or kept open. */
export function isPreviewable(v: ViewInput | ViewDescriptor): v is Extract<ViewInput | ViewDescriptor, { kind: 'file' | 'diff' | 'git' }> {
  return v.kind === 'file' || v.kind === 'diff' || v.kind === 'git'
}

function viewKey(v: ViewInput | ViewDescriptor): string {
  switch (v.kind) {
    case 'file':
      return `file:${v.repoId}:${v.path}`
    case 'diff':
      return `diff:${v.repoId}:${v.path}:${v.oid ?? v.staged}`
    case 'git':
      return `git:${v.repoId}:${v.oid ?? 'upstream'}`
    case 'review':
      return `review:${v.taskId}`
    case 'agent':
      return `agent:${v.sessionId}`
    case 'terminal':
      // Several terminals per repository are allowed.
      return `terminal:${crypto.randomUUID()}`
  }
}

/** Stable view order: conversations first, followed by the other views in opening order. */
export function tabOrder(views: ViewDescriptor[]): ViewDescriptor[] {
  return [...views.filter((v) => v.kind === 'agent'), ...views.filter((v) => v.kind !== 'agent')]
}

/** The active tab is the main content; the last focused conversation is the one docked beside files. */
function focus(s: TaskUiState, v: ViewDescriptor): TaskUiState {
  if (v.kind === 'terminal') return { ...s, activeTerminalId: v.id, terminalOpen: true }
  return { ...s, activeViewId: v.id, activeAgentViewId: v.kind === 'agent' ? v.id : s.activeAgentViewId }
}

/** A context is a task id, or "project:<id>" for a project's own workspace view. */
export const projectCtx = (projectId: string) => `project:${projectId}`
export const worktreeCtx = (id: string) => `worktree:${id}`
export const isWorktreeCtx = (ctx: string) => ctx.startsWith('worktree:')
export const isWorkspaceCtx = (ctx: string) => isProjectCtx(ctx) || isWorktreeCtx(ctx)
export const isProjectCtx = (ctx: string) => ctx.startsWith('project:')

const EMPTY_TASK_UI: TaskUiState = { views: [], activeViewId: null }

export function WorkspaceProvider({ children }: { children: (loaded: boolean) => ReactNode }) {
  const language = useLanguage()
  const { preferences } = useAppSettings()
  const closedEditors = useRef<Record<string, ViewInput[]>>({})
  const [loaded, setLoaded] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [repos, setRepos] = useState<Record<string, Repository[]>>({})
  const [workspaces, setWorkspaces] = useState<WorktreeWorkspace[]>([])
  const [composingWorkspace, setComposingWorkspace] = useState<string | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [ui, setUi] = useState<WorkspaceUiState>({ openTaskIds: [], activeTaskId: null, sidebar: 'projects' })
  const [taskUi, setTaskUi] = useState<Record<string, TaskUiState>>({})
  const [bindings, setBindings] = useState<Record<string, RepositoryBinding[]>>({})
  const [dirty, setDirtyMap] = useState<Record<string, boolean>>({})
  const [composing, setComposing] = useState<string | null>(null)
  const dirtyTasks = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    const ps = await invoke('projects.list')
    const rs: Record<string, Repository[]> = {}
    for (const p of ps) rs[p.id] = await invoke('repos.list', p.id)
    setProjects(ps)
    setRepos(rs)
    const chats = await invoke('tasks.list')
    const isolated = await invoke('workspaces.list')
    setTasks(chats)
    setWorkspaces(isolated)
    const known = new Set([...chats.map((t) => t.id), ...ps.map((p) => projectCtx(p.id)), ...isolated.map((w) => worktreeCtx(w.id))])
    setUi((u) => {
      const openTaskIds = u.openTaskIds.filter((id) => known.has(id))
      return { ...u, openTaskIds, activeTaskId: u.activeTaskId && known.has(u.activeTaskId) ? u.activeTaskId : openTaskIds.at(-1) ?? null }
    })
    // Current-checkout contexts follow their project's repositories, so re-read open bindings.
    setBindings((current) => {
      for (const ctx of Object.keys(current)) void invoke('tasks.bindings', ctx).then((bs) => setBindings((m) => ({ ...m, [ctx]: bs })), () => undefined)
      return current
    })
  }, [])

  const refreshBindings = useCallback(async (taskId: string) => {
    const bs = await invoke('tasks.bindings', taskId)
    setBindings((m) => ({ ...m, [taskId]: bs }))
    return bs
  }, [])

  // Restore the previous session's UI.
  useEffect(() => {
    void (async () => {
      await refresh()
      const saved = await invoke('ui.get')
      const known = new Set([...(await invoke('tasks.list')).map((t) => t.id), ...(await invoke('projects.list')).map((p) => projectCtx(p.id)), ...(await invoke('workspaces.list')).map((w) => worktreeCtx(w.id))])
      const openTaskIds = saved.workspace.openTaskIds.filter((t) => known.has(t))
      setUi({
        ...saved.workspace,
        openTaskIds,
        activeTaskId: null, sidebar: 'projects',
      })
      const contextsToRestore = new Set(openTaskIds.filter(isWorkspaceCtx))
      for (const task of (await invoke('tasks.list'))) {
        const own = saved.tasks[task.id]
        if (!own || task.projectId === NO_PROJECT) continue
        const ctx = task.projectId === NO_PROJECT ? task.id : task.workspaceId ? worktreeCtx(task.workspaceId) : projectCtx(task.projectId)
        if (openTaskIds.includes(task.id)) contextsToRestore.add(ctx)
        const shared = saved.tasks[ctx] ?? { views: [], activeViewId: null }
        shared.views = shared.views.filter((v) => v.kind !== 'agent')
        for (const view of own.views.filter((v) => v.kind !== 'agent')) {
          const existing = shared.views.find((v) => v.id === view.id || view.kind !== 'terminal' && viewKey(v) === viewKey(view))
          if (!existing) shared.views.push(view)
          else if (own.activeViewId === view.id) own.activeViewId = existing.id
        }
        own.views = own.views.filter((v) => v.kind === 'agent')
        saved.tasks[ctx] = shared
        dirtyTasks.current.add(task.id); dirtyTasks.current.add(ctx)
      }
      setTaskUi(saved.tasks)
      for (const ctx of Object.keys(saved.tasks).filter((ctx) => contextsToRestore.has(ctx))) await refreshBindings(ctx)
      for (const t of openTaskIds) await refreshBindings(t)
      setLoaded(true)
    })()
  }, [refresh, refreshBindings])

  // Persist UI state (debounced).
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void invoke('ui.setWorkspace', ui), 250)
    return () => clearTimeout(t)
  }, [ui, loaded])
  useEffect(() => {
    if (!loaded || !dirtyTasks.current.size) return
    const t = setTimeout(() => {
      for (const id of dirtyTasks.current) void invoke('ui.setTask', id, taskUi[id] ?? EMPTY_TASK_UI)
      dirtyTasks.current.clear()
    }, 250)
    return () => clearTimeout(t)
  }, [taskUi, loaded])

  // A chat that stops working while you look elsewhere stays marked until you open it.
  const [unread, setUnread] = useState<Set<string>>(() => { try { return new Set(JSON.parse(localStorage.getItem('ramu.unread') ?? '[]') as string[]) } catch { return new Set() } })
  const previousStatus = useRef(new Map<string, TaskStatus>())
  useEffect(() => {
    const evaluate = () => setUnread((current) => {
      const next = new Set(current)
      const ids = new Set(tasks.map((task) => task.id))
      for (const task of tasks) {
        const before = previousStatus.current.get(task.id)
        const watching = ui.activeTaskId === task.id && !composing && document.hasFocus()
        if (before === 'running' && (task.status === 'ready-for-review' || task.status === 'needs-input' || task.status === 'failed') && !watching) next.add(task.id)
        if (watching) next.delete(task.id)
        previousStatus.current.set(task.id, task.status)
      }
      for (const id of next) if (!ids.has(id)) next.delete(id)
      if (next.size === current.size && [...next].every((id) => current.has(id))) return current
      try { localStorage.setItem('ramu.unread', JSON.stringify([...next])) } catch { /* Marks still work for this session. */ }
      return next
    })
    evaluate()
    window.addEventListener('focus', evaluate)
    return () => window.removeEventListener('focus', evaluate)
  }, [tasks, ui.activeTaskId, composing])

  // Chat badges follow authoritative session state, including background projects.
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const automation = ramu.on('automation:changed', () => { void refresh() })
    const off = ramu.on('agent:event', ({ event }) => {
      if (event.kind !== 'state') return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const current = ++request
        void invoke('tasks.list').then((chats) => { if (!disposed && current === request) setTasks(chats) }, () => undefined)
      }, 50)
    })
    return () => { disposed = true; off(); automation(); clearTimeout(timer) }
  }, [])

  // Branch switches and worktree changes are picked up when bindings are re-read.
  useEffect(() => ramu.on('fs:changed', ({ path }) => {
    if (path === '.git/HEAD') void refresh()
  }), [refresh])

  // Stable identity: editors depend on it in effects and must not be recreated when dirty state changes.
  const setDirty = useCallback(
    (viewId: string, d: boolean) => {
      setDirtyMap((m) => (m[viewId] === d ? m : { ...m, [viewId]: d }))
      if (d) setTaskUi((current) => Object.fromEntries(Object.entries(current).map(([owner, state]) => {
        if (!state.views.some((view) => view.id === viewId && isPreviewable(view) && view.preview)) return [owner, state]
        dirtyTasks.current.add(owner)
        return [owner, { ...state, views: state.views.map((view) => view.id === viewId && isPreviewable(view) ? { ...view, preview: false } : view) }]
      })))
    },
    [],
  )

  const updateTaskUi = useCallback((taskId: string, fn: (s: TaskUiState) => TaskUiState) => {
    dirtyTasks.current.add(taskId)
    setTaskUi((m) => ({ ...m, [taskId]: fn(m[taskId] ?? EMPTY_TASK_UI) }))
  }, [])

  const api = useMemo<WorkspaceApi>(() => {
    const workspaceOf = (ctx: string) => {
      const task = tasks.find((t) => t.id === ctx)
      return task ? task.projectId === NO_PROJECT ? task.id : task.workspaceId ? worktreeCtx(task.workspaceId) : projectCtx(task.projectId) : ctx
    }
    const effectiveUi = { ...taskUi }
    for (const task of tasks) {
      const own = taskUi[task.id] ?? EMPTY_TASK_UI
      const shared = taskUi[workspaceOf(task.id)] ?? EMPTY_TASK_UI
      effectiveUi[task.id] = { ...shared, ...own, activeViewId: shared.activeViewId ?? own.activeAgentViewId ?? own.views.find((view) => view.kind === 'agent')?.id ?? null, dockWidth: shared.dockWidth, dockHidden: shared.dockHidden, views: [...own.views.filter((v) => v.kind === 'agent'), ...shared.views.filter((v) => v.kind !== 'agent')], activeTerminalId: shared.activeTerminalId, terminalOpen: shared.terminalOpen, terminalLayout: shared.terminalLayout, terminalGroups: shared.terminalGroups, terminalTabPosition: shared.terminalTabPosition, terminalHeight: shared.terminalHeight, terminalDock: shared.terminalDock }
    }
    const viewsOf = (taskId: string) => effectiveUi[taskId]?.views ?? []
    const closeViews = (taskId: string, viewIds: string[]) => {
      const requested = new Set(viewIds)
      const targets = viewsOf(taskId).filter((view) => requested.has(view.id))
      if (!targets.length) return
      const unsaved = targets.filter((view) => dirty[view.id])
      if (unsaved.length && !confirm(unsaved.length === 1 ? t('Discard unsaved changes and close this tab?') : t('Discard unsaved changes in {count} files and close these tabs?', { count: unsaved.length }))) return
      const owner = workspaceOf(taskId)
      const remembered = targets.filter((view) => isPreviewable(view) || view.kind === 'review').map((view) => isPreviewable(view) ? { ...view, preview: false } : view)
      closedEditors.current[owner] = [...(closedEditors.current[owner] ?? []), ...remembered].slice(-20)
      const closed = new Set(targets.map((view) => view.id))
      setDirtyMap((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !closed.has(id))))
      const owners = new Map<string, Set<string>>()
      for (const view of targets) {
        const owner = view.kind === 'agent' ? taskId : workspaceOf(taskId)
        if (!owners.has(owner)) owners.set(owner, new Set())
        owners.get(owner)!.add(view.id)
      }
      for (const [owner, ids] of owners) {
        updateTaskUi(owner, (state) => {
          const ordered = tabOrder(state.views).filter((view) => view.kind !== 'terminal')
          const index = ordered.findIndex((view) => view.id === state.activeViewId)
          const views = state.views.filter((view) => !ids.has(view.id))
          const remaining = tabOrder(views).filter((view) => view.kind !== 'terminal')
          const terminals = views.filter((view) => view.kind === 'terminal')
          return {
            ...state, views,
            activeViewId: ids.has(state.activeViewId ?? '') ? remaining[Math.max(0, Math.min(index, remaining.length - 1))]?.id ?? null : state.activeViewId,
            activeAgentViewId: ids.has(state.activeAgentViewId ?? '') ? views.filter((view) => view.kind === 'agent').at(-1)?.id ?? null : state.activeAgentViewId,
            terminalGroups: terminalGroups({ ...state, views }),
            activeTerminalId: terminalFocusAfterClose(state, ids),
            terminalOpen: terminals.length ? state.terminalOpen : false,
          }
        })
        if (owner !== taskId) updateTaskUi(taskId, (state) => ({ ...state, activeViewId: ids.has(state.activeViewId ?? '') ? state.activeAgentViewId ?? null : state.activeViewId }))
      }
    }
    return {
      projects,
      repos,
      tasks,
      workspaces,
      composingWorkspace,
      ui,
      taskUi: effectiveUi,
      workspaceOf,
      bindings,
      dirty,
      composing,
      unread,
      showHome() {
        setComposing(null)
        setComposingWorkspace(null)
        setUi((u) => ({ ...u, activeTaskId: null, sidebar: 'projects' }))
      },
      newTask(projectId) {
        const active = ui.activeTaskId
        const activeChat = tasks.find((t) => t.id === active)
        const isolated = active && isWorktreeCtx(active) ? active.slice('worktree:'.length) : activeChat?.workspaceId
        const current = active ? (isProjectCtx(active) ? active.slice('project:'.length) : isWorktreeCtx(active) ? workspaces.find((w) => w.id === isolated)?.projectId : activeChat?.projectId) : undefined
        const target = projectId ?? current ?? NO_PROJECT
        if (target) {
          const selectedWorkspace = target === current ? isolated ?? null : null
          setComposingWorkspace(selectedWorkspace)
          if (target === NO_PROJECT) {
            setUi((u) => ({ ...u, activeTaskId: null, sidebar: 'projects' }))
            setComposing(NO_PROJECT)
            return
          }
          const ctx = selectedWorkspace ? worktreeCtx(selectedWorkspace) : projectCtx(target)
          void refreshBindings(ctx)
          updateTaskUi(ctx, (state) => ({ ...state, activeViewId: null }))
          setUi((u) => ({ ...u, openTaskIds: [...new Set([...u.openTaskIds, ctx])], activeTaskId: ctx, sidebar: 'projects' }))
          setComposing(target)
        }
      },
      cancelNewTask: () => setComposing(null),
      openProject(projectId) {
        setComposingWorkspace(null)
        const ctx = projectCtx(projectId)
        setComposing(null)
        void refreshBindings(ctx)
        setUi((u) => ({
          ...u,
          openTaskIds: u.openTaskIds.includes(ctx) ? u.openTaskIds : [...u.openTaskIds, ctx],
          activeTaskId: ctx,
        }))
      },
      titleOf(ctx) {
        if (isWorktreeCtx(ctx)) return workspaces.find((w) => w.id === ctx.slice('worktree:'.length))?.name ?? t('Isolated worktree')
        if (isProjectCtx(ctx)) return projects.find((p) => p.id === ctx.slice('project:'.length))?.name ?? t('Project')
        return tasks.find((t) => t.id === ctx)?.title ?? ''
      },
      refresh,
      refreshBindings,
      setSidebar: (sidebar) => setUi((u) => ({ ...u, sidebar })),
      openTask(taskId) {
        setComposing(null)
        void refreshBindings(taskId)
        const shared = workspaceOf(taskId)
        if (shared !== taskId) void refreshBindings(shared)
        setUi((u) => ({
          ...u,
          openTaskIds: [...new Set([...u.openTaskIds, shared, taskId])],
          activeTaskId: taskId, sidebar: u.sidebar === 'schedules' ? 'projects' : u.sidebar,
        }))
      },
      closeTask(taskId) {
        // Closing a task tab never stops agents or deletes files or worktrees.
        if (workspaceOf(taskId) === taskId && viewsOf(taskId).some((v) => dirty[v.id]) && !confirm(t('This workspace has unsaved files. Close it and discard those edits?'))) return
        setUi((u) => {
          const openTaskIds = u.openTaskIds.filter((t) => t !== taskId)
          return { ...u, openTaskIds, activeTaskId: u.activeTaskId === taskId ? (openTaskIds.at(-1) ?? null) : u.activeTaskId }
        })
      },
      forgetTask(taskId) {
        setUi((u) => {
          const openTaskIds = u.openTaskIds.filter((t) => t !== taskId)
          return { ...u, openTaskIds, activeTaskId: u.activeTaskId === taskId ? (openTaskIds.at(-1) ?? null) : u.activeTaskId }
        })
      },
      activateTask: (taskId) => {
        setComposing(null)
        setUi((u) => ({ ...u, activeTaskId: taskId }))
      },
      openView(taskId, view) {
        const owner = view.kind === 'agent' ? taskId : workspaceOf(taskId)
        if (view.kind === 'agent') updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, activeViewId: null }))
        const key = viewKey(view)
        const previous = taskUi[owner]?.views.find((v) => viewKey(v) === key)
        // A first open is a preview unless the caller pins it (preview: false); reopening never turns a kept tab back into a preview.
        const preview = preferences.previewTabs && isPreviewable(view) && view.preview !== false
        const desc: ViewDescriptor = previous?.kind === 'review' && view.kind === 'review' ? { ...previous, ...view } : previous?.kind === 'agent' && view.kind === 'agent' ? { ...previous, sourceSeq: view.sourceSeq } : previous && previous.kind === 'file' && view.kind === 'file' ? { ...previous, ...(view.selection ? { selection: view.selection } : {}), preview: !!previous.preview && preview } : previous && isPreviewable(previous) ? { ...previous, preview: !!previous.preview && preview } : previous ?? ({ ...view, ...(isPreviewable(view) ? { preview } : {}), id: crypto.randomUUID() } as ViewDescriptor)
        if (owner !== taskId && desc.kind !== 'terminal') updateTaskUi(taskId, (own) => ({ ...own, activeViewId: desc.id }))
        updateTaskUi(owner, (s) => {
          const existing = s.views.find((v) => v.id === desc.id)
          // The new preview replaces the previous one, unless that one has unsaved edits.
          const keep = s.views.filter((entry) => existing || !isPreviewable(desc) || !desc.preview || !isPreviewable(entry) || !entry.preview || dirty[entry.id])
          const views = existing ? s.views.map((entry) => entry.id === desc.id ? desc : entry) : [...keep, desc]
          return focus({ ...s, views, ...(desc.kind === 'terminal' ? { terminalGroups: [...terminalGroups(s), { id: desc.id, terminalIds: [desc.id], layout: 'horizontal' as const }] } : {}) }, desc)
        })
      },
      keepView(taskId, viewId) {
        const view = viewsOf(taskId).find((entry) => entry.id === viewId)
        if (!view || !isPreviewable(view) || !view.preview) return
        const { id: _id, ...input } = view
        api.openView(taskId, { ...input, preview: false })
      },
      reopenClosedView(taskId) {
        const view = closedEditors.current[workspaceOf(taskId)]?.pop()
        if (view) api.openView(taskId, view)
      },
      renameFileViews(taskId, repoId, path, destination) {
        updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, views: state.views.map((view) => {
          if ((view.kind !== 'file' && view.kind !== 'diff') || view.repoId !== repoId || view.kind === 'diff' && view.oid || view.path !== path && !view.path.startsWith(`${path}/`)) return view
          return { ...view, path: destination + view.path.slice(path.length) }
        }) }))
      },
      closeView: (taskId, viewId) => closeViews(taskId, [viewId]),
      closeViews,
      showChat(taskId) {
        const owner = workspaceOf(taskId)
        updateTaskUi(owner, (state) => ({ ...state, activeViewId: null }))
        if (owner !== taskId) updateTaskUi(taskId, (state) => ({ ...state, activeViewId: null }))
      },
      activateView(taskId, viewId) {
        const view = viewsOf(taskId).find((v) => v.id === viewId)
        if (!view) return
        if (view.kind === 'agent') updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, activeViewId: null }))
        const owner = view.kind === 'agent' ? taskId : workspaceOf(taskId)
        updateTaskUi(owner, (s) => focus(s, view))
        if (owner !== taskId && view.kind !== 'terminal') updateTaskUi(taskId, (s) => ({ ...s, activeViewId: viewId }))
      },
      setTerminalPanel: (taskId, settings) => updateTaskUi(workspaceOf(taskId), (s) => ({ ...s, ...settings })),
      splitTerminal: (taskId, direction) => { const id = crypto.randomUUID(); updateTaskUi(workspaceOf(taskId), (s) => splitTerminal(s, direction, id)) },
      unsplitTerminal: (taskId, terminalId) => updateTaskUi(workspaceOf(taskId), (s) => unsplitTerminal(s, terminalId)),
      setDockWidth: (taskId, width) => updateTaskUi(workspaceOf(taskId), (s) => ({ ...s, dockWidth: Math.round(width) })),
      resetLayoutSizes: () => setTaskUi((m) => Object.fromEntries(Object.entries(m).map(([id, state]) => { dirtyTasks.current.add(id); const { dockWidth: _dock, terminalHeight: _terminal, ...rest } = state; return [id, rest] }))),
      setDirty,
      binding: (taskId, repoId) => bindings[taskId]?.find((b) => b.repoId === repoId),
      task: (taskId) => tasks.find((t) => t.id === taskId),
      projectOf(taskId) {
        if (isWorktreeCtx(taskId)) return projects.find((p) => p.id === workspaces.find((w) => w.id === taskId.slice('worktree:'.length))?.projectId)
        if (isProjectCtx(taskId)) return projects.find((p) => p.id === taskId.slice('project:'.length))
        const t = tasks.find((x) => x.id === taskId)
        return t && projects.find((p) => p.id === t.projectId)
      },
    }
  }, [projects, repos, tasks, workspaces, composingWorkspace, ui, taskUi, bindings, dirty, composing, refresh, refreshBindings, updateTaskUi, setDirty, unread, preferences.previewTabs, language])

  return <Ctx.Provider value={api}>{children(loaded)}</Ctx.Provider>
}
