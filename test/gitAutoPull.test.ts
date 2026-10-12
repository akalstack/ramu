import { expect, it, vi } from 'vitest'
import * as git from '../src/main/git'
import { createDispatcher, type Services } from '../src/main/ipc'
import { configureProviderBinaries } from '../src/main/providerBinaries'
import { DEFAULT_APP_PREFERENCES } from '../src/shared/types'

it('defaults automatic pull on, persists opt-out, and skips active agent writers', async () => {
  let saved: unknown = {}
  const activeWriter = vi.fn(() => false)
  const pull = vi.spyOn(git, 'autoPull').mockResolvedValue(true)
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-auto-pull-test', send: () => {}, native: async () => null }, {
    workspace: {
      getAppState: (key: string, fallback: unknown) => key === 'app-preferences' ? saved : fallback,
      setAppState: (_key: string, value: unknown) => { saved = value },
      getBinding: () => ({ cwd: '/tmp/checkout', folderOnly: false }),
      getRepository: () => ({ root: '/tmp/checkout' }),
    },
    recaps: { settingsChanged: () => {} },
    agents: { activeWriter, invalidateCatalog: () => {}, goalsSettingsChanged: () => {} },
  } as unknown as Services)
  try {
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ autoPull: true })
    expect(await dispatcher.invoke('git.autoPull', ['task', 'repo'])).toBe(true)
    expect(pull).toHaveBeenCalledWith('/tmp/checkout')
    pull.mockClear()
    dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, autoPull: false }])
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ autoPull: false })
    expect(await dispatcher.invoke('git.autoPull', ['task', 'repo'])).toBe(false)
    expect(pull).not.toHaveBeenCalled()
    dispatcher.invoke('settings.app.set', [{ ...DEFAULT_APP_PREFERENCES, autoPull: true }])
    activeWriter.mockReturnValue(true)
    expect(await dispatcher.invoke('git.autoPull', ['task', 'repo'])).toBe(false)
    expect(pull).not.toHaveBeenCalled()
    expect(activeWriter).toHaveBeenCalledWith(['/tmp/checkout'])
  } finally {
    dispatcher.close(); configureProviderBinaries({}); pull.mockRestore()
  }
})
