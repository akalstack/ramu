import { Notification, type BrowserWindow } from 'electron'
import { t } from './localization'

type PairingRequest = { id: string; name: string; code: string; expiresAt: number }

/**
 * Raises a nearby device's pairing request when this host's window is not in front: a system notification that opens
 * the window, where the request waits in its own dialog. An app the service opened only for this stays hidden until
 * clicked, and quits once nothing is left to answer.
 */
export function createPairingNotifier(options: {
  window: BrowserWindow
  /** The service opened the app just to show a request; nobody has asked for the window yet. */
  launchedForRequest: boolean
  quit: () => void
}) {
  const shown = new Set<string>()
  const live = new Map<string, Notification>()
  let revealed = !options.launchedForRequest
  let lapse: ReturnType<typeof setTimeout> | undefined
  const reveal = () => {
    const win = options.window
    if (win.isDestroyed()) return
    revealed = true
    clearTimeout(lapse)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
  const inFront = () => {
    const win = options.window
    return !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized()
  }
  return {
    /** The person opened the app themselves (Dock, menu); it is theirs now and stays open. */
    reveal,
    /** A device on this host's Ramu account paired on its own; the window shows the same with Remove when in front. */
    joined(device: { name: string; role: string; email: string }) {
      if (inFront() || !Notification.isSupported()) return
      const notification = new Notification({
        title: t('{0} connected', { 0: device.name || t('A device') }),
        body: t(
          device.role === 'owner'
            ? 'Signed in to your Ramu account {0}, so it paired with full access.'
            : 'Signed in to your Ramu account {0}, so it paired with view-only access.',
          { 0: device.email },
        ),
        silent: false,
      })
      notification.on('click', reveal)
      notification.show()
    },
    receive(requests: PairingRequest[]) {
      for (const [id, notification] of live)
        if (!requests.some((request) => request.id === id)) {
          notification.close()
          live.delete(id)
        }
      for (const request of requests) {
        if (shown.has(request.id)) continue
        shown.add(request.id)
        if (inFront() || !Notification.isSupported()) continue
        const notification = new Notification({
          title: t('{0} wants to pair', { 0: request.name || t('A device') }),
          body: t('Code {0}. Open Ramu to allow or deny it.', { 0: request.code }),
          silent: false,
        })
        notification.on('click', () => {
          live.delete(request.id)
          reveal()
        })
        notification.on('close', () => live.delete(request.id))
        live.set(request.id, notification)
        notification.show()
      }
      if (revealed) return
      clearTimeout(lapse)
      if (!requests.length) return options.quit()
      // Nothing tells a hidden app that the last request lapsed; leave when it would have.
      const last = Math.max(...requests.map((request) => request.expiresAt))
      lapse = setTimeout(() => !revealed && options.quit(), Math.max(0, last - Date.now()) + 1000)
    },
  }
}
