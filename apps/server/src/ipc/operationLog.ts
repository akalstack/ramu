import { createHash } from 'node:crypto'

export type OperationRecord<T> =
  { state: 'running'; digest: string } | { state: 'done'; digest: string; result: T; at: number }

export type OperationStart<T> =
  { kind: 'run' } | { kind: 'running' } | { kind: 'done'; result: T } | { kind: 'conflict' }

const digestOf = (method: string, args: unknown) =>
  createHash('sha256')
    .update(JSON.stringify([method, args]))
    .digest('hex')

/**
 * Scoped, bounded record of mutations that may need a retry after a lost reply. A key is bound to its method and
 * arguments: the same key with different arguments is refused, a finished key returns its recorded result, and a
 * key still running is reported instead of run twice. A request id alone never gives exactly-once behavior.
 */
export class OperationLog<T = unknown> {
  private records = new Map<string, OperationRecord<T>>()
  constructor(
    private readonly retainMs: number,
    private readonly maxRecords: number,
  ) {}

  begin(key: string, method: string, args: unknown, now = Date.now()): OperationStart<T> {
    this.prune(now)
    const digest = digestOf(method, args)
    const existing = this.records.get(key)
    if (existing) {
      if (existing.digest !== digest) return { kind: 'conflict' }
      return existing.state === 'done' ? { kind: 'done', result: existing.result } : { kind: 'running' }
    }
    if (this.records.size >= this.maxRecords) {
      const oldest = this.records.keys().next().value
      if (oldest !== undefined) this.records.delete(oldest)
    }
    this.records.set(key, { state: 'running', digest })
    return { kind: 'run' }
  }

  finish(key: string, result: T, now = Date.now()): void {
    const existing = this.records.get(key)
    if (existing) this.records.set(key, { state: 'done', digest: existing.digest, result, at: now })
  }

  /** The operation failed before any effect; the key may be used again. */
  abandon(key: string): void {
    if (this.records.get(key)?.state === 'running') this.records.delete(key)
  }

  private prune(now: number) {
    for (const [key, record] of this.records)
      if (record.state === 'done' && now - record.at > this.retainMs) this.records.delete(key)
  }
}
