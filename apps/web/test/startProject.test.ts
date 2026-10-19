import { expect, it } from 'vitest'
import { NO_PROJECT } from '@ramu/shared/types'
import { defaultStartProject, lastStartProject, rememberStartProject } from '../src/startProject'

const store = () => {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  }
}

it('starts on No project until a project has been used', () => {
  expect(defaultStartProject(null, [{ id: 'a' }])).toBe(NO_PROJECT)
  expect(defaultStartProject(null, [])).toBe(NO_PROJECT)
})

it('selects the remembered project while it exists', () => {
  expect(defaultStartProject('b', [{ id: 'a' }, { id: 'b' }])).toBe('b')
})

it('falls back to No project when the remembered project was removed or on another host', () => {
  expect(defaultStartProject('gone', [{ id: 'a' }])).toBe(NO_PROJECT)
  expect(defaultStartProject(NO_PROJECT, [{ id: 'a' }])).toBe(NO_PROJECT)
})

it('remembers the last project across reads and survives a broken store', () => {
  const storage = store()
  expect(lastStartProject(storage)).toBeNull()
  rememberStartProject('b', storage)
  expect(lastStartProject(storage)).toBe('b')
  const broken = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('full')
    },
  }
  expect(lastStartProject(broken)).toBeNull()
  expect(() => rememberStartProject('c', broken)).not.toThrow()
})
