import { expect, it } from 'vitest'
import { commandLine } from '../src/chat/commandLine'

it('names a command by its first line, so a long script reads as one line in the chat', () => {
  expect(commandLine('pnpm test')).toBe('pnpm test')
  // A many-line program: its first line, and an ellipsis saying there is more.
  expect(commandLine('pnpm -s lapor > /tmp/out.json; python3 -c "\nimport json\nprint(1)\n"')).toBe(
    'pnpm -s lapor > /tmp/out.json; python3 -c " …',
  )
  // One very long line is cut at the limit.
  const long = `echo ${'x'.repeat(200)}`
  expect(commandLine(long)).toHaveLength(80)
  expect(commandLine(long).endsWith('…')).toBe(true)
  // Blank leading lines are skipped.
  expect(commandLine('\n\n  ls -la  \n')).toBe('ls -la')
})
