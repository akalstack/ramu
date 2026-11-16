import { expect, it } from 'vitest'
import {
  cpuPercent,
  cpuShare,
  leftoverLabel,
  memorySize,
  memoryBreakdown,
  attributeProcesses,
  gigabytes,
  isLowMemory,
  parseMeminfo,
  parseVmStat,
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
  // Activity Monitor's Memory Used: app memory (anonymous less purgeable), wired and compressed; the rest is available.
  const vm = [
    'Mach Virtual Memory Statistics: (page size of 16384 bytes)',
    'Pages free:                                    23854.',
    'Pages wired down:                             206045.',
    'Pages purgeable:                                 292.',
    'File-backed pages:                            153986.',
    'Anonymous pages:                              223084.',
    'Pages occupied by compressor:                 410412.',
  ].join('\n')
  const total = 16 * 1024 ** 3
  const used = (223084 - 292 + 206045 + 410412) * 16384
  expect(parseVmStat(vm, total)).toEqual({ totalBytes: total, availableBytes: total - used })
  expect(parseVmStat('nothing', total)).toBeNull()
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
  expect(stopItemCall('t', { kind: 'device', id: 'avd:pixel' })).toEqual(['testDevices.stop', 'avd:pixel'])
})

it('splits host memory for the bar without letting Ramu exceed what is used', () => {
  const memory = { totalBytes: 16, availableBytes: 6 }
  expect(memoryBreakdown(memory, 3, 1)).toEqual({ threads: 3, ramu: 1, other: 6, free: 6 })
  expect(memoryBreakdown(memory, 12, 4)).toEqual({ threads: 10, ramu: 0, other: 0, free: 6 })
})

it('reads CPU as a share of the whole host', () => {
  expect(cpuShare(200, 8)).toBe(0.25)
  expect(cpuShare(1200, 8)).toBe(1)
  expect(cpuShare(50)).toBe(0.5)
})

it('gives memory a unit, in megabytes under a gigabyte', () => {
  expect(memorySize(40 * 1024 * 1024)).toBe('40 MB')
  expect(memorySize(1.5 * 1024 ** 3)).toBe('1.5 GB')
  expect(memorySize(11.4 * 1024 ** 3)).toBe('11 GB')
})

it("puts a row's CPU on the same whole-host scale as the bar", () => {
  expect(cpuPercent(8, 8)).toBe('1%')
  expect(cpuPercent(3, 8)).toBe('0%')
  expect(cpuPercent(400, 8)).toBe('50%')
})

it('names what a thread without a title still runs', () => {
  const item = (kind: 'agent' | 'terminal' | 'command', name: string) => ({ kind, id: name, name, rssBytes: 0 })
  expect(leftoverLabel({ items: [item('agent', 'a'), item('command', 'dev'), item('terminal', 'Terminal')] })).toBe(
    'dev, Terminal',
  )
  expect(leftoverLabel({ items: ['a', 'b', 'c', 'd'].map((name) => item('command', name)) })).toBe('a, b +2')
  expect(leftoverLabel({ items: [item('agent', 'a')] })).toBeNull()
})
