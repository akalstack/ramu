import { allWorkspaceCheckpoints } from './workspaceCheckpoint'

let visible = true
const changes = new Set<() => void>()
export const workspaceVisible = () => visible
export function onWorkspaceVisibility(changed: () => void) {
  changes.add(changed)
  return () => {
    changes.delete(changed)
  }
}

document.addEventListener('visibilitychange', () => {
  visible = document.visibilityState !== 'hidden'
  for (const changed of changes) changed()
})
// Closing the only shell saves each host's local resume state and any pending drafts.
window.addEventListener('pagehide', () => {
  for (const checkpoint of allWorkspaceCheckpoints()) void checkpoint().catch(() => {})
})
