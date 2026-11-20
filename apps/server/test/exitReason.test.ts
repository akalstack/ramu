import { PassThrough } from 'node:stream'
import { expect, it } from 'vitest'
import { exitReason, recordOutput } from '../src/providers/exitReason'

it('explains an illegal instruction as a processor that is too old, not "exited (signal)"', () => {
  for (const [code, signal] of [
    [null, 'SIGILL'],
    [132, null],
  ] as const)
    expect(exitReason('OpenCode', code, signal, 'Illegal instruction', 'darwin')).toMatch(
      /OpenCode crashed with an illegal instruction.*older Intel Macs lack AVX2.*Last output: Illegal instruction/,
    )
})
it('names the signal for a kill or a crash and the code for a plain exit', () => {
  expect(exitReason('Codex', null, 'SIGKILL', '', 'darwin')).toMatch(/stopped by the system.*macOS/)
  expect(exitReason('Codex', null, 'SIGKILL', '', 'linux')).toMatch(/out of memory/)
  expect(exitReason('Codex', null, 'SIGSEGV')).toBe('Codex crashed (SIGSEGV).')
  expect(exitReason('Codex', null, 'SIGTERM')).toBe('Codex was stopped (SIGTERM).')
  expect(exitReason('Codex', 2, null, 'bad flag')).toBe('Codex exited (2). Last output: bad flag')
})
it('keeps only the last line of recent stderr', () => {
  const stream = new PassThrough(),
    output = recordOutput(stream, 50)
  expect(output.last()).toBe('')
  stream.write('first line\nsecond line\n')
  stream.write('x'.repeat(300))
  expect(output.last()).toBe('x'.repeat(50))
  stream.write('\nlast words\n')
  expect(output.last()).toBe('last words')
})
