import { expect, it } from 'vitest'
import { NO_PROJECT } from '@ramu/shared/types'
import { AUTO_PROJECT } from '@ramu/shared/types'
import {
  clearDraftDestination,
  defaultStartProject,
  draftDestination,
  homeDestination,
  lastStartProject,
  rememberDraftDestination,
  rememberStartProject,
} from '../src/startProject'

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

const projects = [{ id: 'a' }, { id: 'b' }]

it('reopens Home on the destination picked before a restart while it is still valid', () => {
  const base = { autoOn: true, projects, lastProject: 'a' }
  expect(homeDestination({ ...base, saved: 'b' })).toBe('b')
  expect(homeDestination({ ...base, saved: AUTO_PROJECT })).toBe(AUTO_PROJECT)
  expect(homeDestination({ ...base, saved: NO_PROJECT })).toBe(NO_PROJECT)
})

it('ignores a saved project that is gone and a saved Auto once Auto is off', () => {
  expect(homeDestination({ saved: 'gone', autoOn: true, projects, lastProject: null })).toBe(AUTO_PROJECT)
  expect(homeDestination({ saved: AUTO_PROJECT, autoOn: false, projects, lastProject: 'b' })).toBe('b')
  expect(homeDestination({ saved: null, autoOn: false, projects, lastProject: null })).toBe(NO_PROJECT)
})

it('keeps the draft destination until the draft is sent', () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  }
  expect(draftDestination(storage)).toBeNull()
  rememberDraftDestination('b', storage)
  expect(draftDestination(storage)).toBe('b')
  clearDraftDestination(storage)
  expect(draftDestination(storage)).toBeNull()
})
