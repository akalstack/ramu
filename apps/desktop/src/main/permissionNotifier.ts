import { Notification, type BrowserWindow } from 'electron'
import { PERMISSION_LABEL, type DevicePermission } from '@ramu/shared/devicePermissions'
import { t } from './localization'

type PermissionRequest = { id: string; deviceName: string; permission: DevicePermission }

/**
 * A paired device asking this host for a permission, raised where the person is: when the window is not in front, a
 * system notification that brings it forward, where the request waits in its own dialog.
 */
export function createPermissionNotifier(options: { window: BrowserWindow; reveal: () => void }) {
  const shown = new Set<string>()
  const live = new Map<string, Notification>()
  const inFront = () => {
    const win = options.window
    return !win.isDestroyed() && win.isVisible() && win.isFocused() && !win.isMinimized()
  }
  return {
    receive(requests: PermissionRequest[]) {
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
          title: t('{0} asks for {1}', { 0: request.deviceName, 1: t(PERMISSION_LABEL[request.permission]) }),
          body: t('Open Ramu to allow or deny it.'),
          silent: false,
        })
        notification.on('click', () => {
          live.delete(request.id)
          options.reveal()
        })
        notification.on('close', () => live.delete(request.id))
        live.set(request.id, notification)
        notification.show()
      }
    },
  }
}
