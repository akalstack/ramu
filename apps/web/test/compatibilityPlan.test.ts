import { expect, it } from 'vitest'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import { compatibilityPlan } from '../src/settings/compatibilityPlan'

const status = (patch: Partial<ProviderStatus>, compat: Partial<NonNullable<ProviderStatus['compatibility']>> = {}) =>
  ({
    provider: 'codex',
    installed: true,
    updateAvailable: false,
    compatibility: {
      status: 'incompatible',
      reason: 'incompatible-range',
      runtime: 'app-server',
      observedVersion: '0.1.0',
      policyRevision: 1,
      ...compat,
    },
    ...patch,
  }) as ProviderStatus
const open = { customBinary: false, canUpdate: true }

it('stays quiet for every runtime that still works and for old hosts', () => {
  expect(compatibilityPlan(status({}, { status: 'supported' }), open).actions).toEqual([])
  expect(compatibilityPlan(status({ updateAvailable: true }, { status: 'limited' }), open).actions).toEqual([])
  expect(compatibilityPlan(status({}, { status: 'unverified' }), open).actions).toEqual([])
  expect(compatibilityPlan({ ...status({}), compatibility: undefined }, open).actions).toEqual([])
  expect(compatibilityPlan(undefined, open).actions).toEqual([])
})

it('offers Update only to a target the same policy accepts', () => {
  expect(compatibilityPlan(status({ updateAvailable: true }), open).actions).toEqual([
    'update',
    'change-path',
    'check-again',
  ])
  const blocked = compatibilityPlan(
    status({
      updateAvailable: true,
      updateCompatibility: {
        status: 'incompatible',
        reason: 'incompatible-range',
        runtime: 'app-server',
        observedVersion: '0.2.0',
        policyRevision: 1,
      },
    }),
    open,
  )
  expect(blocked.actions).toEqual(['change-path', 'check-again'])
  expect(blocked.manualInstall).toBe(true)
})

it('never replaces a custom executable and sends bundled SDK problems to Update Ramu', () => {
  expect(
    compatibilityPlan(status({ updateAvailable: true }), { customBinary: true, canUpdate: false }).actions,
  ).toEqual(['change-path', 'check-again'])
  expect(compatibilityPlan(status({}, { runtime: 'sdk' }), open).actions).toEqual(['update-ramu', 'check-again'])
})
