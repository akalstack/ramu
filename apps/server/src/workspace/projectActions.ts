import { z } from 'zod'
import type { ProjectAction, ProjectActionSettings } from '@ramu/shared/types'
import { projectActionSchema, type ProjectConfigResult } from './projectConfig'
import type { Workspace } from './workspace'

const uniqueActions = z
  .array(projectActionSchema)
  .max(30)
  .refine((actions) => new Set(actions.map((action) => action.id)).size === actions.length, 'Action IDs must be unique')
const ids = z.array(z.string().min(1).max(64)).max(500)
const savedActions = z.object({
  version: z.literal(1),
  local: uniqueActions,
  hidden: ids,
  order: ids.optional(),
})
type SavedActions = z.infer<typeof savedActions>

/** Host-owned overrides and presentation preferences; repository commands always stay live. */
export class ProjectActions {
  constructor(
    private workspace: Workspace,
    private configuration: (projectId: string) => ProjectConfigResult,
  ) {}

  private read(projectId: string) {
    const { config, source } = this.configuration(projectId)
    const raw = this.workspace.getAppState<unknown>(`project-action-settings:${projectId}`, null)
    const parsed = savedActions.safeParse(
      raw ?? {
        version: 1,
        local: this.workspace.getAppState<unknown>(`project-actions:${projectId}`, []),
        hidden: [],
      },
    )
    if (!parsed.success)
      throw new Error('Saved project actions are invalid. Restore the host data before editing actions.')
    const state = parsed.data
    const overrides = new Map(state.local.map((action) => [action.id, action]))
    const repositoryIds = new Set((config.actions ?? []).map((action) => action.id))
    const actions: ProjectAction[] = [
      ...(config.actions ?? []).map((action) => overrides.get(action.id) ?? { ...action, source }),
      ...state.local.filter((action) => !repositoryIds.has(action.id)),
    ]
    if (state.order) {
      const positions = new Map(state.order.map((id, index) => [id, index]))
      actions.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity))
    }
    return { state, actions }
  }

  settings(projectId: string): ProjectActionSettings {
    const { state, actions } = this.read(projectId)
    const currentIds = new Set(actions.map((action) => action.id))
    return {
      actions,
      hiddenIds: state.hidden.filter((id) => currentIds.has(id)),
      customOrder: state.order !== undefined,
    }
  }

  list(projectId: string): ProjectAction[] {
    const { actions, hiddenIds } = this.settings(projectId)
    const hidden = new Set(hiddenIds)
    return actions.filter((action) => !hidden.has(action.id))
  }

  private write(projectId: string, state: SavedActions) {
    // One durable replacement also migrates legacy local actions without deleting their archive.
    this.workspace.setAppState(`project-action-settings:${projectId}`, savedActions.parse(state))
  }

  save(projectId: string, actions: ProjectAction[]): ProjectAction[] {
    const { state } = this.read(projectId)
    const supplied = new Set(actions.map((action) => action.id))
    if (supplied.size !== actions.length) throw new Error('Action IDs must be unique')
    const hidden = new Set(state.hidden)
    const local = uniqueActions.parse([
      ...actions.filter((action) => !action.source),
      // An older client only sees visible actions. Its save must not delete hidden work.
      ...state.local.filter((action) => hidden.has(action.id) && !supplied.has(action.id)),
    ])
    this.write(projectId, { ...state, local })
    return this.list(projectId)
  }

  reorder(projectId: string, orderedIds: string[]): ProjectActionSettings {
    const { state, actions } = this.read(projectId)
    const hidden = new Set(state.hidden)
    const visible = new Set(actions.filter((action) => !hidden.has(action.id)).map((action) => action.id))
    if (
      new Set(orderedIds).size !== orderedIds.length ||
      orderedIds.length !== visible.size ||
      orderedIds.some((id) => !visible.has(id))
    )
      throw new Error('Actions changed elsewhere. Refresh actions and review the new order.')
    this.write(projectId, {
      ...state,
      order: [...orderedIds, ...actions.filter((action) => hidden.has(action.id)).map((action) => action.id)],
    })
    return this.settings(projectId)
  }

  visibility(projectId: string, actionId: string, hidden: boolean): ProjectActionSettings {
    const { state, actions } = this.read(projectId)
    if (!actions.some((action) => action.id === actionId))
      throw new Error('This action is no longer available. Refresh actions and try again.')
    const currentIds = new Set(actions.map((action) => action.id))
    const next = new Set(state.hidden.filter((id) => currentIds.has(id)))
    if (hidden) next.add(actionId)
    else next.delete(actionId)
    this.write(projectId, { ...state, hidden: [...next] })
    return this.settings(projectId)
  }

  resetOrder(projectId: string): ProjectActionSettings {
    const { state } = this.read(projectId)
    const { order: _order, ...next } = state
    this.write(projectId, next)
    return this.settings(projectId)
  }
}
