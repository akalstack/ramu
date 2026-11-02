import { expect, it } from 'vitest'
import { dropFavorite, moveFavorite } from '../src/workspace/favorites'

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

it('drops a favorite onto the row it was dragged to, in either direction, around hidden favorites', () => {
  const favorites = ['a', 'hidden', 'b', 'c']
  const shown = ['a', 'b', 'c']
  expect(dropFavorite(favorites, shown, 'a', 'c')).toEqual(['hidden', 'b', 'c', 'a'])
  expect(dropFavorite(favorites, shown, 'c', 'a')).toEqual(['c', 'a', 'hidden', 'b'])
  expect(dropFavorite(favorites, shown, 'a', 'b')).toEqual(['hidden', 'b', 'a', 'c'])
})
