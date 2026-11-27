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
    detached: async () => ({ owners: new Map(), daemons: new Map() }),
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

it('names build daemons a thread left behind and stops them alone, or with every server left behind once it is done', async () => {
  const { spawn } = await import('node:child_process')
  // Real processes, so stopping them is real: one a Gradle daemon, one a dev server started with nohup.
  const daemon = spawn('sleep', ['30'])
  const devServer = spawn('sleep', ['30'])
  const agent: ProcessRoot = { pid: 10, taskId: 't1', item: { kind: 'agent', id: 's1', name: 'Agent' } }
  const servers = new ServerService(() => [agent], {
    listening: async () =>
      [daemon, devServer]
        .filter((child) => child.exitCode === null && child.signalCode === null)
        .map((child) => ({
          pid: child.pid!,
          port: child === daemon ? 17038 : 3000,
          process: child === daemon ? 'java' : 'node',
          host: '127.0.0.1' as const,
        })),
    processes: async () => [{ pid: 10, ppid: 1, rssBytes: 0, cpu: 0 }],
    detached: async (pids) => ({
      owners: new Map(pids.map((pid) => [pid, 's1'])),
      daemons: new Map([[daemon.pid!, 'Gradle daemon']]),
    }),
    answersHttp: async () => true,
  })
  const listed = await servers.list('t1')
  expect(listed.find((server) => server.pid === daemon.pid)).toMatchObject({ daemon: 'Gradle daemon', web: false })
  expect(listed.find((server) => server.pid === devServer.pid)?.daemon).toBeUndefined()
  // Resting: only the daemon goes; the dev server may be open in a browser.
  expect(await servers.stopLeftBehind('t1')).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(daemon.signalCode).toBe('SIGTERM')
  expect(devServer.exitCode ?? devServer.signalCode).toBeNull()
  // Done: what was left behind goes too.
  expect(await servers.stopLeftBehind('t1', { all: true })).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect(devServer.signalCode).toBe('SIGTERM')
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

it('gives an agent’s builds a ten-minute daemon idle timeout, keeping the person’s Gradle options and their own timeout', async () => {
  const { daemonTimeouts, ownedEnvironment } = await import('../src/agent/processOwners')
  expect(daemonTimeouts({})).toEqual({ GRADLE_OPTS: '-Dorg.gradle.daemon.idletimeout=600000' })
  expect(daemonTimeouts({ GRADLE_OPTS: '-Xmx2g' })).toEqual({
    GRADLE_OPTS: '-Xmx2g -Dorg.gradle.daemon.idletimeout=600000',
  })
  expect(daemonTimeouts({ GRADLE_OPTS: '-Dorg.gradle.daemon.idletimeout=60000' })).toEqual({})
  // Only an agent's own environment: one with no session is Ramu's, and stays as it was.
  expect(ownedEnvironment({ PATH: '/bin' }, 's1')).toMatchObject({ RAMU_OWNER: 's1', GRADLE_OPTS: expect.any(String) })
  expect(ownedEnvironment({ PATH: '/bin' }, undefined)).toEqual({ PATH: '/bin' })
})
