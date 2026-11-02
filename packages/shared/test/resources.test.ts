import { expect, it } from 'vitest'
import {
  attributeProcesses,
  gigabytes,
  isLowMemory,
  parseMeminfo,
  parseMemoryPressure,
  parseProcessTable,
  stopItemCall,
  threadActivity,
} from '../src/resources'

const KB = 1024

it('reads the process table and skips anything else', () => {
  expect(parseProcessTable('  10  1 2048 12,5\nnoise\n 11 10 1024 0.0\n')).toEqual([
    { pid: 10, ppid: 1, rssBytes: 2048 * KB, cpu: 12.5 },
    { pid: 11, ppid: 10, rssBytes: 1024 * KB, cpu: 0 },
  ])
})

it('reads host memory and refuses to guess', () => {
  expect(parseMeminfo('MemTotal:  1000 kB\nMemFree: 1 kB\nMemAvailable:  400 kB\n')).toEqual({
    totalBytes: 1000 * KB,
    availableBytes: 400 * KB,
  })
  expect(parseMeminfo('MemTotal: 1000 kB\n')).toBeNull()
  expect(parseMemoryPressure('System-wide memory free percentage: 35%', 1000)).toEqual({
    totalBytes: 1000,
    availableBytes: 350,
  })
  expect(parseMemoryPressure('nothing', 1000)).toBeNull()
})

it('counts each process once, and leaves unowned descendants with Ramu', () => {
  const row = (pid: number, ppid: number, rssBytes: number, cpu = 0) => ({ pid, ppid, rssBytes, cpu })
  const rows = [
    row(1, 0, 1),
    row(100, 1, 10),
    row(200, 100, 20, 80),
    row(201, 200, 30, 40),
    row(202, 100, 5),
    row(300, 200, 40),
    row(999, 1, 500),
  ]
  const root = (pid: number, taskId: string, id: string) => ({
    pid,
    taskId,
    item: { kind: 'agent' as const, id, name: id },
  })
  const result = attributeProcesses(rows, 100, [
    root(200, 'a', 'agent'),
    root(300, 'a', 'inner'),
    root(404, 'b', 'gone'),
  ])
  expect(result.ramuBytes).toBe(15)
  expect(result.threads).toHaveLength(1)
  expect(result.threads[0]).toMatchObject({ taskId: 'a', rssBytes: 90, cpu: 120 })
  expect(result.threads[0]!.items.map((item) => [item.id, item.rssBytes])).toEqual([
    ['agent', 50],
    ['inner', 40],
  ])
})

it('judges low memory against the host, capped on large machines', () => {
  const gb = 1024 ** 3
  expect(isLowMemory({ totalBytes: 16 * gb, availableBytes: gb })).toBe(true)
  expect(isLowMemory({ totalBytes: 16 * gb, availableBytes: 4 * gb })).toBe(false)
  expect(isLowMemory({ totalBytes: 128 * gb, availableBytes: 3 * gb })).toBe(false)
  expect(gigabytes(12.4 * gb)).toBe('12')
  expect(gigabytes(1.25 * gb)).toBe('1.3')
})

it('labels commands left running under finished work, and stops each kind its own way', () => {
  const items = [{ kind: 'command' as const, id: 'c', name: 'pnpm dev', rssBytes: 1 }]
  expect(threadActivity({ status: 'running' }, { items })).toBe('working')
  expect(threadActivity({ status: 'archived' }, { items })).toBe('left-running')
  expect(threadActivity({ status: 'idle', doneAt: 1 }, { items })).toBe('left-running')
  expect(threadActivity({ status: 'idle' }, { items })).toBe('idle')
  expect(stopItemCall('t', { kind: 'agent', id: 's' })).toEqual(['agent.stop', 's'])
  expect(stopItemCall('t', { kind: 'terminal', id: 'x' })).toEqual(['term.close', 'x'])
  expect(stopItemCall('t', { kind: 'command', id: 'c' })).toEqual(['term.background.stop', 't', 'c'])
})
