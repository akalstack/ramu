import { expect, it } from 'vitest'
import { acceptComposerTrigger, composerTrigger } from '../src/chat/composerTrigger'

it('finds the trigger token ending at the caret', () => {
  expect(composerTrigger('/', 1)).toEqual({ mode: '/', query: '', start: 0 })
  expect(composerTrigger('fix @src/ma', 11)).toEqual({ mode: '@', query: 'src/ma', start: 4 })
  expect(composerTrigger('use $rev', 8)).toEqual({ mode: '$', query: 'rev', start: 4 })
  expect(composerTrigger('use $', 5)).toEqual({ mode: '$', query: '', start: 4 })
  // Only the text before the caret counts.
  expect(composerTrigger('use $review now', 8)).toEqual({ mode: '$', query: 'rev', start: 4 })
})

it('ignores triggers inside words and dollar text that is not a skill name', () => {
  expect(composerTrigger('a/b', 3)).toBeNull()
  expect(composerTrigger('mail me@host', 12)).toBeNull()
  expect(composerTrigger('costs $5', 8)).toBeNull()
  expect(composerTrigger('echo $(pwd', 10)).toBeNull()
  expect(composerTrigger('price US$', 9)).toBeNull()
  expect(composerTrigger('done ', 5)).toBeNull()
})

it('replaces the trigger and query with the accepted choice', () => {
  const text = 'please $rev this'
  const trigger = composerTrigger(text, 11)!
  expect(acceptComposerTrigger(text, 11, trigger, '$review ')).toEqual({ value: 'please $review  this', caret: 15 })
  const slash = composerTrigger('/go', 3)!
  expect(acceptComposerTrigger('/go', 3, slash, '/goal ')).toEqual({ value: '/goal ', caret: 6 })
})
