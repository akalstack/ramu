import { expect, it } from 'vitest'
import { registerSettingsTransferHandlers } from '../src/ipc/handlers/settingsTransfer'

it('finishes setup once a restore is applied, so leaving before that brings setup back', async () => {
  const state = new Map<string, unknown>()
  const methods = registerSettingsTransferHandlers({
    workspace: {
      getAppState: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
      setAppState: (key: string, value: unknown) => void state.set(key, value),
    },
    loadPreferences: () => ({}),
    savePreferences: () => {},
    host: { send: () => {} },
  } as never)
  const file = { format: 'ramu-settings', version: 2, exportedAt: 0, host: 'Studio', groups: [], preferences: {} }
  expect(state.get('onboarding-completed')).toBeUndefined()
  await (methods['settingsTransfer.apply']!.run as (...args: unknown[]) => Promise<unknown>)(file, [], 0)
  expect(state.get('onboarding-completed')).toBe(true)
})
