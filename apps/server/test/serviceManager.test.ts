import { expect, it } from 'vitest'
import { managedByServiceManager, RESTART_EXIT_CODE } from '../src/serviceManager'

it('a service its system manager starts again can be restarted from another device; any other cannot', () => {
  // Ramu's desktop LaunchAgent and `ramu up`'s, both named by their labels.
  expect(managedByServiceManager({ XPC_SERVICE_NAME: 'app.ramu.background.0123456789ab' })).toBe(true)
  expect(managedByServiceManager({ XPC_SERVICE_NAME: 'app.ramu.server' })).toBe(true)
  // A systemd user unit.
  expect(managedByServiceManager({ INVOCATION_ID: 'f3c1' })).toBe(true)
  // Started by the desktop app itself (an app's own XPC name), or from a terminal: nothing would start it again.
  expect(managedByServiceManager({ XPC_SERVICE_NAME: 'application.app.ramu.desktop.1234.5678' })).toBe(false)
  expect(managedByServiceManager({})).toBe(false)
  // A failure exit, which launchd's KeepAlive and systemd's Restart=on-failure both start again.
  expect(RESTART_EXIT_CODE).not.toBe(0)
})
