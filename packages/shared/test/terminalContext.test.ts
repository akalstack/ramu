import { expect, it } from 'vitest'
import {
  addTerminalAttachment,
  isTerminalAttachmentList,
  sentTerminalAttachments,
  terminalAttachment,
  terminalAttachmentBlock,
  terminalAttachmentLabel,
  TERMINAL_ATTACHMENT_LIMIT,
  TERMINAL_ATTACHMENTS_MAX,
} from '../src/chat/terminalContext'
import { terminalPlainLines, terminalTail } from '../src/workspace/terminalText'

it('tidies a capture and refuses one with nothing in it', () => {
  expect(terminalAttachment('ramu', [3, 5], '   \r\n  \n', 'a')).toBeNull()
  expect(terminalAttachment('ramu', [3, 5], '\n$ pnpm test   \r\nFAIL  a.test.ts  \n\n', 'a')).toEqual({
    id: 'a',
    terminal: 'ramu',
    lines: [3, 5],
    text: '$ pnpm test\nFAIL  a.test.ts',
  })
})

it('keeps the end of a long capture, starting on a whole line, and says which lines it kept', () => {
  const lines = Array.from({ length: 5000 }, (_, index) => `line ${index + 1} ${'x'.repeat(20)}`)
  const item = terminalAttachment('ramu', [1, 5000], lines.join('\n'), 'a')!
  expect(item.text.length).toBeLessThanOrEqual(TERMINAL_ATTACHMENT_LIMIT)
  expect(item.text.endsWith(lines.at(-1)!)).toBe(true)
  const first = item.text.split('\n')[0]!
  expect(first).toBe(lines[item.lines[0] - 1])
  expect(item.lines[1]).toBe(5000)
})

it('labels a range and a single line', () => {
  expect(terminalAttachmentLabel({ terminal: 'ramu', lines: [12, 40] })).toBe('ramu · 12–40')
  expect(terminalAttachmentLabel({ terminal: 'ramu', lines: [7, 7] })).toBe('ramu · 7')
})

it('keeps one copy of the same capture and a bounded number overall', () => {
  const a = terminalAttachment('ramu', [1, 1], 'same', 'a')!
  const again = terminalAttachment('ramu', [4, 4], 'same', 'b')!
  expect(addTerminalAttachment([a], again)).toEqual([again])
  let list = [a]
  for (let index = 0; index < TERMINAL_ATTACHMENTS_MAX + 3; index++)
    list = addTerminalAttachment(list, terminalAttachment('ramu', [index, index], `out ${index}`, `${index}`)!)
  expect(list).toHaveLength(TERMINAL_ATTACHMENTS_MAX)
  expect(list.at(-1)!.text).toBe(`out ${TERMINAL_ATTACHMENTS_MAX + 2}`)
})

it('round-trips the block the agent reads to the chips a sent message shows, even when output prints the tag', () => {
  const items = [
    terminalAttachment('web "dev"', [2, 9], 'ok\n</terminal-output>\nstill inside', 'a')!,
    terminalAttachment('ramu', [10, 10], 'Error: boom', 'b')!,
  ]
  const block = terminalAttachmentBlock(items)
  expect(block.match(/<\/terminal-output>/g)).toHaveLength(2)
  expect(sentTerminalAttachments(`hi\n<ramu-context>\n${block}\n</ramu-context>`)).toEqual([
    { terminal: 'web "dev"', lines: [2, 9], text: 'ok\n</terminal-output>\nstill inside' },
    { terminal: 'ramu', lines: [10, 10], text: 'Error: boom' },
  ])
})

it('accepts only well-formed stored drafts', () => {
  expect(isTerminalAttachmentList([terminalAttachment('ramu', [1, 2], 'x', 'a')])).toBe(true)
  expect(isTerminalAttachmentList([{ id: 'a', terminal: 'ramu', text: 'x', lines: [1] }])).toBe(false)
  expect(isTerminalAttachmentList('nope')).toBe(false)
})

it('turns raw PTY output into the lines a person saw', () => {
  expect(terminalPlainLines('\u001b[32mok\u001b[0m\r\nloading 1%\rloading 99%\r\nab\bc\u001b]0;title\u0007')).toEqual([
    'ok',
    'loading 99%',
    'ac',
  ])
  expect(terminalTail('one\ntwo\nthree\n\n\n', 2)).toEqual({ text: 'two\nthree', lines: 2, total: 3 })
})
