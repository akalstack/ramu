import type { TaskUiState } from './types'

/** Tab changes stay instant; animate only when removing a panel's last tab. */
export function closingPanel(
  state: TaskUiState | undefined,
  viewIds: string[],
): 'editor' | 'terminal' | 'workspace' | null {
  if (!state) return null
  const closing = new Set(viewIds)
  const editors = state.views.filter((view) => view.kind !== 'agent' && view.kind !== 'terminal')
  const terminals = state.views.filter((view) => view.kind === 'terminal')
  const editorCloses =
    editors.some((view) => view.id === state.activeViewId) && editors.every((view) => closing.has(view.id))
  const terminalCloses =
    terminals.length > 0 && (state.terminalOpen ?? true) && terminals.every((view) => closing.has(view.id))
  return editorCloses && terminalCloses ? 'workspace' : editorCloses ? 'editor' : terminalCloses ? 'terminal' : null
}
