import { expect, it } from 'vitest'
import type { ProcessRoot } from '@ramu/shared/resources'
import { ServerService } from '../src/background/servers'

const command: ProcessRoot = { pid: 20, taskId: 't1', item: { kind: 'command', id: 'c1', name: 'npm run dev' } }

function service(roots: () => ProcessRoot[]) {
  return new ServerService(roots, {
    listening: async () => [
      { pid: 21, port: 5173, process: 'node', host: '127.0.0.1' },
      { pid: 77, port: 5037, process: 'adb', host: '127.0.0.1' },
    ],
    processes: async () => [
      { pid: 20, ppid: 1, rssBytes: 0, cpu: 0 },
      { pid: 21, ppid: 20, rssBytes: 0, cpu: 0 },
      { pid: 77, ppid: 1, rssBytes: 0, cpu: 0 },
    ],
    environment: async () => new Map(),
    answersHttp: async ({ port }) => port === 5173,
  })
}

it('lists a thread’s servers with whether they serve pages, and ignores servers nobody in Ramu started', async () => {
  const servers = await service(() => [command]).list('t1')
  expect(servers).toEqual([
    {
      taskId: 't1',
      port: 5173,
      pid: 21,
      host: '127.0.0.1',
      process: 'node',
      owner: command.item,
      orphaned: false,
      web: true,
    },
  ])
  expect(await service(() => [command]).list('other')).toEqual([])
})

it('refuses to stop a process that is not one of the thread’s servers', async () => {
  const servers = service(() => [command])
  await expect(servers.stop('t1', 77, 5037)).rejects.toThrow('not one this thread started')
  await expect(servers.stop('t2', 21, 5173)).rejects.toThrow('not one this thread started')
})
