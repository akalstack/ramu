import { expect, it } from 'vitest'
import { settledTextLength } from '../src/chat/settledText'

const settled = (text: string) => text.slice(0, settledTextLength(text))

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
})
it('only closes a fence with the same marker at least as long', () => {
  expect(settled('````\na\n```\n\nb\n')).toBe('')
  expect(settled('~~~\na\n```\n~~~\n')).toBe('~~~\na\n```\n~~~\n')
})

it('resumes from an earlier settled length with the same result as a full scan', () => {
  const text = 'One.\n\n```\na\n\nb\n```\n\nThree.\n\nFou'
  let from = 0
  for (let end = 1; end <= text.length; end++) {
    from = settledTextLength(text.slice(0, end), from)
    expect(from).toBe(settledTextLength(text.slice(0, end)))
  }
})
