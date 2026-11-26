import { describe, expect, it } from 'vitest'
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

describe('answersHttp', () => {
  const listen = async (status: number) => {
    const { createServer } = await import('node:http')
    const server = createServer((_req, res) => res.writeHead(status).end())
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as { port: number }).port
    return { port, close: () => new Promise((resolve) => server.close(resolve)) }
  }

  it('counts a page, and a dev server that answers 404 at its root', async () => {
    const { answersHttp } = await import('../src/background/servers')
    for (const status of [200, 302, 404]) {
      const server = await listen(status)
      expect(await answersHttp({ port: server.port, host: '127.0.0.1' })).toBe(true)
      await server.close()
    }
  })

  it('does not count a listener that asks for a credential or another protocol, or nothing listening', async () => {
    const { answersHttp } = await import('../src/background/servers')
    for (const status of [401, 403, 426]) {
      const server = await listen(status)
      expect(await answersHttp({ port: server.port, host: '127.0.0.1' })).toBe(false)
      await server.close()
    }
    const gone = await listen(200)
    await gone.close()
    expect(await answersHttp({ port: gone.port, host: '127.0.0.1' })).toBe(false)
  })
})
