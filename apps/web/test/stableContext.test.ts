import { expect, it } from 'vitest'
import { stableContext } from '../src/lib/stableContext'

it('gives a provider module re-run by a hot reload the same context, so providers on screen still match', () => {
  const first = stableContext<number | null>('StableContextTest', null, true)
  const again = stableContext<number | null>('StableContextTest', null, true)
  expect(again).toBe(first)
  expect(first.displayName).toBe('StableContextTest')
})

it('makes a fresh context each time in a build, where nothing reloads', () => {
  expect(stableContext('StableContextBuild', 0, false)).not.toBe(stableContext('StableContextBuild', 0, false))
})
