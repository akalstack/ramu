import { expect, it } from 'vitest'
import { mayUse, type DevicePermissionsView } from '../src/devicePermissions'

const view = (permissions: Partial<DevicePermissionsView['permissions']>): DevicePermissionsView => ({
  permissions: { computer: null, browser: null, terminal: null, settings: null, agents: null, ...permissions },
  pending: [],
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
