import { expect, it, vi } from 'vitest'
import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providerBinaries'
import { DEFAULT_APP_PREFERENCES, type AppPreferences } from '@ramu/shared/types'

it('defaults fallback to only at the limit and preserves saved thresholds', () => {
  let saved: Partial<AppPreferences> = {}
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-test', send: () => {}, native: async () => null }, {
    workspace: { getAppState: (key: string, fallback: unknown) => key === 'app-preferences' ? saved : fallback, setAppState: vi.fn() },
  } as unknown as Services)
  try {
    expect(DEFAULT_APP_PREFERENCES.fallback.switchAt).toBeNull()
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ fallback: { switchAt: null } })
    // A partial saved fallback must use the same default as a fresh install.
    saved = { fallback: { returnAfterReset: true, chains: {} } as AppPreferences['fallback'] }
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ fallback: { switchAt: null, returnAfterReset: true } })
    for (const switchAt of [80, 90, 95, null] as const) {
      saved = { fallback: { switchAt, returnAfterReset: false, chains: {} } }
      expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ fallback: { switchAt } })
    }
  } finally { dispatcher.close(); configureProviderBinaries({}) }
})
