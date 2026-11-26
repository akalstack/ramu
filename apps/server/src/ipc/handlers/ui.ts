import { z } from 'zod'
import { GLOBAL_PAGES, type TaskUiState, type WorkspaceUiState } from '@ramu/shared/types'
import { id, relPath } from '../schemas'
import type { RegisterHandlers } from '../types'

const viewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('agent'),
    id,
    sessionId: id,
    repoId: id.optional(),
    sourceSeq: z.number().int().positive().optional(),
    sourceRequestId: id.optional(),
    focusRequestId: id.optional(),
  }),
  z.object({
    kind: z.literal('file'),
    id,
    repoId: id,
    path: relPath,
    preview: z.boolean().optional(),
    selection: z
      .object({
        line: z.number().int().positive(),
        column: z.number().int().positive(),
        endColumn: z.number().int().positive(),
        requestId: id,
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('diff'),
    id,
    repoId: id,
    path: relPath,
    staged: z.union([z.boolean(), z.literal('all')]),
    stash: z.boolean().optional(),
    oid: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  }),
  z.object({
    kind: z.literal('git'),
    id,
    repoId: id,
    title: z.string().max(1000),
    oid: z
      .string()
      .regex(/^[a-f0-9]{40,64}$/)
      .optional(),
  }),
  z.object({
    kind: z.literal('review'),
    id,
    reviewId: id,
    taskId: id,
    fileId: id.optional(),
    threadId: id.optional(),
    requestId: id.optional(),
  }),
  z.object({
    kind: z.literal('browser'),
    id,
    url: z.string().max(4000).optional(),
    tabId: z.string().uuid().optional(),
    profileId: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,63}$/)
      .optional(),
  }),
  z.object({ kind: z.literal('terminal'), id, repoId: id.optional(), backgroundId: z.string().uuid().optional() }),
])
const taskUiSchema = z.object({
  views: z.array(viewSchema).max(200),
  activeViewId: id.nullable(),
  activeAgentViewId: id.nullable().optional(),
  dockWidth: z.number().int().min(280).max(2000).optional(),
  activeTerminalId: id.nullable().optional(),
  terminalReturnViewId: id.nullable().optional(),
  terminalOpen: z.boolean().optional(),
  terminalGroups: z
    .array(z.object({ id, terminalIds: z.array(id).min(1).max(200), layout: z.enum(['horizontal', 'vertical']) }))
    .max(200)
    .optional(),
  terminalTabPosition: z.enum(['top', 'right']).optional(),
  terminalHeight: z.number().int().min(120).max(2000).optional(),
  terminalDock: z.enum(['right', 'bottom']).optional(),
})
const workspaceUiSchema = z.object({
  openTaskIds: z.array(id).max(100),
  activeTaskId: id.nullable(),
  // Every page the window can open; a page missing here made saving the layout fail while it was open.
  sidebar: z.enum(['projects', 'explorer', 'search', 'scm', ...GLOBAL_PAGES]),
  collapsed: z.array(z.string().max(200)).max(500).optional(),
})

/** Which tabs, terminals and sidebar state the window restores. */
export const registerUiHandlers: RegisterHandlers = ({ workspace }) => ({
  'ui.get': {
    args: z.tuple([]),
    run: () => {
      const ws = workspaceUiSchema.parse(
        workspace.getAppState('workspace', { openTaskIds: [], activeTaskId: null, sidebar: 'projects' }),
      )
      const tasks: Record<string, TaskUiState> = {}
      for (const t of ws.openTaskIds) {
        try {
          tasks[t] = workspace.getTaskUi(t)
          if (!t.startsWith('project:') && !t.startsWith('worktree:')) {
            const task = workspace.getTask(t)
            const context = task.workspaceId ? `worktree:${task.workspaceId}` : `project:${task.projectId}`
            tasks[context] = workspace.getTaskUi(context)
          }
        } catch {
          /* task removed */
        }
      }
      // Restore checkout preferences even when that project was closed at shutdown.
      for (const project of workspace.listProjects()) {
        const context = `project:${project.id}`
        tasks[context] ??= workspace.getTaskUi(context)
      }
      for (const isolated of workspace.listWorkspaces()) {
        const context = `worktree:${isolated.id}`
        tasks[context] ??= workspace.getTaskUi(context)
      }
      return { workspace: ws, tasks }
    },
  },
  'ui.setWorkspace': {
    args: z.tuple([workspaceUiSchema]),
    run: (ui: WorkspaceUiState) => workspace.setAppState('workspace', ui),
  },
  'ui.setTask': {
    args: z.tuple([id, taskUiSchema]),
    run: (taskId: string, ui: TaskUiState) => workspace.setTaskUi(taskId, ui),
  },
})
