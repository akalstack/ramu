// What Ramu's work uses on a host. Pure parsing and attribution, so the service stays a thin reader and tests need no `ps`.
import { processOwners } from './servers'

export interface HostMemory {
  totalBytes: number
  availableBytes: number
}

export interface ResourceItem {
  kind: 'agent' | 'terminal' | 'command' | 'device'
  id: string
  /** A name the thread already uses; never a command line. */
  name: string
  rssBytes: number
}

export interface ThreadResources {
  taskId: string
  rssBytes: number
  /** Percent of one core, summed over the thread's processes. */
  cpu: number
  items: ResourceItem[]
}

export interface ResourceSnapshot {
  memory: HostMemory | null
  threads: ThreadResources[]
  /** The service and whatever it started that belongs to no thread. */
  ramuBytes: number
  /** Logical cores, so CPU reads as a share of the whole host. */
  cores?: number
  /** Every process's CPU added up, in `ps` percent (100 per busy core): the whole host, not only Ramu. */
  hostCpu?: number
  /** The service's own processes' CPU, outside any thread. */
  ramuCpu?: number
}

/** What the Brief needs from a host that is low on memory; the idle figures are read only while it is low. */
export interface LowMemory {
  availableBytes: number
  idleThreads: string[]
  idleBytes: number
}

export interface HostResources {
  memory: HostMemory | null
  low: LowMemory | null
  /** `process.platform` and `process.arch`, reported as facts; Ramu detects no other capability. */
  platform?: string
  arch?: string
  /** What the person wrote about this host. */
  description?: string
  /** Test device platforms ready on this host. */
  testDevices?: ('ios' | 'android')[]
}

export interface ProcessRow {
  pid: number
  ppid: number
  rssBytes: number
  cpu: number
}

export interface ProcessRoot {
  pid: number
  taskId: string
  item: Omit<ResourceItem, 'rssBytes'>
}

/** Rows of `ps -axo pid=,ppid=,rss=,pcpu=`; anything else is skipped rather than guessed at. */
export function parseProcessTable(text: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+([\d.,]+)\s*$/.exec(line)
    if (!match) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssBytes: Number(match[3]) * 1024,
      cpu: Number(match[4]!.replace(',', '.')),
    })
  }
  return rows
}

