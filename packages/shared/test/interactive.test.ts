import { expect, it } from 'vitest'
import { interactiveFollowup, readInteractiveState, type InteractiveReference } from '../src/interactive'
import { interactiveStorage } from '../src/interactiveStorage'
import { claimInteractive } from '../src/interactiveLease'
it('rejects malformed, cyclic and oversized state without trusting generated messages', () => {
  expect(readInteractiveState({ controls: [], custom: { step: 3 } })).toEqual({ controls: [], custom: { step: 3 } })
  for (const value of [
    null,
    { controls: [] },
    { controls: [{ key: 'x', value: 4, checked: false }], custom: null },
    { controls: [], custom: 'x'.repeat(33_000) },
    {
      controls: [
        { key: 'same', value: 'a', checked: false },
        { key: 'same', value: 'b', checked: false },
      ],
      custom: null,
    },
    { controls: [{ key: 'label', value: 'a', checked: false, label: 'x'.repeat(201) }], custom: null },
  ])
    expect(readInteractiveState(value)).toBeNull()
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(readInteractiveState(cycle)).toBeNull()
})
it('keeps scenarios separate by version/host and bounds the offline document cache', () => {
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v)
      },
    }
  const a = interactiveStorage(storage, 'hostA'),
    b = interactiveStorage(storage, 'hostB')
  const ref = {
    id: 'content',
    version: 1,
    sessionId: 's',
    title: 'Capacity',
    summary: 'Adjust people',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  } satisfies InteractiveReference
  a.saveState('content', 1, { controls: [], custom: { people: 4 } })
  a.saveDocument({ reference: ref, html: '<p>Saved</p>', preview: null })
  expect(interactiveStorage(storage, 'hostA').state('content', 1)?.custom).toEqual({ people: 4 })
  expect(a.state('content', 2)).toBeNull()
  expect(b.document('content', 1)).toBeNull()
  expect(interactiveFollowup(ref, a.state('content', 1))).toContain('version 1, digest hash')
  expect(interactiveFollowup(ref, a.state('content', 1))).toContain('"people":4')
  for (let version = 2; version <= 8; version++)
    a.saveDocument({ reference: { ...ref, version }, html: 'new', preview: null })
  expect(a.document('content', 1)).toBeNull()
  expect(a.state('content', 1)?.custom).toEqual({ people: 4 })
  a.saveState('content', 1, null)
  expect(a.state('content', 1)).toBeNull()
})
it('revokes the previous runtime when another document opens', () => {
  let stopped = 0
  const release = claimInteractive(() => stopped++)
  const next = claimInteractive(() => stopped++)
  expect(stopped).toBe(1)
  release()
  next()
  const last = claimInteractive(() => stopped++)
  expect(stopped).toBe(1)
  last()
})

it('saves independent named copies, scopes them by host/version, and reports quota failures', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => {
      values.set(k, v)
    },
  }
  const cache = interactiveStorage(storage, 'host')
  const scenario = { controls: [], custom: { people: 4 } }
  expect(cache.saveScenario('content', 1, '  Small team  ', scenario)).toBe(true)
  scenario.custom.people = 99
  expect(cache.scenarios('content', 1)[0]?.state.custom).toEqual({ people: 4 })
  expect(interactiveStorage(storage, 'other').scenarios('content', 1)).toEqual([])
  expect(cache.scenarios('content', 2)).toEqual([])
  cache.saveState('content', 1, null)
  expect(cache.scenarios('content', 1)).toHaveLength(1)
  for (let i = 0; i < 5; i++) expect(cache.saveScenario('content', 1, `Scenario ${i}`, scenario)).toBe(true)
  expect(cache.saveScenario('content', 1, 'Seventh', scenario)).toBe(false)
  expect(cache.saveScenario('content', 1, 'Small team', scenario)).toBe(true)
  expect(cache.removeScenario('content', 1, 'Small team')).toBe(true)
  expect(cache.scenarios('content', 1)).toHaveLength(5)
  expect(cache.saveScenario('content', 1, '', scenario)).toBe(false)
  expect(cache.saveScenario('content', 1, 'invalid', { controls: [], custom: 'x'.repeat(33_000) })).toBe(false)
  const locked = interactiveStorage(
    {
      getItem: () => null,
      setItem: () => {
        throw new Error('Full')
      },
    },
    'host',
  )
  expect(locked.saveScenario('c', 1, 'Name', scenario)).toBe(false)
})

it('does not silently evict named copies at the host limit', () => {
  const values = new Map<string, string>()
  const cache = interactiveStorage(
    {
      getItem: (k) => values.get(k) ?? null,
      setItem: (k, v) => {
        values.set(k, v)
      },
    },
    'host',
  )
  const state = { controls: [], custom: null }
  for (let i = 0; i < 20; i++) expect(cache.saveScenario(`content-${i}`, 1, 'Saved', state)).toBe(true)
  expect(cache.saveScenario('extra', 1, 'Saved', state)).toBe(false)
  expect(cache.scenarios('content-0', 1)).toHaveLength(1)
  expect(cache.saveScenario('content-0', 1, 'Saved', { controls: [], custom: 'updated' })).toBe(true)
})

it('stages only explicitly selected captured values with their exact source reference', async () => {
  const { interactiveSelectedFollowup } = await import('../src/interactive')
  const ref: InteractiveReference = {
    id: 'c',
    version: 2,
    sessionId: 's',
    title: 'Capacity',
    summary: 'Explore',
    digest: 'hash',
    createdAt: 1,
    checked: true,
  }
  const state = {
    controls: [
      { key: 'people', label: 'People', value: '7', checked: false },
      { key: 'private-note', value: 'omit me', checked: false },
    ],
    custom: { internal: 'omit custom' },
  }
  const selected = interactiveSelectedFollowup(ref, state, ['people', 'unknown'], false)
  expect(selected).toContain('version 2, digest hash')
  expect(selected).toContain('"label":"People"')
  expect(selected).not.toContain('omit me')
  expect(selected).not.toContain('omit custom')
  expect(selected).toContain('captured scenario')
  expect(interactiveSelectedFollowup(ref, state, [], true)).toContain('omit custom')
})
