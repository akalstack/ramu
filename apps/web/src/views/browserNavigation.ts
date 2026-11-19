/** Explicit renderer actions only. Navigation intent is never restored from saved workspace state. */
const pending = new Map<string, { taskId: string; url: string }>()
const listeners = new Set<() => void>()
export function requestBrowserNavigation(viewId: string, taskId: string, url: string) {
  if (pending.size >= 100) pending.delete(pending.keys().next().value!)
  pending.set(viewId, { taskId, url })
  for (const listener of listeners) listener()
}
export function takeBrowserNavigation(viewId: string, taskId: string): string | undefined {
  const request = pending.get(viewId)
  if (!request || request.taskId !== taskId) return undefined
  pending.delete(viewId)
  return request.url
}
export function onBrowserNavigation(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
