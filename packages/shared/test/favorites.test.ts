import { expect, it } from 'vitest'
import { moveFavorite } from '../src/favorites'

it('moves favorites before and after a target while preserving hidden favorites', () => {
  const favorites = ['codex:a', 'claude-code:hidden', 'codex:b', 'claude-code:c']
  expect(moveFavorite(favorites, 'claude-code:c', 'codex:a')).toEqual([
    'claude-code:c',
    'codex:a',
    'claude-code:hidden',
    'codex:b',
  ])
  expect(moveFavorite(favorites, 'codex:a', 'codex:b', true)).toEqual([
    'claude-code:hidden',
    'codex:b',
    'codex:a',
    'claude-code:c',
  ])
  expect(moveFavorite(favorites, 'missing', 'codex:b')).toBe(favorites)
  expect(moveFavorite(favorites, 'codex:a', 'codex:a')).toBe(favorites)
  expect(favorites).toEqual(['codex:a', 'claude-code:hidden', 'codex:b', 'claude-code:c'])
})
