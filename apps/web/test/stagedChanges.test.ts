import { expect, it, vi } from 'vitest'
import { commitStaged, withStaged, type StagedChanges } from '../src/settings/stagedChanges'

const none: StagedChanges = new Map()

it('tracks a setting only while it differs from what is saved', () => {
  const apply = vi.fn()
  const changed = withStaged(none, 'theme', 'rose', 'sand', apply)
  expect(changed.get('theme')?.value).toBe('rose')
  expect(withStaged(changed, 'theme', 'sand', 'sand', apply).size).toBe(0)
  expect(apply).not.toHaveBeenCalled()
})

it('compares lists by value, so undoing a toggle is no change', () => {
  const changed = withStaged(none, 'defaults', ['a', 'b'], ['a'], vi.fn())
  expect(withStaged(changed, 'defaults', ['a'], ['a'], vi.fn()).size).toBe(0)
})

it('applies in order and keeps what a failure left unapplied', async () => {
  const seen: string[] = []
  let changes = withStaged(none, 'one', 1, 0, () => seen.push('one'))
  changes = withStaged(changes, 'two', 2, 0, () => {
    throw new Error('refused')
  })
  changes = withStaged(changes, 'three', 3, 0, () => seen.push('three'))
  const { left, error } = await commitStaged(changes)
  expect(seen).toEqual(['one'])
  expect([...left.keys()]).toEqual(['two', 'three'])
  expect(error).toEqual(new Error('refused'))
})