/** Linux: `MemAvailable` already allows for reclaimable cache, which `MemFree` does not. */
export function parseMeminfo(text: string): HostMemory | null {
  const value = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+) kB`, 'm').exec(text)?.[1] ?? 0) * 1024
  const totalBytes = value('MemTotal')
  const availableBytes = value('MemAvailable')
  return totalBytes && availableBytes ? { totalBytes, availableBytes } : null
}

/**
 * macOS memory as Activity Monitor counts it: used is app memory (anonymous pages less purgeable ones), wired memory and
 * what the compressor occupies; cached files and free pages are available. `memory_pressure`'s free percentage is a
 * pressure gauge, not this, and read gigabytes lower than Activity Monitor shows.
 */
export function parseVmStat(text: string, totalBytes: number): HostMemory | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1])
  const pages = (label: string) => {
    const value = new RegExp(`^${label}:\\s+(\\d+)`, 'm').exec(text)?.[1]
    return value === undefined ? null : Number(value)
  }
  const anonymous = pages('Anonymous pages')
  const purgeable = pages('Pages purgeable') ?? 0
  const wired = pages('Pages wired down')
  const compressed = pages('Pages occupied by compressor') ?? 0
  if (!pageSize || !totalBytes || anonymous === null || wired === null) return null
  const used = (Math.max(0, anonymous - purgeable) + wired + compressed) * pageSize
  return { totalBytes, availableBytes: Math.max(0, totalBytes - Math.min(used, totalBytes)) }
}

const GB = 1024 ** 3

/** Low means under a tenth of the host, capped so a very large host is not called low with gigabytes to spare. */
export const isLowMemory = ({ totalBytes, availableBytes }: HostMemory) =>
  availableBytes < Math.min(totalBytes * 0.1, 2 * GB)

/**
 * Gives each process to one owner: roots claim their descendants in order, and whatever remains under the service is
 * Ramu's own, so nothing is counted twice and nothing the service started goes missing.
 */
export function attributeProcesses(rows: ProcessRow[], servicePid: number, roots: ProcessRoot[]) {
  const owners = processOwners(rows, roots)
  const threads = new Map<string, ThreadResources>()
  const items = new Map<ProcessRoot, ResourceItem>()
  for (const row of rows) {
    const root = owners.get(row.pid)
    if (!root) continue
    const thread = threads.get(root.taskId) ?? { taskId: root.taskId, rssBytes: 0, cpu: 0, items: [] }
    thread.rssBytes += row.rssBytes
    thread.cpu += row.cpu
    let item = items.get(root)
    if (!item) {
      item = { ...root.item, rssBytes: 0 }
      items.set(root, item)
      thread.items.push(item)
    }
    item.rssBytes += row.rssBytes
    threads.set(root.taskId, thread)
  }
  // Whatever remains under the service is Ramu's own.
  const service = processOwners(
    rows.filter((row) => !owners.has(row.pid)),
    [{ pid: servicePid, taskId: '', item: { kind: 'agent', id: '', name: '' } }],
  )
  const ramuBytes = rows.reduce((sum, row) => sum + (service.has(row.pid) ? row.rssBytes : 0), 0)
  for (const thread of threads.values()) thread.items.sort((a, b) => b.rssBytes - a.rssBytes)
  const ramuCpu = rows.reduce((sum, row) => sum + (service.has(row.pid) ? row.cpu : 0), 0)
  const hostCpu = rows.reduce((sum, row) => sum + row.cpu, 0)
  return { threads: [...threads.values()].sort((a, b) => b.rssBytes - a.rssBytes), ramuBytes, ramuCpu, hostCpu }
}

/** A thread above one full core reads as busy; instant percentages under that are mostly noise. */
export const isBusy = (thread: Pick<ThreadResources, 'cpu'>) => thread.cpu > 100

export const gigabytes = (bytes: number) => {
  const value = bytes / GB
  return value >= 10 ? value.toFixed(0) : value.toFixed(1)
}

export type ThreadActivity = 'working' | 'idle' | 'left-running'

/** Terminals and commands still alive under finished or archived work get a label, so forgotten dev servers are found. */
export function threadActivity(
  task: { status: string; doneAt?: number | null } | undefined,
  thread: Pick<ThreadResources, 'items'>,
): ThreadActivity {
  if (task?.status === 'running' || task?.status === 'needs-input') return 'working'
  const finished = !task || !!task.doneAt || task.status === 'archived'
  return finished && thread.items.some((item) => item.kind !== 'agent') ? 'left-running' : 'idle'
}

/** The method and arguments that stop one item through its usual path; the host resolves the target from its records. */
export const stopItemCall = (taskId: string, item: Pick<ResourceItem, 'kind' | 'id'>) =>
  item.kind === 'agent'
    ? (['agent.stop', item.id] as const)
    : item.kind === 'device'
      ? (['testDevices.stop', item.id] as const)
      : item.kind === 'terminal'
        ? (['term.close', item.id] as const)
        : (['term.background.stop', taskId, item.id] as const)

export interface MemoryBreakdown {
  threads: number
  ramu: number
  /** Everything else on the host: other apps and the system. */
  other: number
  free: number
}

/** The host's memory split for a bar: Ramu's threads, Ramu itself, everything else, and what is available. */
export function memoryBreakdown(memory: HostMemory, threadBytes: number, ramuBytes: number): MemoryBreakdown {
  const used = Math.max(0, memory.totalBytes - memory.availableBytes)
  // Resident sizes count shared pages more than once, so Ramu's part never exceeds what the host says is used.
  const threads = Math.min(threadBytes, used)
  const ramu = Math.min(ramuBytes, used - threads)
  return { threads, ramu, other: used - threads - ramu, free: memory.totalBytes - used }
}

/** CPU as a share of the whole host (0–1), from a percent of one core summed over processes. */
export const cpuShare = (cpu: number, cores = 1) => Math.min(1, Math.max(0, cpu / (100 * Math.max(1, cores))))
