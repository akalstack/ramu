import { expect, it } from 'vitest'
import { thoughtLine } from '../src/chat/thoughtLine'

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
