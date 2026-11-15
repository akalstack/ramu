import { expect, it } from 'vitest'
import { grantFor, mayUse, permissionState, type DevicePermissionsView } from '../src/devicePermissions'

const view = (permissions: Partial<DevicePermissionsView['permissions']>): DevicePermissionsView => ({
  permissions: { computer: null, browser: null, terminal: null, settings: null, agents: null, ...permissions },
  pending: [],
  blocked: [],
})

it('offers a control only while its grant is active, and never hides one on a host that cannot say', () => {
  expect(mayUse(null, 'browser', 1000)).toBe(true)
  expect(mayUse(undefined, 'browser', 1000)).toBe(true)
  expect(mayUse(view({}), 'browser', 1000)).toBe(false)
  expect(mayUse(view({ browser: { until: null } }), 'browser', 1000)).toBe(true)
  expect(mayUse(view({ browser: { until: null, session: true } }), 'browser', 1000)).toBe(true)
  expect(mayUse(view({ browser: { until: 2000 } }), 'browser', 1000)).toBe(true)
  expect(mayUse(view({ browser: { until: 500 } }), 'browser', 1000)).toBe(false)
  expect(mayUse(view({ browser: { until: null } }), 'terminal', 1000)).toBe(false)
})

it('reads a grant as a lasting state, with an answered request shown as temporary', () => {
  expect(permissionState({ until: null }, false, 1000)).toBe('allowed')
  expect(permissionState(grantFor('hour', 1000), false, 1000)).toBe('temporary')
  expect(permissionState(grantFor('once', 1000), false, 1000)).toBe('temporary')
  expect(permissionState({ until: 500 }, false, 1000)).toBe('ask')
  expect(permissionState(null, false, 1000)).toBe('ask')
  expect(permissionState(null, true, 1000)).toBe('blocked')
})
