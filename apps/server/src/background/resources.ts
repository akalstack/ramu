import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism, totalmem } from 'node:os'
import { promisify } from 'node:util'
import {
  attributeProcesses,
  isLowMemory,
  parseMeminfo,
  parseVmStat,
  parseProcessTable,
  type HostMemory,
  type HostResources,
  type LowMemory,
  type ProcessRoot,
  type ResourceSnapshot,
} from '@ramu/shared/resources'

const run = promisify(execFile)
const FRESH_MS = 2000
const LOW_CHECK_MS = 60_000

export async function readHostMemory(platform = process.platform): Promise<HostMemory | null> {
  try {
    if (platform === 'linux') return parseMeminfo(await readFile('/proc/meminfo', 'utf8'))
    if (platform === 'darwin') {
      const { stdout } = await run('/usr/bin/vm_stat', [], { timeout: 2000 })
      return parseVmStat(stdout, totalmem())
    }
  } catch {
    // A failed reading hides the figures; it must never read as zero.
  }
  return null
}

export async function readProcesses() {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,ppid=,rss=,pcpu='], { timeout: 3000, maxBuffer: 8_000_000 })
  return parseProcessTable(stdout)
}

export interface ResourceSources {
  /** Everything still running that this service started and a thread owns. */
  roots(): ProcessRoot[]
  /** Threads with no turn in progress, the only ones Ramu offers to stop as a group. */
  idleThreads(): Set<string>
}

/** Reads on demand: `ps` runs only while someone is looking, and the once-a-minute check needs it only while low. */
export class ResourceService {
  private cached: { at: number; value: ResourceSnapshot } | null = null
  private reading: Promise<ResourceSnapshot> | null = null
  private lowChecks = 0
  private latest: HostResources = { memory: null, low: null, platform: process.platform, arch: process.arch }
  private timer?: NodeJS.Timeout

  constructor(
    private readonly sources: ResourceSources,
    private readonly readMemory: () => Promise<HostMemory | null> = readHostMemory,
    private readonly readTable: typeof readProcesses = readProcesses,
    private readonly description: () => string = () => '',
  ) {}

  start() {
    void this.check()
    this.timer = setInterval(() => void this.check(), LOW_CHECK_MS)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
  }

  /** The processes, with each thread's idleness read now: a cached reading must not offer to stop a thread that started. */
  async snapshot(): Promise<ResourceSnapshot> {
    const value =
      this.cached && Date.now() - this.cached.at < FRESH_MS
        ? this.cached.value
        : await (this.reading ??= this.read().finally(() => {
            this.reading = null
          }))
    const idle = this.sources.idleThreads()
    return { ...value, threads: value.threads.map((thread) => ({ ...thread, idle: idle.has(thread.taskId) })) }
  }

  /** Test device platforms ready here, refreshed by the host now and then; reported with the memory reading. */
  testDevices: ('ios' | 'android')[] = []

  host(): HostResources {
    const description = this.description().trim()
    return {
      ...this.latest,
      ...(description ? { description } : {}),
      ...(this.testDevices.length ? { testDevices: this.testDevices } : {}),
    }
  }

  /** Low only after two checks in a row, so one busy minute does not raise a row and a badge. */
  async check(): Promise<void> {
    const memory = await this.readMemory()
    this.lowChecks = memory && isLowMemory(memory) ? this.lowChecks + 1 : 0
    let low: LowMemory | null = null
    if (memory && this.lowChecks >= 2) {
      const { threads } = await this.snapshot().catch(() => ({ threads: [] as ResourceSnapshot['threads'] }))
      const idle = this.sources.idleThreads()
      const idleThreads = threads.filter((thread) => idle.has(thread.taskId))
      low = {
        availableBytes: memory.availableBytes,
        idleThreads: idleThreads.map((thread) => thread.taskId),
        idleBytes: idleThreads.reduce((sum, thread) => sum + thread.rssBytes, 0),
      }
    }
    this.latest = { memory, low, platform: process.platform, arch: process.arch }
  }

  private async read(): Promise<ResourceSnapshot> {
    const [memory, rows] = await Promise.all([this.readMemory(), this.readTable()])
    const value = {
      memory,
      cores: availableParallelism(),
      ...attributeProcesses(rows, process.pid, this.sources.roots()),
    }
    this.cached = { at: Date.now(), value }
    return value
  }
}
