import { closingPanel } from '@ramu/shared/workspace/panelClose'
import { showChat } from './layoutPrefs'
import { persistentTaskUi } from '@ramu/shared/workspace/sourceNavigation'
import { animatePanelChange, type PanelMotionScope } from './panelMotion'
import { t, useLanguage } from '../i18n'
// Renderer-side workspace state: projects, tasks, open task tabs and their view tabs.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NO_PROJECT, type TaskStatus } from '@ramu/shared/types'
import type {
  Project,
  Repository,
  RepositoryBinding,
  Task,
  TaskUiState,
  ViewDescriptor,
  WorkspaceUiState,
  WorktreeWorkspace,
} from '@ramu/shared/types'
import { useAppSettings } from '../settings/AppSettings'
import { invoke, ramu } from '../ipc'
import { closeAfterTerminalCheck } from './terminalRegistry'
import {
  splitTerminal,
  terminalFocusAfterClose,
  terminalGroups,
  unsplitTerminal,
} from '@ramu/shared/workspace/terminalGroups'
import { onWorkspaceVisibility, workspaceVisible } from './workspaceLifetime'
import { registerWorkspaceCheckpoint } from './workspaceCheckpoint'

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
  /** Whether a sidebar section or project is expanded, and the setter that remembers it across restarts. */
  isExpanded(key: string): boolean
  setExpanded(key: string, expanded: boolean): void
  openTask(taskId: string): void
  closeTask(taskId: string): void
  /** Drops a deleted or archived task from the open set without prompting. */
  forgetTask(taskId: string): void
  activateTask(taskId: string): void
  workspaceOf(taskId: string): string
  openView(taskId: string, view: ViewInput): void
  consumeSourceNavigation(taskId: string, viewId: string, requestId?: string): void
  /** Turns a preview tab into a regular one, so the next preview no longer replaces it. */
  keepView(taskId: string, viewId: string): void
  reopenClosedView(taskId: string): void
  renameFileViews(taskId: string, repoId: string, path: string, destination: string): void
  /** Reorders an editor tab: places it before (or after) `targetId`. */
  moveView(taskId: string, viewId: string, targetId: string, after: boolean): void
  closeView(taskId: string, viewId: string): void
  closeViews(taskId: string, viewIds: string[]): void
  activateView(taskId: string, viewId: string): void
  showChat(taskId: string): void
  /** Reopens the workspace on the tab that was open when it was hidden (or the newest editor tab). */
  showWorkspace(taskId: string): void
  /** Hides the workspace pane and terminal without closing tabs; `showWorkspace` brings both back. */
  hideWorkspace(taskId: string): void
  /** Hides everything on the right (tool panel and workspace), or brings back what was hidden. */
  toggleRightPanel(taskId: string): void
  /** An editor tab or a right-docked terminal is showing beside the chat. */
  workspaceVisible(taskId: string): boolean
  setTerminalPanel(
    taskId: string,
    settings: Partial<
      Pick<
        TaskUiState,
        | 'terminalOpen'
        | 'restoreTerminal'
        | 'terminalLayout'
        | 'terminalGroups'
        | 'terminalTabPosition'
        | 'terminalHeight'
        | 'terminalDock'
      >
    >,
  ): void
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
type WorkspaceActions = Pick<
  WorkspaceApi,
  'task' | 'refresh' | 'openTask' | 'openView' | 'newTask' | 'consumeSourceNavigation'
>
const ActionsCtx = createContext<WorkspaceActions | null>(null)

/** Commands read fresh state when called, without subscribing to panel/UI changes. */
export function useWorkspaceActions(): WorkspaceActions {
  const actions = useContext(ActionsCtx)
  if (!actions) throw new Error('WorkspaceProvider missing')
  return actions
}

export function useWorkspace(): WorkspaceApi {
  const ws = useContext(Ctx)
  if (!ws) throw new Error('WorkspaceProvider missing')
  return ws
}

/** Previewable views can reuse a tab when opened for browsing. */
export function isPreviewable(
  v: ViewInput | ViewDescriptor,
): v is Extract<ViewInput | ViewDescriptor, { kind: 'file' | 'diff' | 'git' }> {
  return v.kind === 'file' || v.kind === 'diff' || v.kind === 'git'
}

