import { expect, it } from 'vitest'
import { controllerLabel } from '../src/chat/computerLabels'
import { runtimeHelp } from '../src/settings/computerStatus'

const target = { id: 'display:main', kind: 'display' as const, name: 'Main display' }

it('names who controls the computer', () => {
  expect(controllerLabel({ target, controller: { kind: 'human', deviceId: 'a' }, generation: 1, paused: false })).toBe('You are in control')
  expect(controllerLabel({ target, controller: { kind: 'agent', runId: 'r' }, generation: 1, paused: false })).toBe('Agent control')
  expect(controllerLabel({ target, controller: { kind: 'human', deviceId: 'a' }, generation: 1, paused: true })).toBe('Control paused')
  expect(controllerLabel({ target, controller: { kind: 'none' }, generation: 0, paused: false })).toBe('Ready')
})

it('explains why computer use is unavailable', () => {
  expect(runtimeHelp({ enabled: false, runtime: { available: false, reason: 'permission-denied', detail: 'Allow Screen Recording.' } })).toBe('Allow Screen Recording.')
  expect(runtimeHelp({ enabled: true, runtime: { available: true, computer: { id: 'local', name: 'Studio' } } })).toMatch(/Studio/)
})
