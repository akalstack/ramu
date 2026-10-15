import { expect, it } from 'vitest'
import type { SettingsSnapshot } from '@ramu/shared/settingsCompatibility'
import { readSettingsSnapshot, SettingsUpdateRequired } from '../src/settings/settingsAvailability'

it.each([
  'Unknown method settings.app.snapshot',
  "Error invoking remote method 'ramu:invoke': Error: Unknown method settings.app.snapshot",
])('recognizes an older service: %s', async (message) => {
  await expect(
    readSettingsSnapshot(async () => {
      throw new Error(message)
    }),
  ).rejects.toBeInstanceOf(SettingsUpdateRequired)
})

it('preserves connection and unrelated method errors', async () => {
  for (const message of ['ECONNREFUSED', 'Unknown method providers.catalog']) {
    const error = new Error(message)
    await expect(
      readSettingsSnapshot(async () => {
        throw error
      }),
    ).rejects.toBe(error)
  }
})

it('requires an update for incompatible snapshots', async () => {
  for (const value of [null, { protocol: 2, preferences: {} }, { protocol: 1 }]) {
    await expect(readSettingsSnapshot(async () => value as SettingsSnapshot)).rejects.toBeInstanceOf(
      SettingsUpdateRequired,
    )
  }
})

it('returns supported settings without altering their capabilities', async () => {
  const snapshot = { protocol: 1, preferences: {}, settings: [] } as unknown as SettingsSnapshot
  expect(await readSettingsSnapshot(async () => snapshot)).toBe(snapshot)
})
