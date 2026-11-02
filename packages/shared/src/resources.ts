// What Ramu's work uses on a host. Pure parsing and attribution, so the service stays a thin reader and tests need no `ps`.

export interface HostMemory {
  totalBytes: number
  availableBytes: number
}

export interface ResourceItem {
  kind: 'agent' | 'terminal' | 'command'
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

/** macOS: `memory_pressure -Q` reports the free percentage, which counts reclaimable memory that `os.freemem` leaves out. */
export function parseMemoryPressure(text: string, totalBytes: number): HostMemory | null {
  const percent = /free percentage:\s*(\d+)%/i.exec(text)?.[1]
  if (percent === undefined || !totalBytes) return null
  return { totalBytes, availableBytes: Math.round((totalBytes * Number(percent)) / 100) }
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
  const children = new Map<number, ProcessRow[]>()
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row])
  const claimed = new Set<number>()
  const claim = (pid: number) => {
    const taken: ProcessRow[] = []
    const stack = byPid.has(pid) ? [byPid.get(pid)!] : []
    while (stack.length) {
      const row = stack.pop()!
      if (claimed.has(row.pid)) continue
      claimed.add(row.pid)
      taken.push(row)
      stack.push(...(children.get(row.pid) ?? []))
    }
    return taken
  }
  const threads = new Map<string, ThreadResources>()
  // A nested root is claimed before the root above it, so a command started by an agent keeps its own line.
  const depth = (pid: number) => {
    let level = 0
    for (let row = byPid.get(pid); row && level < 64; row = byPid.get(row.ppid)) level++
    return level
  }
  for (const root of [...roots].sort((a, b) => depth(b.pid) - depth(a.pid))) {
    const taken = claim(root.pid)
    if (!taken.length) continue
    const rssBytes = taken.reduce((sum, row) => sum + row.rssBytes, 0)
    const thread = threads.get(root.taskId) ?? { taskId: root.taskId, rssBytes: 0, cpu: 0, items: [] }
    thread.rssBytes += rssBytes
    thread.cpu += taken.reduce((sum, row) => sum + row.cpu, 0)
    thread.items.push({ ...root.item, rssBytes })
    threads.set(root.taskId, thread)
  }
  const ramuBytes = claim(servicePid).reduce((sum, row) => sum + row.rssBytes, 0)
  for (const thread of threads.values()) thread.items.sort((a, b) => b.rssBytes - a.rssBytes)
  return { threads: [...threads.values()].sort((a, b) => b.rssBytes - a.rssBytes), ramuBytes }
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
    : item.kind === 'terminal'
      ? (['term.close', item.id] as const)
      : (['term.background.stop', taskId, item.id] as const)
