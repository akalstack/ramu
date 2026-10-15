import { expect, it, vi } from 'vitest'
const callbacks = vi.hoisted(() => ({ data: (_data: string) => {}, exit: (_value: { exitCode: number }) => {} }))
vi.mock('node-pty', () => ({ spawn: () => ({ onData: (cb: typeof callbacks.data) => { callbacks.data = cb }, onExit: (cb: typeof callbacks.exit) => { callbacks.exit = cb }, write: vi.fn(), resize: vi.fn(), kill: vi.fn(), process: 'zsh' }) }))
import { TerminalService } from '../src/pty'
it('terminals reattach with bounded output and a cursor that includes missed chunks', () => {
  const chunks: number[] = []
  const service = new TerminalService((_id, _data, cursor) => chunks.push(cursor), () => {})
  const terminal = service.open('task', null, '/tmp')
  callbacks.data('hello'); callbacks.data('x'.repeat(300_000))
  expect(chunks).toEqual([5, 300_005])
  expect(service.list('task')).toEqual([terminal])
  expect(service.list('another')).toEqual([])
  expect(service.snapshot(terminal.id)).toEqual({ output: 'x'.repeat(256_000), cursor: 300_005, exited: false })
  callbacks.exit({ exitCode: 0 }); expect(service.snapshot(terminal.id).exited).toBe(true)
  service.close(terminal.id); expect(service.list('task')).toEqual([])
})
