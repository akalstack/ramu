import { expect, it } from 'vitest'
import { loadRouteChoice, saveRouteChoice } from '../src/composer/routeChoice'

const memory = () => {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  }
}

it('restores candidates for the same prompt and drops unknown projects', () => {
  const store = memory()
  saveRouteChoice(store, 'Fix login', [
    { projectId: 'a', reason: 'login' },
    { projectId: 'gone', reason: '' },
  ])
  expect(loadRouteChoice(store, 'Fix login', ['a', 'b'])).toEqual([{ projectId: 'a', reason: 'login' }])
})

it('does not restore for an edited prompt, an expired choice or when cleared', () => {
  const store = memory()
  saveRouteChoice(store, 'Fix login', [{ projectId: 'a', reason: '' }], 0)
  expect(loadRouteChoice(store, 'Fix logins', ['a'], 1)).toBeNull()
  saveRouteChoice(store, 'Fix login', [{ projectId: 'a', reason: '' }], 0)
  expect(loadRouteChoice(store, 'Fix login', ['a'], 25 * 60 * 60 * 1000)).toBeNull()
  saveRouteChoice(store, 'Fix login', [{ projectId: 'a', reason: '' }])
  saveRouteChoice(store, 'Fix login', null)
  expect(loadRouteChoice(store, 'Fix login', ['a'])).toBeNull()
})
