import { expect, it } from 'vitest'
import { controllerLabel } from '../src/chat/computerLabels'
import { appControlHelp, keepAwakeHelp, runtimeHelp } from '../src/settings/computerStatus'

const runtime = { id: 'local', name: 'Mac' }
const target = { id: 'display:main', kind: 'display' as const, name: 'Main display' }
const base = { target, generation: 1, runtime }

it('names who controls the computer', () => {
  expect(controllerLabel({ ...base, controller: { kind: 'human', deviceId: 'a' }, paused: false })).toBe(
    'You are in control',
  )
  expect(controllerLabel({ ...base, controller: { kind: 'agent', runId: 'r' }, paused: false })).toBe('Agent control')
  expect(controllerLabel({ ...base, controller: { kind: 'human', deviceId: 'a' }, paused: true })).toBe(
    'Control paused',
  )
  expect(controllerLabel({ ...base, controller: { kind: 'none' }, paused: false })).toBe('Ready')
})

it('explains why computer use is unavailable', () => {
  expect(
    runtimeHelp({
      enabled: false,
      runtime: { available: false, reason: 'permission-denied', detail: 'Allow Screen Recording.' },
      apps: null,
      keepAwake: true,
      globalPointer: false,
    }),
  ).toBe('Allow Screen Recording.')
  expect(
    runtimeHelp({
      enabled: true,
      runtime: { available: true, computer: { id: 'local', name: 'Studio' } },
      apps: null,
      keepAwake: true,
      globalPointer: false,
    }),
  ).toMatch(/Studio/)
})

const ready = { available: true as const, computer: { id: 'local', name: 'Mac' } }
const status = (patch = {}) => ({
  enabled: true,
  runtime: ready,
  apps: ready,
  keepAwake: true,
  globalPointer: false,
  ...patch,
})

it('says whether the computer is being held awake', () => {
  expect(keepAwakeHelp(status())).toMatch(/will not sleep/)
  expect(keepAwakeHelp(status({ keepAwake: false }))).toMatch(/may sleep.*Keep awake in Settings/)
})

it('shows the Open Computer Use release only when the host reports it', () => {
  expect(appControlHelp(status({ appVersion: '1.1.2' }))).toMatch(/Open Computer Use 1\.1\.2/)
  expect(appControlHelp(status())).not.toMatch(/Open Computer Use/)
  expect(appControlHelp(status({ apps: { available: false, reason: 'not-installed', detail: 'Install it.' } }))).toBe(
    'Install it.',
  )
  expect(appControlHelp(status({ apps: null }))).toMatch(/not available/)
})
