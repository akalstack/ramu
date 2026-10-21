import { expect, it } from 'vitest'
import type { ChatBlock } from '@ramu/shared/chat/chatFolding'
import { turnThinking } from '../src/views/agent/lib/turnThinking'

const thought = (text: string): ChatBlock => ({ kind: 'event', event: { kind: 'thinking', text } })
const first = thought('First approach')
const next = thought('Revised approach')
const message: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'The answer' } }
const split = (items: ChatBlock[], finished = false) => turnThinking(items, finished, new Map(), new Map())

it('has no outside thinking slot until reasoning arrives', () => {
  expect(split([message]).thinking).toBeUndefined()
  expect(split([message]).kept).toEqual([message])
})

it('replaces the outside thinking while preserving both thoughts in the work group', () => {
  expect(split([first]).thinking?.text).toBe('First approach')
  const result = split([first, next, message])
  expect(result.thinking?.text).toBe('Revised approach')
  expect(result.folded).toEqual([])
  expect(result.kept).toEqual([first, next, message])
})

it('folds all thinking into completed work and preserves the answer', () => {
  const result = split([first, next, message], true)
  expect(result.thinking).toBeUndefined()
  expect(result.folded).toEqual([first, next])
  expect(result.answer).toEqual([message])
})

it('keeps tool activity beside reasoning in the group and messages outside', () => {
  const tools: ChatBlock = { kind: 'tools', tools: [] }
  const result = split([first, tools, next, message])
  expect(result.folded).toEqual([])
  expect(result.kept).toEqual([first, tools, next, message])
  expect(result.thinking?.text).toBe('Revised approach')
})

it('hides the outside thought when a run stops without an answer', () => {
  const result = split([first, next], true)
  expect(result.thinking).toBeUndefined()
  expect(result.folded).toEqual([first, next])
})
