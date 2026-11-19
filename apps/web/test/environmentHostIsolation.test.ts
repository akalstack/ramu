import { beforeEach, expect, it, vi } from 'vitest'
import type { SettingsScope } from '../src/settings/SettingsScope'
const state = vi.hoisted(() => ({ cursor: 0, slots: [] as unknown[], invoke: vi.fn() }))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = typeof next === 'function' ? next(state.slots[index]) : next
      },
    ]
  },
  useEffect() {},
}))
vi.mock('../src/settings/SettingsScope', () => ({ useScopedInvoke: () => state.invoke }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4' }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
import { useProviderEnvironment } from '../src/settings/EnvironmentSettings'
const scope = (key: string, viewer = false) =>
  ({ loadKey: key, targets: [{ id: key, viewOnly: viewer }] }) as SettingsScope
const RenderEnvironment = (key = 'a', viewer = false) => {
  state.cursor = 0
  return useProviderEnvironment(scope(key, viewer), false)
}
const snapshot = (value: string) => ({
  state: 'available',
  canAdminister: true,
  keys: { global: ['TOKEN'] },
  values: { global: [{ key: 'TOKEN', value }] },
})
beforeEach(() => {
  state.slots = []
  state.invoke.mockReset()
})
it('masks the previous host immediately and ignores its late environment response', async () => {
  let finishA!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishA = resolve
      }),
  )
  const old = RenderEnvironment()
  const pending = old.load()
  expect(RenderEnvironment('b').status).toBeNull()
  state.invoke.mockResolvedValueOnce(snapshot('B secret'))
  await RenderEnvironment('b').load()
  finishA(snapshot('A secret'))
  await pending
  const selected = RenderEnvironment('b')
  expect(selected.draft.global?.[0]?.value).toBe('B secret')
  expect(selected.status?.values?.global?.[0]?.value).toBe('B secret')
  old.setDraft({ global: [{ key: 'TOKEN', value: 'stale edit' }] })
  expect(RenderEnvironment('b').draft.global?.[0]?.value).toBe('B secret')
  await expect(old.save()).rejects.toThrow('host changed')
})
it('retains a draft across a viewer role change but refuses old load/save/edit callbacks', async () => {
  state.invoke.mockResolvedValueOnce(snapshot('Original'))
  await RenderEnvironment().load()
  RenderEnvironment().setDraft({ global: [{ key: 'TOKEN', value: 'Draft secret' }] })
  const retained = RenderEnvironment()
  expect(RenderEnvironment('a', true).readOnly).toBe(true)
  state.invoke.mockClear()
  retained.setDraft({ global: [] })
  await retained.load()
  await expect(retained.save()).rejects.toThrow('view-only')
  expect(state.invoke).not.toHaveBeenCalled()
  expect(RenderEnvironment('a', true).draft.global?.[0]?.value).toBe('Draft secret')
})
it('keeps the newest same-host read when refresh responses arrive out of order', async () => {
  let finish!: (value: unknown) => void
  state.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const old = RenderEnvironment().load()
  state.invoke.mockResolvedValueOnce(snapshot('Newest'))
  await RenderEnvironment().load()
  finish(snapshot('Stale'))
  await old
  expect(RenderEnvironment().draft.global?.[0]?.value).toBe('Newest')
})
