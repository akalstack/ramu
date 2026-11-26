import { describe, expect, it } from 'vitest'
import {
  customDefaultPermissions,
  deviceLimited,
  grantFor,
  mayUse,
  permissionState,
  type DevicePermissionsView,
} from '../src/devicePermissions'

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

describe('deviceLimited', () => {
  const now = 1_000_000
  const always = { until: null }
  const full = { computer: always, browser: always, terminal: always, settings: always }

  it('is not limited with everything a new device gets, with or without Agents', () => {
    expect(deviceLimited({ role: 'owner', permissions: full }, now)).toBe(false)
    expect(deviceLimited({ role: 'owner', permissions: { ...full, agents: always } }, now)).toBe(false)
  })

  it('is limited when one of them is missing, temporary or ended', () => {
    const { terminal: _terminal, ...withoutTerminal } = full
    expect(deviceLimited({ role: 'owner', permissions: withoutTerminal }, now)).toBe(true)
    expect(deviceLimited({ role: 'owner', permissions: { ...full, browser: { until: now + 60_000 } } }, now)).toBe(true)
    expect(deviceLimited({ role: 'owner', permissions: { ...full, browser: { until: now - 1 } } }, now)).toBe(true)
    expect(
      deviceLimited({ role: 'owner', permissions: { ...full, settings: { until: null, session: true } } }, now),
    ).toBe(true)
  })

  it('measures against what this host gives a new device, when it saved its own set', () => {
    const { terminal: _terminal, ...withoutTerminal } = full
    // A host that gives new devices no terminals: one without them is as new, not limited.
    expect(
      deviceLimited({ role: 'owner', permissions: withoutTerminal }, now, ['computer', 'browser', 'settings']),
    ).toBe(false)
    expect(deviceLimited({ role: 'owner', permissions: { computer: always } }, now, ['computer', 'browser'])).toBe(true)
    // Agents among the defaults is still never a limit.
    expect(deviceLimited({ role: 'owner', permissions: full }, now, [...Object.keys(full), 'agents'] as never)).toBe(
      false,
    )
  })

  it('never marks a view-only device or a linked host', () => {
    expect(deviceLimited({ role: 'viewer' }, now)).toBe(false)
    expect(deviceLimited({ role: 'owner', kind: 'host', permissions: {} }, now)).toBe(false)
  })
})

describe('customDefaultPermissions', () => {
  it('tells a host that saved its own set for new devices', () => {
    expect(customDefaultPermissions(['computer', 'browser', 'terminal', 'settings'])).toBe(false)
    expect(customDefaultPermissions(['settings', 'terminal', 'browser', 'computer'])).toBe(false)
    expect(customDefaultPermissions(['computer', 'browser'])).toBe(true)
    expect(customDefaultPermissions(['computer', 'browser', 'terminal', 'settings', 'agents'])).toBe(true)
  })
})
