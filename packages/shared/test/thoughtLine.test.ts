import { expect, it } from 'vitest'
import {
  LONG_THOUGHT_MS,
  NEW_THOUGHT,
  thoughtBlock,
  thoughtLine,
  thoughtTitle,
  tickThought,
} from '../src/chat/thoughtLine'

const thought = '**Reading the config**\n\nThe loader reads `app.json` first.\n\n- Then it checks the env'

it('folds a finished thought to its opening as plain text', () => {
  expect(thoughtLine(thought, false)).toBe('Reading the config The loader reads app.json first. Then it checks the env')
})

it('follows the newest finished paragraph while the thought streams', () => {
  // The last paragraph is still being written, so the line stays on the one finished before it.
  expect(thoughtLine(thought, true)).toBe('The loader reads app.json first.')
  expect(thoughtLine(`${thought} variables.\n\nNext`, true)).toBe('Then it checks the env variables.')
  expect(thoughtLine('Looking around\n\n', true)).toBe('Looking around')
})

it('has no line for a thought still on its first paragraph, so its row says Thinking', () => {
  expect(thoughtLine('I', true)).toBe('')
  expect(thoughtLine('I am checking how the promote step works. Next I will', true)).toBe('')
  expect(thoughtLine('**Reading the config**\n\nThe loa', true)).toBe('Reading the config')
  // Once it has ended, the whole thought reads from its opening as before.
  expect(thoughtLine('I am checking how the prom', false)).toBe('I am checking how the prom')
})

it('counts the paragraphs of a thought, so its line changes a block at a time', () => {
  expect(thoughtBlock('Looking around')).toBe(1)
  expect(thoughtBlock('Looking around\n\n')).toBe(1)
  expect(thoughtBlock(thought)).toBe(3)
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
