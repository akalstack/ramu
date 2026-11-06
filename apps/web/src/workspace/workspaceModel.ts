// Pure workspace rules shared by every host's store: contexts, view identity and order, and how a chat's own views
// combine with its workspace's shared ones. No React and no bridge, so the store's logic can be tested.
import { AUTO_PROJECT, NO_PROJECT } from '@ramu/shared/types'
import type { RepositoryBinding, Task, TaskUiState, ViewDescriptor, WorkspaceUiState } from '@ramu/shared/types'

export type ViewInput = ViewDescriptor extends infer V ? (V extends ViewDescriptor ? Omit<V, 'id'> : never) : never

/** Previewable views can reuse a tab when opened for browsing. */
export function isPreviewable(
  v: ViewInput | ViewDescriptor,
): v is Extract<ViewInput | ViewDescriptor, { kind: 'file' | 'diff' | 'git' }> {
  return v.kind === 'file' || v.kind === 'diff' || v.kind === 'git'
}

export function viewKey(v: ViewInput | ViewDescriptor): string {
  switch (v.kind) {
    case 'file':
      return `file:${v.repoId}:${v.path}`
    case 'diff':
      return `diff:${v.repoId}:${v.path}:${v.oid ?? v.staged}${v.stash ? ':stash' : ''}`
    case 'git':
      return `git:${v.repoId}:${v.oid ?? 'upstream'}`
    case 'review':
      return `review:${v.taskId}`
    case 'pull-request':
      return `pull-request:${v.repoId}:${v.url}`
    case 'agent':
      return `agent:${v.sessionId}`
    case 'browser':
      // Several tabs are allowed, like terminals.
      return `browser:${crypto.randomUUID()}`
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
export function focus(s: TaskUiState, v: ViewDescriptor, defaultDock: 'right' | 'bottom'): TaskUiState {
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
export const isProjectCtx = (ctx: string) => ctx.startsWith('project:')
export const isWorkspaceCtx = (ctx: string) => isProjectCtx(ctx) || isWorktreeCtx(ctx)

/** Selecting workspace content leaves a full-page destination while preserving workspace tools and open tabs. */
export function activateWorkspaceContext(ui: WorkspaceUiState, context: string): WorkspaceUiState {
  return {
    ...ui,
    activeTaskId: context,
    sidebar: ui.sidebar === 'inbox' || ui.sidebar === 'schedules' ? 'projects' : ui.sidebar,
  }
}

/** No project and Auto have no project pane to open, so their drafts stay on Home. */
export function composesOnHome(destination: string): boolean {
  return destination === NO_PROJECT || destination === AUTO_PROJECT
}

export const EMPTY_TASK_UI: TaskUiState = { views: [], activeViewId: null }

/** The context whose files and terminals a chat shares: its worktree, its project, or itself when it has no project. */
export function workspaceOfTask(task: Pick<Task, 'id' | 'projectId' | 'workspaceId'>): string {
  return task.projectId === NO_PROJECT
    ? task.id
    : task.workspaceId
      ? worktreeCtx(task.workspaceId)
      : projectCtx(task.projectId)
}

/** Reuse known checkout bindings while another thread's own binding read is still pending. */
export function effectiveBindings(
  tasks: readonly Task[],
  bindings: Record<string, RepositoryBinding[]>,
): Record<string, RepositoryBinding[]> {
  const effective = { ...bindings }
  for (const task of tasks) {
    const shared = bindings[workspaceOfTask(task)]
    if (!effective[task.id] && shared) effective[task.id] = shared
  }
  return effective
}

/** Each chat's own conversations plus its workspace's editors and terminals, as the panes show them. */
export function effectiveTaskUi(
  tasks: readonly Task[],
  taskUi: Record<string, TaskUiState>,
  workspaceOf: (ctx: string) => string,
): Record<string, TaskUiState> {
  const effective = { ...taskUi }
  for (const task of tasks) {
    const own = taskUi[task.id] ?? EMPTY_TASK_UI
    const shared = taskUi[workspaceOf(task.id)] ?? EMPTY_TASK_UI
    effective[task.id] = {
      ...shared,
      ...own,
      activeViewId:
        shared.activeViewId ?? own.activeAgentViewId ?? own.views.find((view) => view.kind === 'agent')?.id ?? null,
      dockWidth: shared.dockWidth,
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
  return effective
}
