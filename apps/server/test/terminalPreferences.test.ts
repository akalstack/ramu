import { expect, it } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providers/providerBinaries'

it('loads older preferences and persists terminal docking separately from tab layout', () => {
  let saved: unknown = { terminalTabPosition: 'right' }
  const dispatcher = createDispatcher(
    { userData: '/tmp/ramu-terminal-preferences-test', send: () => {}, native: async () => null },
    {
      workspace: {
        getAppState: (key: string, fallback: unknown) => (key === 'app-preferences' ? saved : fallback),
        setAppState: (key: string, value: unknown) => {
          if (key !== 'app-preferences') return
          saved = value
        },
      },
      recaps: { settingsChanged: () => {} },
      providers: { settingsChanged: () => {} },
      agents: { invalidateCatalog: () => {}, goalsSettingsChanged: () => {} },
    } as unknown as Services,
  )
  try {
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({
      defaultTerminalDock: 'bottom',
      terminalTabPosition: 'right',
    })
    for (const dock of ['right', 'bottom'] as const) {
      dispatcher.invoke('settings.app.set', [
        { ...DEFAULT_APP_PREFERENCES, defaultTerminalDock: dock, terminalTabPosition: 'right' },
      ])
      expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({
        defaultTerminalDock: dock,
        terminalTabPosition: 'right',
      })
    }
    expect(() =>
      dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, defaultTerminalDock: 'top' }]),
    ).toThrow()
    dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, defaultTerminalDock: undefined }])
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ defaultTerminalDock: 'bottom' })
  } finally {
    dispatcher.close()
    configureProviderBinaries({})
  }
})
