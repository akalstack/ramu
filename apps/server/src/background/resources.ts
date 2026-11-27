import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { availableParallelism, totalmem } from 'node:os'
import { promisify } from 'node:util'
import {
  attributeProcesses,
  idleAgents,
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
  /** How long ago the thread last moved, in milliseconds. */
  idleFor?(taskId: string): number
  /** Stops these threads' agents; each starts again with its thread's next message. */
  stopAgents?(taskIds: string[]): Promise<void>
}

/** A thread idle this long has its agent stopped while the host is low on memory; one idle a moment may be read now. */
export const AUTO_STOP_IDLE_MS = 10 * 60_000
/** How long the Brief says what the host stopped on its own. */
const STOPPED_SHOWN_MS = 60 * 60_000

/** Reads on demand: `ps` runs only while someone is looking, and the once-a-minute check needs it only while low. */
export class ResourceService {
  private cached: { at: number; value: ResourceSnapshot } | null = null
  private reading: Promise<ResourceSnapshot> | null = null
  private lowChecks = 0
  private latest: HostResources = { memory: null, low: null, platform: process.platform, arch: process.arch }
  private stopped: LowMemory['stopped']
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
      let { threads } = await this.snapshot().catch(() => ({ threads: [] as ResourceSnapshot['threads'] }))
      // Low for two minutes running: agents of threads idle a while are stopped, as the person would from Resources.
      // Servers and terminals keep running, since something may be using them.
      const quiet = idleAgents(
        threads.filter((thread) => (this.sources.idleFor?.(thread.taskId) ?? 0) >= AUTO_STOP_IDLE_MS),
      )
      if (quiet.taskIds.length && this.sources.stopAgents) {
        await this.sources.stopAgents(quiet.taskIds).catch(() => {})
        this.stopped = { threads: quiet.taskIds.length, bytes: quiet.bytes, at: Date.now() }
        this.cached = null
        threads = (await this.snapshot().catch(() => ({ threads: [] as ResourceSnapshot['threads'] }))).threads
      }
      const idle = this.sources.idleThreads()
      const idleThreads = threads.filter((thread) => idle.has(thread.taskId))
      const stopped = this.stopped && Date.now() - this.stopped.at < STOPPED_SHOWN_MS ? this.stopped : undefined
      low = {
        availableBytes: memory.availableBytes,
        idleThreads: idleThreads.map((thread) => thread.taskId),
        idleBytes: idleThreads.reduce((sum, thread) => sum + thread.rssBytes, 0),
        ...(stopped ? { stopped } : {}),
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
