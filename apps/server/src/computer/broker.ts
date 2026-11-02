import { randomUUID } from 'node:crypto'
import type {
  BrokerCommand,
  BrokerOutcome,
  ComputerAction,
  ComputerBackend,
  ComputerCapture,
  ComputerRuntimeStatus,
  ComputerTarget,
} from '@ramu/shared/computerBridge'

export type { BrokerCommand, BrokerOutcome }

/** A broker that has not polled for this long is treated as gone. A poll lasts well under this. */
export const BROKER_STALE_MS = 45_000
const COMMAND_TIMEOUT_MS = 30_000

interface Broker {
  name: string
  lastSeen: number
  queue: BrokerCommand[]
  waiter: ((command: BrokerCommand | null) => void) | null
  pending: Map<
    string,
    { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >
}

/**
 * The reverse channel from the execution host to a computer that owns the screen. The owner's desktop registers, then
 * long-polls for commands and posts each result; nothing here replays a command after a disconnect.
 */
export class BrokerHub {
  private brokers = new Map<string, Broker>()
  constructor(private readonly now: () => number = Date.now) {}

  register(deviceId: string, name: string) {
    this.drop(deviceId, 'The computer reconnected.')
    this.brokers.set(deviceId, { name, lastSeen: this.now(), queue: [], waiter: null, pending: new Map() })
  }

  unregister(deviceId: string) {
    this.drop(deviceId, 'The computer stopped sharing its screen.')
  }

  private drop(deviceId: string, reason: string) {
    const broker = this.brokers.get(deviceId)
    if (!broker) return
    this.brokers.delete(deviceId)
    broker.waiter?.(null)
    for (const { reject, timer } of broker.pending.values()) {
      clearTimeout(timer)
      reject(new Error(reason))
    }
  }

  /** Owner polls. Resolves with the next command, or null when nothing arrived in `waitMs`. */
  next(deviceId: string, waitMs: number): Promise<BrokerCommand | null> {
    const broker = this.brokers.get(deviceId)
    if (!broker) return Promise.reject(new Error('Register this computer before polling.'))
    broker.lastSeen = this.now()
    broker.waiter?.(null)
    const queued = broker.queue.shift()
    if (queued) return Promise.resolve(queued)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (broker.waiter === done) broker.waiter = null
        broker.lastSeen = this.now()
        resolve(null)
      }, waitMs)
      const done = (command: BrokerCommand | null) => {
        clearTimeout(timer)
        if (broker.waiter === done) broker.waiter = null
        resolve(command)
      }
      broker.waiter = done
    })
  }

  result(deviceId: string, id: string, outcome: BrokerOutcome) {
    const broker = this.brokers.get(deviceId)
    const entry = broker?.pending.get(id)
    if (!broker || !entry) return
    broker.lastSeen = this.now()
    broker.pending.delete(id)
    clearTimeout(entry.timer)
    if (outcome.ok) entry.resolve(outcome.value)
    else entry.reject(new Error(outcome.error))
  }

  online(deviceId: string): boolean {
    const broker = this.brokers.get(deviceId)
    return !!broker && this.now() - broker.lastSeen < BROKER_STALE_MS
  }

  list(): { deviceId: string; name: string; online: boolean }[] {
    return [...this.brokers].map(([deviceId, broker]) => ({
      deviceId,
      name: broker.name,
      online: this.online(deviceId),
    }))
  }

  send<T>(deviceId: string, command: DistributiveOmit<BrokerCommand, 'id'>): Promise<T> {
    const broker = this.brokers.get(deviceId)
    if (!broker || !this.online(deviceId)) return Promise.reject(new Error('That computer is offline.'))
    const id = randomUUID()
    const full = { ...command, id } as BrokerCommand
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        broker.pending.delete(id)
        reject(new Error('That computer did not answer in time.'))
      }, COMMAND_TIMEOUT_MS)
      broker.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      if (broker.waiter) broker.waiter(full)
      else broker.queue.push(full)
    })
  }

  backendFor(deviceId: string): RemoteBackend {
    return new RemoteBackend(this, deviceId)
  }

  name(deviceId: string): string | undefined {
    return this.brokers.get(deviceId)?.name
  }
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never

/** A computer reached through its broker. Observation and input go to the owner; the host keeps every policy. */
export class RemoteBackend implements ComputerBackend {
  constructor(
    private readonly hub: BrokerHub,
    readonly deviceId: string,
  ) {}

  status(): ComputerRuntimeStatus {
    return this.hub.online(this.deviceId)
      ? { available: true, computer: { id: this.deviceId, name: this.hub.name(this.deviceId) ?? 'Computer' } }
      : { available: false, reason: 'offline', detail: 'That computer is offline or not sharing its screen.' }
  }

  capture(target: ComputerTarget): Promise<ComputerCapture> {
    return this.hub.send(this.deviceId, { kind: 'capture', target })
  }

  perform(target: ComputerTarget, action: ComputerAction): Promise<void> {
    return this.hub.send<void>(this.deviceId, { kind: 'perform', target, action })
  }

  releaseInput(target: ComputerTarget): void {
    // Best effort: a lost computer has nothing held, and the owner releases input when it disconnects.
    void this.hub.send(this.deviceId, { kind: 'release', target }).catch(() => {})
  }

  /** An owner on an older desktop answers nothing, which reads as no detection. */
  async localInputActive(target: ComputerTarget): Promise<boolean> {
    try {
      return (await this.hub.send<unknown>(this.deviceId, { kind: 'localInput', target })) === true
    } catch {
      return false
    }
  }

  apps(): Promise<string[]> {
    return this.hub.send<string[]>(this.deviceId, { kind: 'apps' })
  }
}
