import { expect, it } from 'vitest'
import { controllerLabel } from '../src/chat/computerLabels'
import { runtimeHelp } from '../src/settings/computerStatus'

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
    runtimeHelp({ enabled: true, runtime: { available: true, computer: { id: 'local', name: 'Studio' } }, apps: null, keepAwake: true, globalPointer: false }),
  ).toMatch(/Studio/)
})
