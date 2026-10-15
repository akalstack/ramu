import { ramu } from './ipc'
import { workspaceCheckpoints } from './workspaceCheckpoint'

let visible = true
const changes = new Set<() => void>()
export const workspaceVisible = () => visible
export function onWorkspaceVisibility(changed: () => void) {
  changes.add(changed)
  return () => {
    changes.delete(changed)
  }
}

ramu.on('workspace:visibility', (state) => {
  visible = state.visible
  document.documentElement.toggleAttribute('data-workspace-hidden', !visible)
  for (const changed of changes) changed()
})
ramu.on('workspace:checkpoint', ({ requestId }) => {
  void (async () => {
    // In-progress forms and native shell sessions are retained, never discarded by the view cache.
    let safe = workspaceCheckpoints.size > 0 && !document.querySelector('[role="dialog"], [role="alertdialog"]')
    if (safe)
      safe = ![
        ...document.querySelectorAll<HTMLElement>(
          'input:not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"]',
        ),
      ].some((node) => {
        if (node.closest('.monaco-editor') || node.hasAttribute('data-persistent-draft')) return false
        return !!(
          node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement ? node.value : node.textContent
        )?.trim()
      })
    if (safe)
      for (const checkpoint of workspaceCheckpoints) {
        try {
          if (!(await checkpoint())) {
            safe = false
            break
          }
        } catch {
          safe = false
          break
        }
      }
    const accepted = await ramu.invoke('computers.checkpoint', requestId, safe).catch(() => false)
    if (!safe || !accepted) {
      try {
        localStorage.removeItem('ramu.workspace.resume')
      } catch {}
    }
  })()
})
