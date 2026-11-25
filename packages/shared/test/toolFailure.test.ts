import { expect, it } from 'vitest'
import { toolFailure } from '../src/chat/toolFailure'

it('names the exit code and keeps the last lines of the output', () => {
  expect(toolFailure('Exit code 2\nline one\n\nline two\nline three\nerror: not found')).toEqual({
    exit: '2',
    lines: ['line two', 'line three', 'error: not found'],
  })
})

it('removes terminal colours and shortens a very long line', () => {
  const failure = toolFailure(`\u001b[31mfailed\u001b[0m\n${'x'.repeat(400)}`)
  expect(failure.lines[0]).toBe('failed')
  expect(failure.lines[1]).toHaveLength(240)
  expect(failure.lines[1]!.endsWith('…')).toBe(true)
})

it('gives no lines for empty output', () => {
  expect(toolFailure(undefined)).toEqual({ lines: [] })
  expect(toolFailure('Exit code 1\n')).toEqual({ exit: '1', lines: [] })
})
