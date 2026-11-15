import { expect, it } from 'vitest'
import type { ChatBlock } from '@ramu/shared/chat/chatFolding'
import { turnThinking } from '../src/views/agent/lib/turnThinking'

const thought = (text: string): ChatBlock => ({ kind: 'event', event: { kind: 'thinking', text } })
const first = thought('First approach')
const next = thought('Revised approach')
const message: ChatBlock = { kind: 'event', event: { kind: 'text', text: 'The answer' } }
const split = (items: ChatBlock[], finished = false) => turnThinking(items, finished, new Map(), new Map())

it('keeps every thought in place while the turn runs', () => {
  const result = split([first, next, message])
  expect(result.folded).toEqual([])
  expect(result.kept).toEqual([first, next, message])
})

it('folds all thinking into completed work and preserves the answer', () => {
  const result = split([first, next, message], true)
  expect(result.folded).toEqual([first, next])
  expect(result.answer).toEqual([message])
})

it('keeps tool activity beside reasoning in the group and messages outside', () => {
  const tools: ChatBlock = { kind: 'tools', tools: [] }
  const result = split([first, tools, next, message])
  expect(result.folded).toEqual([])
  expect(result.kept).toEqual([first, tools, next, message])
})

it('folds the thoughts when a run stops without an answer', () => {
  expect(split([first, next], true).folded).toEqual([first, next])
})
