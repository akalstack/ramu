import { expect, it } from 'vitest'
import { createDispatcher, type Services } from '../src/ipc'
import { deviceMayInvoke } from '../src/remote/access'
import type { DeviceInfo } from '../src/remote/devices'

function dispatcher() {
  const state = new Map<string, unknown>()
  const sent: string[] = []
  const d = createDispatcher(
    { userData: '/tmp', send: (channel: string) => sent.push(channel), native: async () => null } as never,
    {
      workspace: {
        getAppState: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
        setAppState: (key: string, value: unknown) => state.set(key, value),
      },
      agents: {},
    } as unknown as Services,
  )
  return { d, sent }
}

it('keeps the shared mobile model flow per field, discards stale writes and clears an override', async () => {
  const { d, sent } = dispatcher()
  const get = () =>
    d.invoke('preferences.layers.get', []) as Promise<{ mobile: { fields: Record<string, { value: unknown }> } }>
  const set = (edit: object) => d.invoke('preferences.layers.set', [edit]) as Promise<{ applied: boolean }>
  expect((await get()).mobile.fields).toEqual({})
  expect((await set({ id: 'modelFlow', value: 'effort', at: Date.now(), by: 'phone-a' })).applied).toBe(true)
  expect((await get()).mobile.fields.modelFlow?.value).toBe('effort')
  expect(sent).toContain('settings:changed')
  // A write that was made earlier on a phone that was offline does not replace the newer choice.
  expect((await set({ id: 'modelFlow', value: 'model', at: 1, by: 'phone-b' })).applied).toBe(false)
  expect((await get()).mobile.fields.modelFlow?.value).toBe('effort')
  expect((await set({ id: 'modelFlow', at: Date.now() + 1000, by: 'phone-b' })).applied).toBe(true)
  expect((await get()).mobile.fields).toEqual({})
  expect(() => set({ id: 'modelFlow', value: 'sideways', at: 5, by: 'x' })).toThrow()
  expect(() => set({ id: 'other', value: 'model', at: 5, by: 'x' })).toThrow()
})

it('carries the composer fields on the same layer, each with its own values and its own revision', async () => {
  const { d } = dispatcher()
  const get = () =>
    d.invoke('preferences.layers.get', []) as Promise<{ mobile: { fields: Record<string, { value: unknown }> } }>
  const set = (edit: object) => d.invoke('preferences.layers.set', [edit]) as Promise<{ applied: boolean }>
  expect((await set({ id: 'queueWhileBusy', value: 'queue', at: 100, by: 'phone-a' })).applied).toBe(true)
  expect((await set({ id: 'modelChangeWarning', value: false, at: 100, by: 'phone-a' })).applied).toBe(true)
  const fields = (await get()).mobile.fields
  expect(fields.queueWhileBusy?.value).toBe('queue')
  expect(fields.modelChangeWarning?.value).toBe(false)
  // Revisions are per field: an old write to one field leaves the other alone, and a stale write is dropped.
  expect((await set({ id: 'queueWhileBusy', value: 'steer', at: 50, by: 'phone-b' })).applied).toBe(false)
  expect((await set({ id: 'modelChangeWarning', at: 200, by: 'phone-b' })).applied).toBe(true)
  const after = (await get()).mobile.fields
  expect(after.queueWhileBusy?.value).toBe('queue')
  expect(after.modelChangeWarning).toBeUndefined()
  // Each field refuses values that belong to another one.
  expect(() => set({ id: 'queueWhileBusy', value: 'effort', at: 300, by: 'x' })).toThrow()
  expect(() => set({ id: 'queueWhileBusy', value: true, at: 300, by: 'x' })).toThrow()
  expect(() => set({ id: 'modelChangeWarning', value: 'yes', at: 300, by: 'x' })).toThrow()
})

it('lets a viewer phone read but not change the shared setting', () => {
  const viewer = { role: 'viewer' } as unknown as DeviceInfo
  expect(deviceMayInvoke(viewer, 'preferences.layers.get')).toBe(true)
  expect(deviceMayInvoke(viewer, 'preferences.layers.set')).toBe(false)
})
