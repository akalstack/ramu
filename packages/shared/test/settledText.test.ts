import { expect, it } from 'vitest'
import { settledLength } from '../src/chat/settledText'

const settled = (text: string) => text.slice(0, settledLength(text))

it('shows a paragraph as it is written, up to its last whole word', () => {
  expect(settled('Hello')).toBe('')
  expect(settled('Hello there')).toBe('Hello')
  expect(settled('Hello there ')).toBe('Hello there')
  expect(settled('First paragraph.\n\nSecond par')).toBe('First paragraph.\n\nSecond')
  expect(settled('Ends with a line.\n')).toBe('Ends with a line.\n')
})

it('shows a code block line by line before it is closed', () => {
  expect(settled('Intro.\n\n```t')).toBe('Intro.\n\n')
  expect(settled('Intro.\n\n```ts\nconst a = 1\nconst b')).toBe('Intro.\n\n```ts\nconst a = 1\nconst')
})

it('holds a line that so far is only its list, quote or heading marker', () => {
  expect(settled('- one\n- ')).toBe('- one\n')
  expect(settled('- one\n- tw')).toBe('- one\n')
  expect(settled('- one\n- two thr')).toBe('- one\n- two')
  expect(settled('1. first\n2. sec')).toBe('1. first\n')
  expect(settled('Intro\n## Set')).toBe('Intro\n')
  expect(settled('Intro\n## Setup st')).toBe('Intro\n## Setup')
  expect(settled('> quo')).toBe('')
})
