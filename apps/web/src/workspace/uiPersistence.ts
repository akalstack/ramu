// Saving a store's open tabs and view layout to its host (`ui.setWorkspace`, `ui.setTask`), debounced. Framework-free
// so the rules can be tested without React.
import type { RamuBridge } from '@ramu/shared/api'
import type { TaskUiState, WorkspaceUiState } from '@ramu/shared/types'
import { persistentTaskUi } from '@ramu/shared/workspace/sourceNavigation'
import { EMPTY_TASK_UI } from './workspaceModel'

type Schedule = (run: () => void, ms: number) => () => void
const timer: Schedule = (run, ms) => {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

export interface UiPersistence {
  /** A task's (or workspace context's) view state changed and should be saved. */
  touch(id: string): void
  /** The latest state; `workspace` marks the open-tab list itself as changed. Saves after the debounce. */
  update(state: { ui: WorkspaceUiState; taskUi: Record<string, TaskUiState> }, workspace: boolean): void
  /** The store finished restoring; nothing is saved before that. */
  setLoaded(loaded: boolean): void
  /**
   * Only the store on screen saves. A sidebar-only store must not overwrite the host's saved
   * selection before it is opened, so its changes wait; going off screen saves what changed while it was on screen.
   */
  setActive(active: boolean): void
  pending(): { workspace: boolean; tasks: string[] }
  dispose(): void
}

export function createUiPersistence(
  invoke: RamuBridge['invoke'],
  { delay = 250, schedule = timer }: { delay?: number; schedule?: Schedule } = {},
): UiPersistence {
  let loaded = false
  let active = false
  let state: { ui: WorkspaceUiState; taskUi: Record<string, TaskUiState> } | null = null
  let workspaceDirty = false
  const tasks = new Set<string>()
  let cancel: (() => void) | null = null
  const stop = () => {
    cancel?.()
    cancel = null
  }
  const flush = () => {
    stop()
    if (!loaded || !active || !state) return
    const current = state
    if (workspaceDirty) {
      workspaceDirty = false
      void invoke('ui.setWorkspace', current.ui).catch(() => {})
    }
    for (const id of [...tasks]) {
      tasks.delete(id)
      void invoke('ui.setTask', id, persistentTaskUi(current.taskUi[id] ?? EMPTY_TASK_UI)).catch(() => {
        tasks.add(id)
      })
    }
  }
  const arm = () => {
    if (!loaded || !active || (!workspaceDirty && !tasks.size)) return
    stop()
    cancel = schedule(flush, delay)
  }
  return {
    touch(id) {
      tasks.add(id)
    },
    update(next, workspace) {
      state = next
      if (workspace) workspaceDirty = true
      arm()
    },
    setLoaded(next) {
      loaded = next
      arm()
    },
    setActive(next) {
      if (active === next) return
      if (!next) flush()
      active = next
      arm()
    },
    pending: () => ({ workspace: workspaceDirty, tasks: [...tasks] }),
    dispose: stop,
  }
}
