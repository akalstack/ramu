import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ProviderSignIn } from '@ramu/shared/providers/providers'

vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (value: unknown) => ({ current: value }),
  useEffect: () => {},
}))
vi.mock('../src/views/TerminalView', () => ({ TerminalView: () => null }))
vi.mock('../src/ipc', () => ({ ramu: { invoke: vi.fn() } }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ isLocal: true }) }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage: () => {} }))

const { useSignInWatch } = await import('../src/models/ProviderSetupTerminal')

let closes = 0
beforeEach(() => {
  vi.useFakeTimers()
  closes = 0
  vi.stubGlobal('window', new EventTarget())
  window.addEventListener('ramu:provider-terminal-close', () => closes++)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const useWatching = (answers: (ProviderSignIn | undefined)[]) => {
  let index = 0
  const signedIn = vi.fn()
  const check = vi.fn(async () => answers[Math.min(index++, answers.length - 1)])
  useSignInWatch(check, signedIn)()
  return { signedIn }
}

it('leaves the terminal open while a login that was already there is signed in again', async () => {
  const same = { signedIn: true, email: 'me@example.com' }
  const { signedIn } = useWatching([same, same, same, same])
  await vi.advanceTimersByTimeAsync(12_000)
  expect(closes).toBe(0)
  expect(signedIn).not.toHaveBeenCalled()
})

it('closes the terminal once the login is new, and shows it', async () => {
  const { signedIn } = useWatching([
    { signedIn: false },
    { signedIn: false },
    { signedIn: true, email: 'me@example.com' },
  ])
  await vi.advanceTimersByTimeAsync(3_000)
  expect(closes).toBe(0)
  await vi.advanceTimersByTimeAsync(3_000)
  expect(closes).toBe(1)
  expect(signedIn).toHaveBeenCalledOnce()
})

it('closes when another account replaces the one signed in', async () => {
  useWatching([
    { signedIn: true, email: 'old@example.com' },
    { signedIn: true, email: 'new@example.com' },
  ])
  await vi.advanceTimersByTimeAsync(3_000)
  expect(closes).toBe(1)
})
