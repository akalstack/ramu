import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  host: { id: 'a', isLocal: false, invoke: vi.fn() },
  value: null as { id: string; viewOnly: boolean } | null,
  deps: [] as unknown[],
  cleanup: undefined as undefined | (() => void),
  pending: [] as (() => void)[],
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => state.host }))
vi.mock('react', () => ({
  useState: () => [
    state.value,
    (next: typeof state.value) => {
      state.value = next
    },
  ],
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    if (deps.length === state.deps.length && deps.every((value, index) => value === state.deps[index])) return
    state.pending.push(() => {
      state.cleanup?.()
      state.deps = deps
      state.cleanup = run() || undefined
    })
  },
}))
let useViewOnly: () => boolean
const RenderRole = () => {
  const value = useViewOnly()
  state.pending.splice(0).forEach((run) => run())
  return value
}
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}
beforeEach(async () => {
  vi.resetModules()
  state.value = null
  state.deps = []
  state.pending = []
  state.cleanup = undefined
  state.host = { id: 'a', isLocal: false, invoke: vi.fn().mockResolvedValue({ access: 'viewer' }) }
  ;({ useViewOnly } = await import('../src/composer/useViewOnly'))
})
afterEach(() => state.cleanup?.())

it('does not carry another host role or a late status answer into the selected host', async () => {
  let answer!: (value: unknown) => void
  state.host.invoke = vi.fn(
    () =>
      new Promise((resolve) => {
        answer = resolve
      }),
  )
  expect(RenderRole()).toBe(false)
  state.host = { id: 'b', isLocal: false, invoke: vi.fn().mockResolvedValue({ access: 'owner' }) }
  expect(RenderRole()).toBe(false)
  await settle()
  answer({ access: 'viewer' })
  await settle()
  expect(RenderRole()).toBe(false)
  state.host = { id: 'a', isLocal: false, invoke: vi.fn().mockResolvedValue({ access: 'viewer' }) }
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host = { id: 'c', isLocal: false, invoke: vi.fn().mockResolvedValue({ access: 'owner' }) }
  expect(RenderRole()).toBe(false)
})

it('retains confirmed viewer access when a new connection fails, and recovers on an owner answer', async () => {
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host = { ...state.host, invoke: vi.fn().mockRejectedValue(new Error('offline')) }
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host = { ...state.host, invoke: vi.fn().mockResolvedValue({}) }
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host = { ...state.host, invoke: vi.fn().mockResolvedValue({ access: 'owner' }) }
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(false)
})

it('shares a fresh role read and keeps the local host unrestricted', async () => {
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.value = null
  state.deps = []
  state.cleanup?.()
  expect(RenderRole()).toBe(true)
  expect(state.host.invoke).toHaveBeenCalledOnce()
  state.host = { ...state.host, id: '', isLocal: true }
  expect(RenderRole()).toBe(false)
})

it('rechecks a reconnect even when the host-bound invoker remains the same', async () => {
  Object.assign(state.host, { status: 'connected' })
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host.invoke.mockRejectedValue(new Error('offline'))
  Object.assign(state.host, { status: 'offline' })
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(true)
  state.host.invoke.mockResolvedValue({ access: 'owner' })
  Object.assign(state.host, { status: 'connected' })
  RenderRole()
  await settle()
  expect(RenderRole()).toBe(false)
  expect(state.host.invoke).toHaveBeenCalledTimes(3)
})
