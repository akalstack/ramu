// One short message over the current screen, with an optional button (Undo). No React Native in here.

export interface Toast {
  /** A copy key in `i18n.ts`, or already-written text such as an error from the host. */
  message: string
  /** Something went wrong: shown with a warning mark, under the header. */
  error?: boolean
  /** `label` is a copy key too. */
  action?: { label: string; run: () => void }
  /** Bumps on every `showToast`, so the same message shown twice restarts the timer. */
  id: number
}

let current: Toast | null = null
let counter = 0
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((listener) => listener())

export const TOAST_MS = 6000

export function showToast(message: string, action?: Toast['action']) {
  current = { message, action, id: ++counter }
  emit()
}
/** An error, shown as a toast that clears itself. */
export function showError(message: string) {
  current = { message, error: true, id: ++counter }
  emit()
}
export function dismissToast(id?: number) {
  if (current && (id === undefined || current.id === id)) {
    current = null
    emit()
  }
}
export const currentToast = () => current
export function subscribeToast(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
