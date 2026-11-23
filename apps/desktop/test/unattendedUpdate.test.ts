import { expect, it } from 'vitest'
import { UNATTENDED_IDLE_SECONDS, mayInstallUnattended } from '../src/main/unattendedUpdate'

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
