import { expect, it } from 'vitest'
import { createDispatcher, type Services } from '../src/ipc'
import { configureProviderBinaries } from '../src/providers/providerBinaries'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'

it('persists reusable commit actions and the primary branch choice', () => {
  let saved: unknown = {}
  const dispatcher = createDispatcher(
    { userData: '/tmp/ramu-commit-preferences', send: () => {}, native: async () => null },
    {
      workspace: {
        getAppState: (key: string, fallback: unknown) => (key === 'app-preferences' ? saved : fallback),
        setAppState: (_key: string, value: unknown) => {
          saved = value
        },
      },
      agents: { invalidateCatalog: () => {}, goalsSettingsChanged: () => {} },
    } as unknown as Services,
  )
  try {
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({
      defaultCommitAction: 'commit',
      defaultCommitBranch: 'new-branch',
      autoWatchPullRequests: false,
    })
    for (const defaultCommitAction of ['commit', 'push', 'sync'] as const) {
      for (const defaultCommitBranch of ['current', 'new-branch'] as const) {
        dispatcher.invoke('settings.app.set', [
          { ...DEFAULT_APP_PREFERENCES, defaultCommitAction, defaultCommitBranch },
        ])
        expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ defaultCommitAction, defaultCommitBranch })
      }
    }
    for (const defaultCommitAction of ['amend', 'new-branch']) {
      expect(() =>
        dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, defaultCommitAction }]),
      ).toThrow()
    }
    for (const autoWatchPullRequests of [true, false]) {
      dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, autoWatchPullRequests }])
      expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ autoWatchPullRequests })
    }
  } finally {
    dispatcher.close()
    configureProviderBinaries({})
  }
})
