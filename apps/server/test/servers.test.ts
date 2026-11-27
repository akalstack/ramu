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
    daemons: async () => [],
    cpuTimes: async () => new Map(),
    sampleMs: 0,
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

it('stops only idle build daemons, listening or not, and leaves one in the middle of a build for the next look', async () => {
  const { spawn } = await import('node:child_process')
  // Real processes, so stopping them is real: a Gradle daemon on a port, an Nx daemon on a local socket, and a Kotlin
  // daemon that is compiling.
  const gradle = spawn('sleep', ['30'])
  const nx = spawn('sleep', ['30'])
  const kotlin = spawn('sleep', ['30'])
  const devServer = spawn('sleep', ['30'])
  const agent: ProcessRoot = { pid: 10, taskId: 't1', item: { kind: 'agent', id: 's1', name: 'Agent' } }
  let compiled = 0
  const servers = new ServerService(() => [agent], {
    listening: async () =>
      [gradle, devServer]
        .filter((child) => child.exitCode === null && child.signalCode === null)
        .map((child) => ({
          pid: child.pid!,
          port: child === gradle ? 17038 : 3000,
          process: child === gradle ? 'java' : 'node',
          host: '127.0.0.1' as const,
        })),
    processes: async () => [{ pid: 10, ppid: 1, rssBytes: 0, cpu: 0 }],
    detached: async (pids) => ({
      owners: new Map(pids.map((pid) => [pid, 's1'])),
      daemons: new Map([[gradle.pid!, 'Gradle daemon']]),
    }),
    answersHttp: async () => true,
    daemons: async () => [
      { pid: gradle.pid!, daemon: 'Gradle daemon', owner: 's1', cpu: 5 },
      { pid: nx.pid!, daemon: 'Nx daemon', owner: 's1', cpu: 1 },
      { pid: kotlin.pid!, daemon: 'Kotlin daemon', owner: 's1', cpu: 40 },
      // Another thread's, which this one never touches.
      { pid: process.pid, daemon: 'Gradle daemon', owner: 'other', cpu: 0 },
    ],
    // The Kotlin daemon keeps compiling while it is watched.
    cpuTimes: async (pids) =>
      new Map(pids.map((pid) => [pid, pid === kotlin.pid ? 40 + ++compiled * 3 : pid === gradle.pid ? 5 : 1])),
    sampleMs: 10,
  })
  const listed = await servers.list('t1')
  expect(listed.find((server) => server.pid === gradle.pid)).toMatchObject({ daemon: 'Gradle daemon', web: false })
  expect(await servers.stopDaemons('t1')).toEqual({ stopped: 2, busy: 1 })
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect([gradle.signalCode, nx.signalCode]).toEqual(['SIGTERM', 'SIGTERM'])
  expect(kotlin.signalCode).toBeNull()
  // The dev server may be open in a browser: only marking the thread done stops it, with the busy daemon.
  expect(devServer.signalCode).toBeNull()
  await servers.release('t1')
  await new Promise((resolve) => setTimeout(resolve, 200))
  expect([devServer.signalCode, kotlin.signalCode]).toEqual(['SIGTERM', 'SIGTERM'])
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
