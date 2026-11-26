// One short message over the current screen, with an optional button (Undo). No React Native in here.

export interface Toast {
  /** A copy key in `i18n.ts`, or already-written text such as an error from the host. */
  message: string
  /** Something went wrong: shown with an error mark, and longer, as the desktop does. */
  error?: boolean
  /** It worked: shown with a check, as the desktop marks a success. */
  success?: boolean
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
/** The same error is not shown again within this long. */
const REPEAT_MS = 5 * 60_000
let lastError: { message: string; at: number } | null = null
/** An error stays longer, as on the desktop: it is read, not glanced at. */
export const ERROR_TOAST_MS = 10_000

export function showToast(message: string, action?: Toast['action'], options: { success?: boolean } = {}) {
  current = { message, action, ...(options.success ? { success: true } : {}), id: ++counter }
  emit()
}
/** An error, shown as a toast that clears itself. */
export function showError(message: string) {
  // Callers pass a rejected call's value; an Error object rendered as text would crash the screen.
  const text: unknown = message
  message = text instanceof Error ? text.message : String(text)
  // Something that keeps failing in the background (a list read again every few seconds) says so once, not as a
  // popup that returns each time it is dismissed.
  const now = Date.now()
  if (lastError?.message === message && now - lastError.at < REPEAT_MS) return
  lastError = { message, at: now }
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