function viewKey(v: ViewInput | ViewDescriptor): string {
  switch (v.kind) {
    case 'file':
      return `file:${v.repoId}:${v.path}`
    case 'diff':
      return `diff:${v.repoId}:${v.path}:${v.oid ?? v.staged}${v.stash ? ':stash' : ''}`
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
function focus(s: TaskUiState, v: ViewDescriptor, defaultDock: 'right' | 'bottom'): TaskUiState {
  if (v.kind === 'terminal')
    return {
      ...s,
      activeTerminalId: v.id,
      terminalOpen: true,
      ...((s.terminalDock ?? defaultDock) === 'right'
        ? {
            activeViewId: v.id,
            terminalReturnViewId: s.views.some((view) => view.id === s.activeViewId && view.kind === 'terminal')
              ? s.terminalReturnViewId
              : s.activeViewId,
          }
        : {}),
    }
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
  const snapshot = useRef({ loaded, ui, taskUi, dirty, composing, composingWorkspace })
  snapshot.current = { loaded, ui, taskUi, dirty, composing, composingWorkspace }
  useEffect(
    () =>
      registerWorkspaceCheckpoint(async () => {
        const current = snapshot.current
        if (
          !current.loaded ||
          Object.values(current.dirty).some(Boolean) ||
          Object.values(current.taskUi).some((state) => state.views.some((view) => view.kind === 'terminal'))
        )
          return false
        // Keep local UI state authoritative on cache restoration, even if a host's older debounce finished later.
        const resume = JSON.stringify({
          workspace: current.ui,
          tasks: current.taskUi,
          composing: current.composing,
          composingWorkspace: current.composingWorkspace,
        })
        // A clean offline workspace can sleep too: this checkpoint belongs to the client, not its host.
        localStorage.setItem('ramu.workspace.resume', resume)
        return true
      }),
    [],
  )

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
    const known = new Set([
      ...chats.map((t) => t.id),
      ...ps.map((p) => projectCtx(p.id)),
      ...isolated.map((w) => worktreeCtx(w.id)),
    ])
    setUi((u) => {
      const openTaskIds = u.openTaskIds.filter((id) => known.has(id))
      return {
        ...u,
        openTaskIds,
        activeTaskId: u.activeTaskId && known.has(u.activeTaskId) ? u.activeTaskId : (openTaskIds.at(-1) ?? null),
      }
    })
    // Current-checkout contexts follow their project's repositories, so re-read open bindings.
    setBindings((current) => {
      for (const ctx of Object.keys(current))
        void invoke('tasks.bindings', ctx).then(
          (bs) => setBindings((m) => ({ ...m, [ctx]: bs })),
          () => undefined,
        )
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
      let resume: {
        workspace: WorkspaceUiState
        tasks: Record<string, TaskUiState>
        composing: string | null
        composingWorkspace: string | null
      } | null
      try {
        resume = JSON.parse(localStorage.getItem('ramu.workspace.resume') ?? 'null')
        if (resume?.workspace && resume?.tasks) {
          saved.workspace = resume.workspace
          saved.tasks = resume.tasks
        } else resume = null
      } catch {
        resume = null
      }
      saved.tasks = Object.fromEntries(Object.entries(saved.tasks).map(([id, state]) => [id, persistentTaskUi(state)]))
      const known = new Set([
        ...(await invoke('tasks.list')).map((t) => t.id),
        ...(await invoke('projects.list')).map((p) => projectCtx(p.id)),
        ...(await invoke('workspaces.list')).map((w) => worktreeCtx(w.id)),
      ])
      const openTaskIds = saved.workspace.openTaskIds.filter((t) => known.has(t))
      setUi({
        ...saved.workspace,
        openTaskIds,
        activeTaskId:
          resume && saved.workspace.activeTaskId && known.has(saved.workspace.activeTaskId)
            ? saved.workspace.activeTaskId
            : null,
        sidebar: resume ? saved.workspace.sidebar : 'projects',
      })
      const contextsToRestore = new Set(openTaskIds.filter(isWorkspaceCtx))
      for (const task of await invoke('tasks.list')) {
        const own = saved.tasks[task.id]
        if (!own || task.projectId === NO_PROJECT) continue
        const ctx =
          task.projectId === NO_PROJECT
            ? task.id
            : task.workspaceId
              ? worktreeCtx(task.workspaceId)
              : projectCtx(task.projectId)
        if (openTaskIds.includes(task.id)) contextsToRestore.add(ctx)
        const shared = saved.tasks[ctx] ?? { views: [], activeViewId: null }
        shared.views = shared.views.filter((v) => v.kind !== 'agent')
        for (const view of own.views.filter((v) => v.kind !== 'agent')) {
          const existing = shared.views.find(
            (v) => v.id === view.id || (view.kind !== 'terminal' && viewKey(v) === viewKey(view)),
          )
          if (!existing) shared.views.push(view)
          else if (own.activeViewId === view.id) own.activeViewId = existing.id
        }
        own.views = own.views.filter((v) => v.kind === 'agent')
        saved.tasks[ctx] = shared
        dirtyTasks.current.add(task.id)
        dirtyTasks.current.add(ctx)
      }
      setTaskUi(saved.tasks)
      if (resume) for (const id of Object.keys(saved.tasks)) dirtyTasks.current.add(id)
      for (const ctx of Object.keys(saved.tasks).filter((ctx) => contextsToRestore.has(ctx))) await refreshBindings(ctx)
      for (const t of openTaskIds) await refreshBindings(t)
      setLoaded(true)
      if (resume) {
        setComposing(resume.composing)
        setComposingWorkspace(resume.composingWorkspace)
        localStorage.removeItem('ramu.workspace.resume')
      }
    })()
  }, [refresh, refreshBindings])
  useEffect(
    () =>
      onWorkspaceVisibility(() => {
        if (workspaceVisible()) void refresh().catch(() => {})
      }),
    [refresh],
  )

  // Persist UI state (debounced).
  useEffect(() => {
    if (!loaded) return
    const t = setTimeout(() => void invoke('ui.setWorkspace', ui).catch(() => {}), 250)
    return () => clearTimeout(t)
  }, [ui, loaded])
  useEffect(() => {
    if (!loaded || !dirtyTasks.current.size) return
    const t = setTimeout(() => {
      for (const id of dirtyTasks.current)
        void invoke('ui.setTask', id, persistentTaskUi(taskUi[id] ?? EMPTY_TASK_UI)).catch(() => {
          dirtyTasks.current.add(id)
        })
      dirtyTasks.current.clear()
    }, 250)
    return () => clearTimeout(t)
  }, [taskUi, loaded])

  // A chat that stops working while you look elsewhere stays marked until you open it.
  const [unread, setUnread] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('ramu.unread') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const previousStatus = useRef(new Map<string, TaskStatus>())
  useEffect(() => {
    const evaluate = () =>
      setUnread((current) => {
        const next = new Set(current)
        const ids = new Set(tasks.map((task) => task.id))
        for (const task of tasks) {
          const before = previousStatus.current.get(task.id)
          const watching = ui.activeTaskId === task.id && !composing && document.hasFocus()
          if (
            before === 'running' &&
            (task.status === 'ready-for-review' || task.status === 'needs-input' || task.status === 'failed') &&
            !watching
          )
            next.add(task.id)
          if (watching) next.delete(task.id)
          previousStatus.current.set(task.id, task.status)
        }
        for (const id of next) if (!ids.has(id)) next.delete(id)
        if (next.size === current.size && [...next].every((id) => current.has(id))) return current
        try {
          localStorage.setItem('ramu.unread', JSON.stringify([...next]))
        } catch {
          /* Marks still work for this session. */
        }
        return next
      })
    evaluate()
    window.addEventListener('focus', evaluate)
    return () => window.removeEventListener('focus', evaluate)
  }, [tasks, ui.activeTaskId, composing])

  // Unread follows the computer's inbox too: a chat that finished while this window was closed is marked, and opening it
  // on a paired phone clears the mark here.
  useEffect(() => {
    let previous = new Set<string>()
    const apply = (list: import('@ramu/shared/chat/notices').InboxNotice[]) => {
      const done = new Set(list.filter((notice) => notice.kind === 'done').map((notice) => notice.taskId))
      setUnread((current) => {
        const next = new Set(current)
        for (const id of done) next.add(id)
        for (const id of previous) if (!done.has(id)) next.delete(id)
        if (next.size === current.size && [...next].every((id) => current.has(id))) return current
        try {
          localStorage.setItem('ramu.unread', JSON.stringify([...next]))
        } catch {
          /* Marks still work for this session. */
        }
        return next
      })
      previous = done
    }
    void invoke('notices.list').then(apply, () => {})
    return ramu.on('notices:changed', apply)
  }, [])

  // Chat badges follow authoritative session state, including background projects.
  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const automation = ramu.on('automation:changed', () => {
      void refresh()
    })
    // Chats and projects created, renamed, pinned or removed from a paired phone (or another window).
    let pending: ReturnType<typeof setTimeout> | undefined
    const changed = ramu.on('workspace:changed', () => {
      clearTimeout(pending)
      pending = setTimeout(() => void refresh().catch(() => {}), 60)
    })
    const off = ramu.on('agent:event', ({ event }) => {
      if (event.kind !== 'state' && event.kind !== 'user' && event.kind !== 'provider-wait') return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const current = ++request
        void invoke('tasks.list').then(
          (chats) => {
            if (!disposed && current === request) setTasks(chats)
          },
          () => undefined,
        )
      }, 50)
    })
    return () => {
      disposed = true
      off()
      automation()
      changed()
      clearTimeout(timer)
      clearTimeout(pending)
    }
  }, [refresh])

  // Branch switches and worktree changes are picked up when bindings are re-read.
  useEffect(
    () =>
      ramu.on('fs:changed', ({ path }) => {
        if (path === '.git/HEAD') void refresh()
      }),
    [refresh],
  )

  // Stable identity: editors depend on it in effects and must not be recreated when dirty state changes.
  const setDirty = useCallback((viewId: string, d: boolean) => {
    setDirtyMap((m) => (m[viewId] === d ? m : { ...m, [viewId]: d }))
    if (d)
      setTaskUi((current) =>
        Object.fromEntries(
          Object.entries(current).map(([owner, state]) => {
            if (!state.views.some((view) => view.id === viewId && isPreviewable(view) && view.preview))
              return [owner, state]
            dirtyTasks.current.add(owner)
            return [
              owner,
              {
                ...state,
                views: state.views.map((view) =>
                  view.id === viewId && isPreviewable(view) ? { ...view, preview: false } : view,
                ),
              },
            ]
          }),
        ),
      )
  }, [])

  const updateTaskUi = useCallback((taskId: string, fn: (s: TaskUiState) => TaskUiState) => {
    dirtyTasks.current.add(taskId)
    setTaskUi((m) => ({ ...m, [taskId]: fn(m[taskId] ?? EMPTY_TASK_UI) }))
  }, [])

  const consumeSourceNavigation = useCallback(
    (taskId: string, viewId: string, requestId?: string) => {
      updateTaskUi(taskId, (state) => ({
        ...state,
        views: state.views.map((view) => {
          if (view.id !== viewId || view.kind !== 'agent' || view.sourceRequestId !== requestId) return view
          const { sourceSeq: _seq, sourceRequestId: _request, ...rest } = view
          return rest
        }),
      }))
    },
    [updateTaskUi],
  )

  const api = useMemo<WorkspaceApi>(() => {
    const workspaceOf = (ctx: string) => {
      const task = tasks.find((t) => t.id === ctx)
      return task
        ? task.projectId === NO_PROJECT
          ? task.id
          : task.workspaceId
            ? worktreeCtx(task.workspaceId)
            : projectCtx(task.projectId)
        : ctx
    }
    const effectiveUi = { ...taskUi }
    for (const task of tasks) {
      const own = taskUi[task.id] ?? EMPTY_TASK_UI
      const shared = taskUi[workspaceOf(task.id)] ?? EMPTY_TASK_UI
      effectiveUi[task.id] = {
        ...shared,
        ...own,
        activeViewId:
          shared.activeViewId ?? own.activeAgentViewId ?? own.views.find((view) => view.kind === 'agent')?.id ?? null,
        dockWidth: shared.dockWidth,
        dockHidden: shared.dockHidden,
        views: [...own.views.filter((v) => v.kind === 'agent'), ...shared.views.filter((v) => v.kind !== 'agent')],
        activeTerminalId: shared.activeTerminalId,
        terminalReturnViewId: shared.terminalReturnViewId,
        terminalOpen: shared.terminalOpen,
        terminalLayout: shared.terminalLayout,
        terminalGroups: shared.terminalGroups,
        terminalTabPosition: shared.terminalTabPosition,
        terminalHeight: shared.terminalHeight,
        terminalDock: shared.terminalDock,
      }
    }
    const viewsOf = (taskId: string) => effectiveUi[taskId]?.views ?? []
    const closeViews = (taskId: string, viewIds: string[]) => {
      const requested = new Set(viewIds)
      const targets = viewsOf(taskId).filter((view) => requested.has(view.id))
      if (!targets.length) return
      const unsaved = targets.filter((view) => dirty[view.id])
      if (
        unsaved.length &&
        !confirm(
          unsaved.length === 1
            ? t('Discard unsaved changes and close this tab?')
            : t('Discard unsaved changes in {count} files and close these tabs?', { count: unsaved.length }),
        )
      )
        return
      const owner = workspaceOf(taskId)
      const remembered = targets
        .filter((view) => isPreviewable(view) || view.kind === 'review')
        .map((view) => (isPreviewable(view) ? { ...view, preview: false } : view))
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
          const workspaceTerminals = (state.terminalDock ?? preferences.defaultTerminalDock) === 'right'
          const ordered = tabOrder(state.views).filter((view) => workspaceTerminals || view.kind !== 'terminal')
          const index = ordered.findIndex((view) => view.id === state.activeViewId)
          const views = state.views.filter((view) => !ids.has(view.id))
          const remaining = tabOrder(views).filter((view) => workspaceTerminals || view.kind !== 'terminal')
          const terminals = views.filter((view) => view.kind === 'terminal')
          const activeViewId = ids.has(state.activeViewId ?? '')
            ? (remaining[Math.max(0, Math.min(index, remaining.length - 1))]?.id ?? null)
            : state.activeViewId
          const selectedTerminal = terminals.find((view) => view.id === activeViewId)
          return {
            ...state,
            views,
            activeViewId,
            activeAgentViewId: ids.has(state.activeAgentViewId ?? '')
              ? (views.filter((view) => view.kind === 'agent').at(-1)?.id ?? null)
              : state.activeAgentViewId,
            terminalGroups: terminalGroups({ ...state, views }),
            activeTerminalId: selectedTerminal?.id ?? terminalFocusAfterClose(state, ids),
            terminalOpen: terminals.length ? state.terminalOpen : false,
          }
        })
        if (owner !== taskId)
          updateTaskUi(taskId, (state) => ({
            ...state,
            activeViewId: ids.has(state.activeViewId ?? '') ? (state.activeAgentViewId ?? null) : state.activeViewId,
          }))
      }
    }
    const api: WorkspaceApi = {
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
        const current = active
          ? isProjectCtx(active)
            ? active.slice('project:'.length)
            : isWorktreeCtx(active)
              ? workspaces.find((w) => w.id === isolated)?.projectId
              : activeChat?.projectId
          : undefined
        const target = projectId ?? current ?? NO_PROJECT
        if (target) {
          const selectedWorkspace = target === current ? (isolated ?? null) : null
          setComposingWorkspace(selectedWorkspace)
          if (target === NO_PROJECT) {
            setUi((u) => ({ ...u, activeTaskId: null, sidebar: 'projects' }))
            setComposing(NO_PROJECT)
            return
          }
          const ctx = selectedWorkspace ? worktreeCtx(selectedWorkspace) : projectCtx(target)
          void refreshBindings(ctx)
          // Same project: keep the open file or terminal beside New chat. Another project starts on New chat alone.
          if (target !== current) updateTaskUi(ctx, (state) => ({ ...state, activeViewId: null }))
          setUi((u) => ({
            ...u,
            openTaskIds: [...new Set([...u.openTaskIds, ctx])],
            activeTaskId: ctx,
            sidebar: u.sidebar === 'schedules' || u.sidebar === 'inbox' ? 'projects' : u.sidebar,
          }))
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
        if (isWorktreeCtx(ctx))
          return workspaces.find((w) => w.id === ctx.slice('worktree:'.length))?.name ?? t('Isolated worktree')
        if (isProjectCtx(ctx)) return projects.find((p) => p.id === ctx.slice('project:'.length))?.name ?? t('Project')
        return tasks.find((t) => t.id === ctx)?.title ?? ''
      },
      refresh,
      refreshBindings,
      setSidebar: (sidebar) => setUi((u) => ({ ...u, sidebar })),
      isExpanded: (key) => !ui.collapsed?.includes(key),
      setExpanded: (key, expanded) =>
        setUi((u) => {
          const rest = (u.collapsed ?? []).filter((entry) => entry !== key)
          return { ...u, collapsed: expanded ? rest : [...rest, key] }
        }),
      openTask(taskId) {
        setComposing(null)
        void refreshBindings(taskId)
        const shared = workspaceOf(taskId)
        if (shared !== taskId) void refreshBindings(shared)
        // Opening a chat while the workspace shows only the editor would otherwise change nothing on screen.
        showChat(shared)
        setUi((u) => ({
          ...u,
          openTaskIds: [...new Set([...u.openTaskIds, shared, taskId])],
          activeTaskId: taskId,
          sidebar: u.sidebar === 'schedules' || u.sidebar === 'inbox' ? 'projects' : u.sidebar,
        }))
      },
      closeTask(taskId) {
        // Closing a task tab never stops agents or deletes files or worktrees.
        if (
          workspaceOf(taskId) === taskId &&
          viewsOf(taskId).some((v) => dirty[v.id]) &&
          !confirm(t('This workspace has unsaved files. Close it and discard those edits?'))
        )
          return
        setUi((u) => {
          const openTaskIds = u.openTaskIds.filter((t) => t !== taskId)
          return {
            ...u,
            openTaskIds,
            activeTaskId: u.activeTaskId === taskId ? (openTaskIds.at(-1) ?? null) : u.activeTaskId,
          }
        })
      },
      forgetTask(taskId) {
        setUi((u) => {
          const openTaskIds = u.openTaskIds.filter((t) => t !== taskId)
          return {
            ...u,
            openTaskIds,
            activeTaskId: u.activeTaskId === taskId ? (openTaskIds.at(-1) ?? null) : u.activeTaskId,
          }
        })
      },
      activateTask: (taskId) => {
        setComposing(null)
        setUi((u) => ({ ...u, activeTaskId: taskId }))
      },
      consumeSourceNavigation,
      openView(taskId, view) {
        if (view.kind === 'agent') view = { ...view, sourceRequestId: view.sourceSeq ? crypto.randomUUID() : undefined }
        const owner = view.kind === 'agent' ? taskId : workspaceOf(taskId)
        if (view.kind === 'agent') updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, activeViewId: null }))
        const key = viewKey(view)
        const previous = taskUi[owner]?.views.find((v) => viewKey(v) === key)
        // File opens are kept unless explicitly requested as previews (Explorer/search browsing).
        // Reopening never turns a kept tab back into a preview.
        const preview =
          preferences.previewTabs &&
          isPreviewable(view) &&
          (view.kind === 'file' ? view.preview === true : view.preview !== false)
        const desc: ViewDescriptor =
          previous?.kind === 'review' && view.kind === 'review'
            ? { ...previous, ...view }
            : previous?.kind === 'agent' && view.kind === 'agent'
              ? { ...previous, sourceSeq: view.sourceSeq, sourceRequestId: view.sourceRequestId }
              : previous && previous.kind === 'file' && view.kind === 'file'
                ? {
                    ...previous,
                    ...(view.selection ? { selection: view.selection } : {}),
                    preview: !!previous.preview && preview,
                  }
                : previous && isPreviewable(previous)
                  ? { ...previous, preview: !!previous.preview && preview }
                  : (previous ??
                    ({
                      ...view,
                      ...(isPreviewable(view) ? { preview } : {}),
                      id: crypto.randomUUID(),
                    } as ViewDescriptor))
        if (owner !== taskId && desc.kind !== 'terminal')
          updateTaskUi(taskId, (own) => ({ ...own, activeViewId: desc.id }))
        updateTaskUi(owner, (s) => {
          const existing = s.views.find((v) => v.id === desc.id)
          // The new preview replaces the previous one, unless that one has unsaved edits.
          const keep = s.views.filter(
            (entry) =>
              existing ||
              !isPreviewable(desc) ||
              !desc.preview ||
              !isPreviewable(entry) ||
              !entry.preview ||
              dirty[entry.id],
          )
          const views = existing ? s.views.map((entry) => (entry.id === desc.id ? desc : entry)) : [...keep, desc]
          return focus(
            {
              ...s,
              views,
              ...(desc.kind === 'terminal'
                ? {
                    terminalGroups: [
                      ...terminalGroups(s),
                      { id: desc.id, terminalIds: [desc.id], layout: 'horizontal' as const },
                    ],
                  }
                : {}),
            },
            desc,
            preferences.defaultTerminalDock,
          )
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
        updateTaskUi(workspaceOf(taskId), (state) => ({
          ...state,
          views: state.views.map((view) => {
            if (
              (view.kind !== 'file' && view.kind !== 'diff') ||
              view.repoId !== repoId ||
              (view.kind === 'diff' && view.oid) ||
              (view.path !== path && !view.path.startsWith(`${path}/`))
            )
              return view
            return { ...view, path: destination + view.path.slice(path.length) }
          }),
        }))
      },
      moveView(taskId, viewId, targetId, after) {
        if (viewId === targetId) return
        updateTaskUi(workspaceOf(taskId), (state) => {
          const moving = state.views.find((view) => view.id === viewId)
          if (!moving || moving.kind === 'agent') return state
          const rest = state.views.filter((view) => view.id !== viewId)
          const at = rest.findIndex((view) => view.id === targetId)
          if (at < 0) return state
          rest.splice(at + (after ? 1 : 0), 0, moving)
          return { ...state, views: rest }
        })
      },
      closeView: (taskId, viewId) => closeViews(taskId, [viewId]),
      closeViews,
      showChat(taskId) {
        const owner = workspaceOf(taskId)
        updateTaskUi(owner, (state) => {
          const current = state.views.find((view) => view.id === state.activeViewId)
          return {
            ...state,
            activeViewId: null,
            lastWorkspaceViewId: current && current.kind !== 'agent' ? current.id : state.lastWorkspaceViewId,
          }
        })
        if (owner !== taskId) updateTaskUi(taskId, (state) => ({ ...state, activeViewId: null }))
      },
      workspaceVisible(taskId) {
        const state = effectiveUi[taskId]
        if (!state) return false
        const editor = state.views.find((view) => view.id === state.activeViewId && view.kind !== 'agent')
        const terminalOpen = state.views.some((view) => view.kind === 'terminal') && (state.terminalOpen ?? true)
        return !!editor || (terminalOpen && (state.terminalDock ?? preferences.defaultTerminalDock) === 'right')
      },
      hideWorkspace(taskId) {
        const state = effectiveUi[taskId]
        const terminalOpen = !!state?.views.some((view) => view.kind === 'terminal') && (state.terminalOpen ?? true)
        api.showChat(taskId)
        updateTaskUi(workspaceOf(taskId), (s) => ({ ...s, terminalOpen: false, restoreTerminal: terminalOpen }))
      },
      toggleRightPanel(taskId) {
        const state = effectiveUi[taskId]
        const terminalOpen = !!state?.views.some((view) => view.kind === 'terminal') && (state.terminalOpen ?? true)
        const tool = ui.sidebar === 'explorer' || ui.sidebar === 'search' || ui.sidebar === 'scm' ? ui.sidebar : null,
          workspace = api.workspaceVisible(taskId) || terminalOpen
        if (tool || workspace) {
          if (workspace) api.hideWorkspace(taskId)
          setUi((u) => ({ ...u, sidebar: 'projects', hiddenRight: { tool, workspace } }))
          return
        }
        // Nothing was recorded (each part was closed on its own): open the workspace.
        const hidden = ui.hiddenRight ?? { tool: null, workspace: true }
        const canRestore =
          viewsOf(taskId).some((view) => view.kind !== 'agent' && view.kind !== 'terminal') || state?.restoreTerminal
        // A layout toggle must visibly open something even before a file has been opened.
        setUi((u) => ({
          ...u,
          sidebar: hidden.tool ?? (hidden.workspace && canRestore ? u.sidebar : 'explorer'),
          hiddenRight: undefined,
        }))
        if (hidden.workspace) api.showWorkspace(taskId)
      },
      showWorkspace(taskId) {
        if (effectiveUi[taskId]?.restoreTerminal)
          updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, terminalOpen: true, restoreTerminal: false }))
        const state = effectiveUi[taskId]
        const editors = viewsOf(taskId).filter(
          (view) =>
            view.kind !== 'agent' &&
            (view.kind !== 'terminal' || (state?.terminalDock ?? preferences.defaultTerminalDock) === 'right'),
        )
        const target = editors.find((view) => view.id === effectiveUi[taskId]?.lastWorkspaceViewId) ?? editors.at(-1)
        if (!target) return
        const owner = workspaceOf(taskId)
        updateTaskUi(owner, (state) => focus(state, target, preferences.defaultTerminalDock))
        if (owner !== taskId) updateTaskUi(taskId, (state) => ({ ...state, activeViewId: target.id }))
      },
      activateView(taskId, viewId) {
        const view = viewsOf(taskId).find((v) => v.id === viewId)
        if (!view) return
        if (view.kind === 'agent') updateTaskUi(workspaceOf(taskId), (state) => ({ ...state, activeViewId: null }))
        const owner = view.kind === 'agent' ? taskId : workspaceOf(taskId)
        updateTaskUi(owner, (s) => focus(s, view, preferences.defaultTerminalDock))
        if (owner !== taskId && view.kind !== 'terminal') updateTaskUi(taskId, (s) => ({ ...s, activeViewId: viewId }))
      },
      setTerminalPanel: (taskId, settings) =>
        updateTaskUi(workspaceOf(taskId), (s) => {
          const next = { ...s, ...settings }
          const active = s.views.find((view) => view.id === s.activeViewId)
          const terminal = s.views.find((view) => view.id === s.activeTerminalId && view.kind === 'terminal')
          if (
            terminal &&
            (next.terminalDock ?? preferences.defaultTerminalDock) === 'right' &&
            next.terminalOpen !== false &&
            (settings.terminalDock === 'right' || settings.terminalOpen === true)
          )
            return focus(next, terminal, preferences.defaultTerminalDock)
          if (active?.kind === 'terminal' && (next.terminalDock === 'bottom' || next.terminalOpen === false))
            next.activeViewId = s.views.some((view) => view.id === s.terminalReturnViewId && view.kind !== 'terminal')
              ? s.terminalReturnViewId!
              : null
          return next
        }),
      splitTerminal: (taskId, direction) => {
        const id = crypto.randomUUID()
        updateTaskUi(workspaceOf(taskId), (s) => {
          const next = splitTerminal(s, direction, id)
          return focus(
            next,
            next.views.find((view) => view.id === id)!,
            preferences.defaultTerminalDock,
          )
        })
      },
      unsplitTerminal: (taskId, terminalId) => updateTaskUi(workspaceOf(taskId), (s) => unsplitTerminal(s, terminalId)),
      setDockWidth: (taskId, width) =>
        updateTaskUi(workspaceOf(taskId), (s) => ({ ...s, dockWidth: Math.round(width) })),
      resetLayoutSizes: () =>
        setTaskUi((m) =>
          Object.fromEntries(
            Object.entries(m).map(([id, state]) => {
              dirtyTasks.current.add(id)
              const { dockWidth: _dock, terminalHeight: _terminal, ...rest } = state
              return [id, rest]
            }),
          ),
        ),
      setDirty,
      binding: (taskId, repoId) => bindings[taskId]?.find((b) => b.repoId === repoId),
      task: (taskId) => tasks.find((t) => t.id === taskId),
      projectOf(taskId) {
        if (isWorktreeCtx(taskId))
          return projects.find(
            (p) => p.id === workspaces.find((w) => w.id === taskId.slice('worktree:'.length))?.projectId,
          )
        if (isProjectCtx(taskId)) return projects.find((p) => p.id === taskId.slice('project:'.length))
        const t = tasks.find((x) => x.id === taskId)
        return t && projects.find((p) => p.id === t.projectId)
      },
    }
    return api
  }, [
    projects,
    repos,
    tasks,
    workspaces,
    composingWorkspace,
    ui,
    taskUi,
    bindings,
    dirty,
    composing,
    refresh,
    refreshBindings,
    updateTaskUi,
    setDirty,
    unread,
    preferences.previewTabs,
    preferences.defaultTerminalDock,
    language,
  ])

  // Resolve delayed snapshot callbacks against the latest state, including when
  // a rapid second action completes the previous pending update first.
  const latestPanelApi = useRef(api)
  latestPanelApi.current = api
  const animatedApi = useMemo<WorkspaceApi>(() => {
    const change = (
      update: (current: WorkspaceApi) => void,
      scope: PanelMotionScope,
      entering: boolean | (() => boolean) = false,
      captureIncoming = false,
    ) => animatePanelChange(() => update(latestPanelApi.current), scope, entering, captureIncoming)
    const active = (taskId: string) => taskId === api.ui.activeTaskId
    const terminalShown = (taskId: string) =>
      !!api.taskUi[taskId]?.views.some((v) => v.kind === 'terminal') && (api.taskUi[taskId]?.terminalOpen ?? true)
    // The right pane is already on screen while a tool rail is open, so a file opening or closing in it is not a pane change.
    const toolOpen = () => ['explorer', 'search', 'scm'].includes(api.ui.sidebar)
    const editorShown = (taskId: string) =>
      toolOpen() ||
      !!api.taskUi[taskId]?.views.some(
        (v) => v.id === api.taskUi[taskId]?.activeViewId && v.kind !== 'agent' && v.kind !== 'terminal',
      )
    return {
      ...api,
      setSidebar: (sidebar) => {
        const tool = (tab: WorkspaceUiState['sidebar']) => tab === 'explorer' || tab === 'search' || tab === 'scm'
        if (sidebar !== api.ui.sidebar && (tool(sidebar) || tool(api.ui.sidebar)))
          change((current) => current.setSidebar(sidebar), 'tools', tool(sidebar))
        else api.setSidebar(sidebar)
      },
      openView: (taskId, view) => {
        const opening =
          view.kind === 'terminal' ? !terminalShown(taskId) : view.kind !== 'agent' && !editorShown(taskId)
        if (active(taskId) && opening)
          change((current) => current.openView(taskId, view), view.kind === 'terminal' ? 'terminal' : 'editor', true)
        else api.openView(taskId, view)
      },
      activateView: (taskId, viewId) => {
        const view = api.taskUi[taskId]?.views.find((v) => v.id === viewId)
        const opening =
          view?.kind === 'terminal' ? !terminalShown(taskId) : !!view && view.kind !== 'agent' && !editorShown(taskId)
        if (active(taskId) && opening)
          change(
            (current) => current.activateView(taskId, viewId),
            view?.kind === 'terminal' ? 'terminal' : 'editor',
            true,
          )
        else api.activateView(taskId, viewId)
      },
      hideWorkspace: (taskId) =>
        active(taskId) ? change((current) => current.hideWorkspace(taskId), 'workspace') : api.hideWorkspace(taskId),
      showWorkspace: (taskId) =>
        active(taskId)
          ? change((current) => current.showWorkspace(taskId), 'workspace', true)
          : api.showWorkspace(taskId),
      toggleRightPanel: (taskId) =>
        active(taskId)
          ? change(
              (current) => current.toggleRightPanel(taskId),
              'right',
              () => {
                const current = latestPanelApi.current
                const state = current.taskUi[taskId]
                const terminalOpen =
                  !!state?.views.some((view) => view.kind === 'terminal') && (state.terminalOpen ?? true)
                return (
                  !current.workspaceVisible(taskId) &&
                  !terminalOpen &&
                  !['explorer', 'scm', 'search'].includes(current.ui.sidebar)
                )
              },
            )
          : api.toggleRightPanel(taskId),
      setTerminalPanel: (taskId, settings) => {
        if (active(taskId) && ('terminalOpen' in settings || 'terminalDock' in settings))
          change(
            (current) => current.setTerminalPanel(taskId, settings),
            'terminal',
            settings.terminalOpen === true,
            'terminalDock' in settings,
          )
        else api.setTerminalPanel(taskId, settings)
      },
      closeView: (taskId, viewId) =>
        closeAfterTerminalCheck([viewId], () => {
          const scope = closingPanel(api.taskUi[taskId], [viewId])
          if (active(taskId) && scope && !(scope === 'editor' && toolOpen()) && !api.dirty[viewId])
            change((current) => current.closeView(taskId, viewId), scope)
          else api.closeView(taskId, viewId)
        }),
      closeViews: (taskId, viewIds) =>
        closeAfterTerminalCheck(viewIds, () => {
          const scope = closingPanel(api.taskUi[taskId], viewIds)
          if (active(taskId) && scope && !(scope === 'editor' && toolOpen()) && !viewIds.some((id) => api.dirty[id]))
            change((current) => current.closeViews(taskId, viewIds), scope)
          else api.closeViews(taskId, viewIds)
        }),
      showChat: (taskId) =>
        active(taskId) && editorShown(taskId)
          ? change((current) => current.showChat(taskId), 'editor')
          : api.showChat(taskId),
    }
  }, [api])

  const latestActionsApi = useRef(animatedApi)
  latestActionsApi.current = animatedApi
  const actions = useMemo<WorkspaceActions>(
    () => ({
      task: (taskId) => latestActionsApi.current.task(taskId),
      newTask: (projectId) => latestActionsApi.current.newTask(projectId),
      refresh: () => latestActionsApi.current.refresh(),
      openTask: (taskId) => latestActionsApi.current.openTask(taskId),
      openView: (taskId, view) => latestActionsApi.current.openView(taskId, view),
      consumeSourceNavigation: (taskId, viewId, requestId) =>
        latestActionsApi.current.consumeSourceNavigation(taskId, viewId, requestId),
    }),
    [],
  )

  return (
    <ActionsCtx.Provider value={actions}>
      <Ctx.Provider value={animatedApi}>{children(loaded)}</Ctx.Provider>
    </ActionsCtx.Provider>
  )
}
