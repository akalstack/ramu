import type { Workspace } from '../workspace/workspace'

const AUTO_FLAG = 'migration:learning-auto-default'
const REVIEW_FLAG = 'migration:learning-review-default'

/**
 * Review first is the default for a new data directory, and Automatic stays an opt-in.
 *
 * An earlier release made Automatic the default and moved saved `review` values to it. That left no way to tell a data
 * directory made then from a new one except the flag that migration set. Such a directory keeps the behaviour it ran with:
 * Automatic is written down, once, only where the user never chose a mode. A saved choice is never touched, and a new
 * directory (no earlier flag) just follows the new default.
 */
export function migrateLearningDefault(workspace: Pick<Workspace, 'getAppState' | 'setAppState'>): void {
  if (workspace.getAppState(REVIEW_FLAG, false)) return
  if (workspace.getAppState(AUTO_FLAG, false)) {
    const saved = workspace.getAppState<{ intelligence?: { learning?: string } } | null>('app-preferences', null)
    if (saved?.intelligence?.learning === undefined)
      workspace.setAppState('app-preferences', { ...saved, intelligence: { ...saved?.intelligence, learning: 'auto' } })
  }
  workspace.setAppState(AUTO_FLAG, true)
  workspace.setAppState(REVIEW_FLAG, true)
}
