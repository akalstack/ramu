import { expect, it } from 'vitest'
import { EMPTY_BLOCK_SCAN, scanBlocks, settledLength } from '../src/chat/settledText'

const settled = (text: string) => text.slice(0, settledLength(scanBlocks(EMPTY_BLOCK_SCAN, text)))

it('holds a paragraph until a blank line ends it', () => {
  expect(settled('Hello there')).toBe('')
  expect(settled('Hello there\nstill going')).toBe('')
  expect(settled('First paragraph.\n\nSecond')).toBe('First paragraph.\n\n')
  expect(settled('One.\n\nTwo.\n\nThr')).toBe('One.\n\nTwo.\n\n')
})
it('keeps a code block whole, blank lines inside it included', () => {
  const code = 'Intro.\n\n```ts\nconst a = 1\n\nconst b = 2\n'
  expect(settled(code)).toBe('Intro.\n\n')
  expect(settled(`${code}\`\`\`\n`)).toBe(`${code}\`\`\`\n`)
  expect(settled(`${code}\`\`\``)).toBe('Intro.\n\n')
  expect(settled('Run ```npm test``` now.\n\nNext')).toBe('Run ```npm test``` now.\n\n')
})
it('only closes a fence with the same marker at least as long', () => {
  expect(settled('````\na\n```\n\nb\n')).toBe('')
  expect(settled('~~~\na\n```\n~~~\n')).toBe('~~~\na\n```\n~~~\n')
})
it('sends each item of a list once the next one begins', () => {
  expect(settled('Steps:\n\n- one\n- tw')).toBe('Steps:\n\n- one\n')
  expect(settled('- one\n- two\n- ')).toBe('- one\n')
  expect(settled('1. first\n2. second\n3')).toBe('1. first\n')
})
it('ends a paragraph at a heading and holds a title until its content starts', () => {
  expect(settled('Intro line\n## Setup\n')).toBe('Intro line\n')
  expect(settled('Intro.\n\n## Setup\n\n')).toBe('Intro.\n\n')
  expect(settled('Intro.\n\n## Setup\n\nInstall it.\n\n')).toBe('Intro.\n\n## Setup\n\nInstall it.\n\n')
  expect(settled('**Branches:**\n\n')).toBe('')
})
it('gives the same result resumed piece by piece as scanned whole', () => {
  const text = 'One.\n\n```\na\n\nb\n```\n\n## Title\n\n- x\n- y\n\nThree.\n\nFou'
  let scan = EMPTY_BLOCK_SCAN
  for (let end = 1; end <= text.length; end++) {
    scan = scanBlocks(scan, text.slice(0, end))
    expect(settledLength(scan)).toBe(settledLength(scanBlocks(EMPTY_BLOCK_SCAN, text.slice(0, end))))
  }
  expect(settledLength(scanBlocks(scan, 'Rewritten.\n\n'))).toBe('Rewritten.\n\n'.length)
})
