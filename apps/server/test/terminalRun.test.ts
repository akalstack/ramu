import { expect, it, vi } from 'vitest'
import type { TerminalInfo } from '@ramu/shared/api'
import { registerTerminalHandlers } from '../src/ipc/handlers/terminals'

const shell = (id: string, extra: Partial<TerminalInfo> = {}) => ({ id, exited: false, ...extra }) as TerminalInfo

function setup(list: TerminalInfo[], busy: string[] = []) {
  const terminals = {
    list: vi.fn(() => list),
    busy: vi.fn((id: string) => busy.includes(id)),
    open: vi.fn(() => shell('new')),
    write: vi.fn(),
  }
  const methods = registerTerminalHandlers({
    terminals,
    workspace: { agentScope: () => ({ cwd: '/work/shop' }) },
  } as never) as Record<string, { run: (...args: never[]) => unknown }>
  const run = (command: string) =>
    (methods['term.run']!.run as (ctx: string, c: string) => TerminalInfo)('project:p1', command)
  return { terminals, run }
}

it('types into the newest shell that is not running anything', () => {
  const { terminals, run } = setup(
    [shell('old'), shell('newer'), shell('bg', { background: true }), shell('gone', { exited: true })],
    ['newer'],
  )
  expect(run('vercel login').id).toBe('old')
  expect(terminals.write).toHaveBeenCalledWith('old', 'vercel login\r')
  expect(terminals.open).not.toHaveBeenCalled()
})

it('opens a shell in the workspace folder when every one is busy, and types each line', () => {
  const { terminals, run } = setup([shell('busy')], ['busy'])
  expect(run('npm install\nnpm run dev').id).toBe('new')
  expect(terminals.open).toHaveBeenCalledWith('project:p1', null, '/work/shop', 120, 32)
  expect(terminals.write).toHaveBeenCalledWith('new', 'npm install\rnpm run dev\r')
})
