import { tmpdir } from 'node:os'
import { timeout } from './util'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import type { UsageReading } from '@ramu/shared/types'
import { providerEnvironment } from '../providers/providerBinaries'
import { claudeUsageReadings, type ClaudeUsageResponse, type UsageService } from '../providers/usage'
import { InputQueue } from './inputQueue'
import type { QueryFn } from './types'

/** What the usage reader needs from the service; the fields it reads can change after construction. */
export interface UsageReaderHost {
  usage(): Pick<UsageService, 'update'> | undefined
  shutdown(): boolean
  providerQuery: QueryFn
  providerBinaries(): Parameters<typeof providerEnvironment>[1]
}

/** Reads Claude's plan usage, throttled to one read every five minutes. */
export class ClaudeUsageReader {
  private lastRead = 0

  constructor(private readonly host: UsageReaderHost) {}

  /** Claude's plan usage without a turn, so the gauges are right before anything has run. Throttled; best effort. */
  refresh(query: Query, account = 'default'): void {
    if (Date.now() - this.lastRead < 5 * 60_000 || !this.host.usage()) return
    this.lastRead = Date.now()
    void query
      .usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?.({ skipBehaviors: true })
      .then((response) => {
        const readings = claudeUsageReadings(response as ClaudeUsageResponse).map((reading) =>
          account === 'default' ? reading : { ...reading, accountId: account },
        )
        if (readings.length) this.host.usage()?.update(readings)
      })
      .catch(() => {})
  }

  /** One Claude login's plan usage, read with a throwaway process. */
  async account(account: string): Promise<UsageReading[]> {
    if (this.host.shutdown() || process.env.RAMU_FAKE_AGENT === '1') return []
    const input = new InputQueue()
    const env = providerEnvironment('claude-code', this.host.providerBinaries(), account)
    const query = this.host.providerQuery({
      prompt: input,
      options: {
        cwd: tmpdir(),
        settingSources: [],
        env,
        permissionMode: 'default',
        canUseTool: async () => ({ behavior: 'deny', message: 'Usage read only' }),
      },
    })
    try {
      const response = await timeout(
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        20_000,
        'timed out',
      )
      return claudeUsageReadings(response as ClaudeUsageResponse)
    } finally {
      input.close()
      query.close?.()
    }
  }

  /** Reads Claude's plan usage now with a throwaway process, when the stored reading is old or missing. */
  async read(): Promise<void> {
    if (
      this.host.shutdown() ||
      !this.host.usage() ||
      process.env.RAMU_FAKE_AGENT === '1' ||
      Date.now() - this.lastRead < 5 * 60_000
    )
      return
    this.lastRead = Date.now()
    const input = new InputQueue()
    const query = this.host.providerQuery({
      prompt: input,
      options: {
        cwd: tmpdir(),
        settingSources: [],
        permissionMode: 'default',
        canUseTool: async () => ({ behavior: 'deny', message: 'Usage read only' }),
      },
    })
    try {
      const response = await timeout(
        query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
        20_000,
        'timed out',
      )
      const readings = claudeUsageReadings(response as ClaudeUsageResponse)
      if (readings.length) this.host.usage()!.update(readings)
    } catch {
      this.lastRead = 0
    } finally {
      input.close()
      query.close?.()
    }
  }
}
