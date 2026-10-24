import { mkdirSync, mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { AcpTerminalHost, type AcpTerminalService } from '../src/providers/acpTerminals'

const fake = () => {
  const calls: unknown[][] = []
  let state: 'running' | 'exited' = 'running'
  const info = (id: string) =>
    ({ id, state, exitCode: state === 'exited' ? 0 : null, cursor: 5, output: 'hello' }) as any
  const service: AcpTerminalService = {
    launchBackground: (...args) => (calls.push(['launch', ...args]), info('t1')),
    inspectBackground: (_task, id) => info(id),
    stopBackground: (_task, id) => (calls.push(['stop', id]), info(id)),
  }
  return { service, calls, finish: () => (state = 'exited') }
}
const scope = { taskId: 'a', repoId: null, cwd: '/work/repo' }

it('creates a managed command in the checkout and quotes arguments', async () => {
  const { service, calls } = fake()
  const host = new AcpTerminalHost(service, scope)
  expect(await host.handle('terminal/create', { command: 'npm', args: ['run', "it's"], cwd: 'app' })).toEqual({
    terminalId: 't1',
  })
  expect(calls[0]).toEqual(['launch', 'a', null, '/work/repo/app', `'npm' 'run' 'it'\\''s'`])
})

it('refuses a directory outside the checkout and unknown terminals', async () => {
  const host = new AcpTerminalHost(fake().service, scope)
  await expect(host.handle('terminal/create', { command: 'ls', cwd: '../other' })).rejects.toThrow('checkout')
  await expect(host.handle('terminal/create', { command: 'ls', cwd: '/etc' })).rejects.toThrow('checkout')
  await expect(host.handle('terminal/output', { terminalId: 'foreign' })).rejects.toThrow('Unknown terminal')
})

it('reports output with an exit status only after the command ends', async () => {
  const { service, finish } = fake()
  const host = new AcpTerminalHost(service, scope)
  await host.handle('terminal/create', { command: 'sleep 1' })
  expect((await host.handle('terminal/output', { terminalId: 't1' })).exitStatus).toBeUndefined()
  const waiting = host.handle('terminal/wait_for_exit', { terminalId: 't1' })
  finish()
  expect(await waiting).toEqual({ exitCode: 0, signal: null })
  expect(await host.handle('terminal/output', { terminalId: 't1', outputByteLimit: 2 })).toMatchObject({
    output: 'lo',
    truncated: true,
  })
})

it('kill and release ask for a graceful stop; release forgets the terminal', async () => {
  const { service, calls } = fake()
  const host = new AcpTerminalHost(service, scope)
  await host.handle('terminal/create', { command: 'sleep 9' })
  await host.handle('terminal/kill', { terminalId: 't1' })
  await host.handle('terminal/release', { terminalId: 't1' })
  expect(calls.filter((c) => c[0] === 'stop')).toHaveLength(2)
  await expect(host.handle('terminal/output', { terminalId: 't1' })).rejects.toThrow('Unknown terminal')
})

it('keeps a shared command alive until the last terminal using it is released', async () => {
  const { service, calls } = fake()
  const host = new AcpTerminalHost(service, scope)
  await host.handle('terminal/create', { command: 'npm test' })
  await host.handle('terminal/create', { command: 'npm test' })
  await host.handle('terminal/release', { terminalId: 't1' })
  expect(calls.filter((c) => c[0] === 'stop')).toHaveLength(0)
  await host.handle('terminal/output', { terminalId: 't1' })
  await host.handle('terminal/release', { terminalId: 't1' })
  expect(calls.filter((c) => c[0] === 'stop')).toHaveLength(1)
})

it('stops waiting for an exit when the session is disposed', async () => {
  const { service } = fake()
  const host = new AcpTerminalHost(service, scope)
  await host.handle('terminal/create', { command: 'sleep 9' })
  const waiting = host.handle('terminal/wait_for_exit', { terminalId: 't1' })
  host.dispose()
  await expect(waiting).rejects.toThrow('Cancelled')
})

it('allows folders that merely start with dots and refuses a link that leaves the checkout', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acp-term-'))
  const outside = mkdtempSync(join(tmpdir(), 'acp-out-'))
  mkdirSync(join(dir, '..cache'))
  symlinkSync(outside, join(dir, 'escape'))
  const { service } = fake()
  const host = new AcpTerminalHost(service, { taskId: 'a', repoId: null, cwd: dir })
  await expect(host.handle('terminal/create', { command: 'ls', cwd: '..cache' })).resolves.toBeDefined()
  await expect(host.handle('terminal/create', { command: 'ls', cwd: 'escape' })).rejects.toThrow('checkout')
})
