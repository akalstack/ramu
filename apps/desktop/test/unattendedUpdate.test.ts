import { expect, it } from 'vitest'
import type { AppRelease } from '@ramu/shared/updates'
import { UNATTENDED_IDLE_SECONDS, installsAtLaunch, mayInstallUnattended } from '../src/main/unattendedUpdate'

const quiet = {
  ready: true,
  autoUpdate: async () => true,
  idleSeconds: () => UNATTENDED_IDLE_SECONDS,
  serviceIdle: async () => true,
}

it('installs a ready update once Auto-update is on, nobody is using the computer and nothing runs', async () => {
  expect(await mayInstallUnattended(quiet)).toBe(true)
})

it('waits while anything says otherwise', async () => {
  expect(await mayInstallUnattended({ ...quiet, ready: false })).toBe(false)
  expect(await mayInstallUnattended({ ...quiet, autoUpdate: async () => false })).toBe(false)
  expect(await mayInstallUnattended({ ...quiet, idleSeconds: () => UNATTENDED_IDLE_SECONDS - 1 })).toBe(false)
  expect(await mayInstallUnattended({ ...quiet, serviceIdle: async () => false })).toBe(false)
  const unreadable = async (): Promise<boolean> => {
    throw new Error('service restarting')
  }
  expect(await mayInstallUnattended({ ...quiet, autoUpdate: unreadable })).toBe(false)
})

const staged = { phase: 'ready' as const, release: { version: '1.2.0' } as AppRelease }

it('installs a staged update at launch when Auto-update is on', () => {
  expect(installsAtLaunch(staged, true, '1.1.0')).toBe(true)
})

it('starts normally when Auto-update is off, nothing is staged, or the staged release is already installed', () => {
  expect(installsAtLaunch(staged, false, '1.1.0')).toBe(false)
  expect(installsAtLaunch({ ...staged, phase: 'available' }, true, '1.1.0')).toBe(false)
  expect(installsAtLaunch({ phase: 'ready', release: null }, true, '1.1.0')).toBe(false)
  expect(installsAtLaunch(staged, true, '1.2.0')).toBe(false)
})
