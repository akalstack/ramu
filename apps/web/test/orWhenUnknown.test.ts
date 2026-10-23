import { expect, it } from 'vitest'
import { isUnknownMethod, orWhenUnknown } from '../src/lib/errors'

it('falls back only when the host predates the method', async () => {
  const unknown = () =>
    Promise.reject(new Error("Error invoking remote method 'x': Error: Unknown method workspaces.list"))
  expect(await orWhenUnknown(unknown, [])).toEqual([])
  expect(await orWhenUnknown(() => Promise.resolve(['a']), [])).toEqual(['a'])
  await expect(orWhenUnknown(() => Promise.reject(new Error('Host is offline')), [])).rejects.toThrow('offline')
  await expect(orWhenUnknown(() => Promise.reject(new Error('Invalid arguments')), null)).rejects.toThrow('Invalid')
})

it('recognizes the unknown-method message through the Electron wrapper', () => {
  expect(isUnknownMethod(new Error('Unknown method tasks.workspaceOptions'))).toBe(true)
  expect(isUnknownMethod(new Error("Error invoking remote method 'm': Error: Unknown method a.b"))).toBe(true)
  expect(isUnknownMethod(new Error('The Unknown method was fine'))).toBe(false)
})
