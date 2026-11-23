import { expect, it } from 'vitest'
import { LONG_THOUGHT_MS, NEW_THOUGHT, thoughtLine, thoughtTitle, tickThought } from '../src/chat/thoughtLine'

const thought = '**Reading the config**\n\nThe loader reads `app.json` first.\n\n- Then it checks the env'

it('folds a finished thought to its opening as plain text', () => {
  expect(thoughtLine(thought, false)).toBe('Reading the config The loader reads app.json first. Then it checks the env')
})

it('follows the newest paragraph while the thought streams', () => {
  expect(thoughtLine(thought, true)).toBe('Then it checks the env')
  expect(thoughtLine('Looking around\n\n', true)).toBe('Looking around')
})

it('is empty when nothing readable is left', () => {
  expect(thoughtLine('```\n```', false)).toBe('')
  expect(thoughtLine('', true)).toBe('')
})

it('times a thought from when it is first seen streaming until it ends', () => {
  let clock = tickThought(NEW_THOUGHT, true, 1000)
  expect(tickThought(clock, true, 2000)).toBe(clock)
  clock = tickThought(clock, false, 5200)
  expect(clock).toEqual({ startedAt: null, took: 4200 })
  expect(tickThought(clock, false, 9000)).toBe(clock)
  // A thought that had already ended when it came on screen has no duration.
  expect(tickThought(NEW_THOUGHT, false, 1000)).toEqual(NEW_THOUGHT)
})

it('titles a thought by whether it streams and how long it took', () => {
  expect(thoughtTitle(true, null)).toEqual({ label: 'Thinking' })
  expect(thoughtTitle(false, null)).toEqual({ label: 'Thought' })
  expect(thoughtTitle(false, LONG_THOUGHT_MS - 1)).toEqual({ label: 'Thought' })
  expect(thoughtTitle(false, 4200)).toEqual({ label: 'Thought for {0}', took: 4200 })
})
