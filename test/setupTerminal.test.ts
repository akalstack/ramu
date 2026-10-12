import { expect, it, vi } from 'vitest'
import { homedir } from 'node:os'
import { createDispatcher, type Services } from '../src/main/ipc'
import { configureProviderBinaries } from '../src/main/providerBinaries'

it('opens a setup PTY at home without a task and sends commands through terminal input', () => {
  const open = vi.fn(() => ({ id: 'terminal', taskId: 'provider-setup', repoId: null, cwd: homedir(), exited: false }))
  const write = vi.fn()
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-test', send: () => {}, native: async () => null }, {
    workspace: { getAppState: (_key: string, fallback: unknown) => fallback, setAppState: vi.fn() },
    terminals: { open, write },
  } as unknown as Services)
  try {
    expect(dispatcher.invoke('term.openSetup', [120, 30])).toMatchObject({ cwd: homedir(), repoId: null })
    expect(open).toHaveBeenCalledWith('provider-setup', null, homedir(), 120, 30)
    dispatcher.invoke('term.write', ['terminal', 'echo setup\r'])
    expect(write).toHaveBeenCalledWith('terminal', 'echo setup\r')
    expect(() => dispatcher.invoke('term.openSetup', [1, 30])).toThrow()
  } finally { dispatcher.close(); configureProviderBinaries({}) }
})

it('migrates the busy-message default to Steer while preserving a newly saved Queue choice', () => {
  let saved = { busyMessageAction: 'queue', messageBehaviorVersion: 3 }
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-test', send: () => {}, native: async () => null }, {
    workspace: { getAppState: (key: string, fallback: unknown) => key === 'app-preferences' ? saved : fallback, setAppState: vi.fn() },
  } as unknown as Services)
  try {
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ busyMessageAction: 'steer', messageBehaviorVersion: 4 })
    saved = { busyMessageAction: 'queue', messageBehaviorVersion: 4 }
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ busyMessageAction: 'queue', messageBehaviorVersion: 4 })
  } finally { dispatcher.close(); configureProviderBinaries({}) }
})

it('ignores removed editor settings and preserves an explicit font smoothing choice', () => {
  let saved: Record<string, unknown> = { formatOnSave: true, languageServers: true, aiCompletion: { enabled: true } }
  const dispatcher = createDispatcher({ userData: '/tmp/ramu-test', send: () => {}, native: async () => null }, {
    workspace: { getAppState: (key: string, fallback: unknown) => key === 'app-preferences' ? saved : fallback, setAppState: vi.fn() },
  } as unknown as Services)
  try {
    const preferences = dispatcher.invoke('settings.app.get', [])
    expect(preferences).toMatchObject({ fontSmoothing: true })
    for (const key of ['formatOnSave', 'languageServers', 'aiCompletion']) expect(preferences).not.toHaveProperty(key)
    saved = { ...saved, fontSmoothing: false }
    expect(dispatcher.invoke('settings.app.get', [])).toMatchObject({ fontSmoothing: false })
    for (const method of ['files.format', 'lsp.open', 'completion.complete']) expect(() => dispatcher.invoke(method, [])).toThrow()
  } finally { dispatcher.close(); configureProviderBinaries({}) }
})
