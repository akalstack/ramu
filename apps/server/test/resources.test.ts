import { expect, it, vi } from 'vitest'
import { ResourceService } from '../src/background/resources'
import { viewerMayInvoke } from '@ramu/shared/viewerAccess'
import { idleAgents, lowMemoryDetail } from '@ramu/shared/resources'
import { deviceMayInvoke, HOST_METHODS } from '../src/remote/access'

const gb = 1024 ** 3
const sources = (idle: string[] = []) => ({ roots: () => [], idleThreads: () => new Set(idle) })

it('shares one read between callers and skips ps until someone looks', async () => {
  const table = vi.fn(async () => [])
  const service = new ResourceService(sources(), async () => null, table)
  await service.check()
  expect(table).not.toHaveBeenCalled()
  await Promise.all([service.snapshot(), service.snapshot()])
  await service.snapshot()
  expect(table).toHaveBeenCalledTimes(1)
})

it('calls a host low only after two checks, and clears on recovery', async () => {
  let availableBytes = 0.5 * gb
  const service = new ResourceService(
    sources(),
    async () => ({ totalBytes: 16 * gb, availableBytes }),
    async () => [],
  )
  await service.check()
  expect(service.host().low).toBeNull()
  await service.check()
  expect(service.host().low).toMatchObject({ availableBytes: 0.5 * gb, idleThreads: [] })
  availableBytes = 8 * gb
  await service.check()
  expect(service.host().low).toBeNull()
})

it('keeps process figures from viewers and paired hosts', () => {
  expect(viewerMayInvoke('resources.snapshot')).toBe(false)
  expect(viewerMayInvoke('resources.host')).toBe(false)
  expect(HOST_METHODS.has('resources.snapshot')).toBe(false)
})

it('keeps terminal thread methods to this host’s own socket', () => {
  const owner = { id: 'phone', kind: 'device', role: 'owner' } as never
  const host = { id: 'vps', kind: 'host' } as never
  expect(deviceMayInvoke(owner, 'terminalThreads.start')).toBe(false)
  expect(deviceMayInvoke(host, 'terminalThreads.start')).toBe(false)
  expect(deviceMayInvoke(owner, 'threads.continueHere')).toBe(true)
  expect(deviceMayInvoke(host, 'threads.continueHere')).toBe(false)
})

it('refuses writing tools to a read-only reviewer, even with full access', async () => {
  const { createCanUseTool } = await import('../src/agent/permissions')
  const canUse = createCanUseTool({
    settings: { provider: 'claude-code', model: '', effort: null, access: 'full', autoFallback: false },
    pending: new Map(),
    record: () => {},
    setState: () => {},
    readOnly: true,
  })
  const signal = new AbortController().signal
  await expect(canUse('Edit', { file_path: 'a' }, { signal, toolUseID: 't' } as never)).resolves.toMatchObject({
    behavior: 'deny',
  })
  await expect(canUse('Bash', { command: 'rm -rf x' }, { signal, toolUseID: 't' } as never)).resolves.toMatchObject({
    behavior: 'deny',
  })
})

it('marks each thread idle as of now, even from a cached reading, and counts only idle agents as freed', async () => {
  const idle = new Set(['a'])
  const roots = [
    { pid: 10, taskId: 'a', item: { kind: 'agent' as const, id: 's-a', name: 'A' } },
    { pid: 11, taskId: 'a', item: { kind: 'terminal' as const, id: 't-a', name: 'dev server' } },
    { pid: 20, taskId: 'b', item: { kind: 'agent' as const, id: 's-b', name: 'B' } },
  ]
  const rows = [
    { pid: 10, ppid: process.pid, rssBytes: 300, cpu: 0 },
    { pid: 11, ppid: process.pid, rssBytes: 900, cpu: 0 },
    { pid: 20, ppid: process.pid, rssBytes: 500, cpu: 5 },
  ]
  const service = new ResourceService(
    { roots: () => roots, idleThreads: () => idle },
    async () => null,
    async () => rows,
  )
  const first = await service.snapshot()
  expect(Object.fromEntries(first.threads.map((thread) => [thread.taskId, thread.idle]))).toEqual({ a: true, b: false })
  // The terminal's memory stays: stopping idle agents leaves servers and terminals running.
  expect(idleAgents(first.threads)).toEqual({ taskIds: ['a'], bytes: 300 })
  // Thread a started a turn after the reading was taken.
  idle.clear()
  expect(idleAgents((await service.snapshot()).threads).taskIds).toEqual([])
})

it('stops idle agents on its own only while low, only of threads idle a while, and says what it freed', async () => {
  let availableBytes = 0.5 * gb
  let running = new Set(['a', 'b'])
  const idleFor: Record<string, number> = { a: 30 * 60_000, b: 60_000 }
  const stopAgents = vi.fn(async (taskIds: string[]) => {
    running = new Set([...running].filter((id) => !taskIds.includes(id)))
  })
  const service = new ResourceService(
    {
      roots: () =>
        [...running].map((taskId, index) => ({
          pid: 10 + index,
          taskId,
          item: { kind: 'agent' as const, id: `s-${taskId}`, name: taskId },
        })),
      idleThreads: () => new Set(['a', 'b']),
      idleFor: (taskId) => idleFor[taskId] ?? 0,
      stopAgents,
    },
    async () => ({ totalBytes: 16 * gb, availableBytes }),
    async () => [...running].map((taskId, index) => ({ pid: 10 + index, ppid: process.pid, rssBytes: gb, cpu: 0 })),
  )
  // One low minute is not enough.
  await service.check()
  expect(stopAgents).not.toHaveBeenCalled()
  await service.check()
  // Only a, idle half an hour; b moved a minute ago and may be read right now.
  expect(stopAgents).toHaveBeenCalledExactlyOnceWith(['a'])
  const low = service.host().low!
  expect(low.stopped).toMatchObject({ threads: 1, bytes: gb })
  expect(low.idleThreads).toEqual(['b'])
  expect(lowMemoryDetail(low).map((line) => line.text)).toEqual([
    'Stopped {0} idle agents, freeing {1} GB',
    '{0} idle threads use {1} GB',
  ])
  // Plenty free again: nothing more is stopped and the row goes.
  availableBytes = 8 * gb
  await service.check()
  expect(service.host().low).toBeNull()
  expect(stopAgents).toHaveBeenCalledTimes(1)
})
