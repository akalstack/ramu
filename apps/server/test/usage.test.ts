import type { UsageReading } from '@ramu/shared/types'
import { describe, expect, it } from 'vitest'
import { UsageService, claudeReadings, claudeUsageReadings } from '../src/providers/usage'
import { parseTaskMessage, parseTaskReport, subagentNotePrompt, taskMessagePrompt } from '@ramu/shared/chat/agentTasks'

describe('Claude plan usage', () => {
  it('reads every window of a real rate_limit_event, with reset times in milliseconds', () => {
    const info = {
      status: 'allowed',
      resetsAt: 1791693000,
      rateLimitType: 'five_hour',
      overageStatus: 'rejected',
      unifiedWindows: {
        five_hour: { utilization: 0.73, resetsAt: 1791693000 },
        seven_day: { utilization: 0.61, resetsAt: 1791957600 },
      },
    }
    expect(claudeReadings(info, [], 7)).toEqual([
      {
        provider: 'claude-code',
        window: 'five_hour',
        usedPercent: 73,
        resetsAt: 1791693000000,
        status: 'ok',
        updatedAt: 7,
      },
      {
        provider: 'claude-code',
        window: 'weekly',
        usedPercent: 61,
        resetsAt: 1791957600000,
        status: 'ok',
        updatedAt: 7,
      },
    ])
  })
  it('maps model-specific windows, warnings and rejections', () => {
    expect(
      claudeReadings({
        status: 'allowed_warning',
        rateLimitType: 'five_hour',
        unifiedWindows: {
          five_hour: { utilization: 0.917, resetsAt: 1_800_000_000 },
          seven_day_opus: { utilization: 0.4 },
        },
      }),
    ).toMatchObject([
      { window: 'five_hour', usedPercent: 92, status: 'warning' },
      { window: 'weekly', scope: 'Opus', usedPercent: 40, status: 'ok' },
    ])
    expect(claudeReadings({ status: 'rejected', rateLimitType: 'seven_day' })).toMatchObject([
      { window: 'weekly', usedPercent: 100, status: 'limited' },
    ])
  })
  it('understands the single-window form the typings describe, and ignores unknown windows', () => {
    expect(
      claudeReadings({
        status: 'allowed',
        rateLimitType: 'seven_day_sonnet',
        utilization: 0.4,
        resetsAt: 1_800_000_000,
      }),
    ).toMatchObject([{ window: 'weekly', scope: 'Sonnet', usedPercent: 40 }])
    expect(claudeReadings({ status: 'allowed', rateLimitType: 'overage', utilization: 0.1 })).toEqual([])
  })
  it('keeps the last known percent when an event only changes the status', () => {
    const previous = claudeReadings({ rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1_800_000_000 })
    expect(claudeReadings({ status: 'allowed', rateLimitType: 'five_hour' }, previous)).toMatchObject([
      { usedPercent: 50, resetsAt: 1_800_000_000_000 },
    ])
  })
})

describe('Messages relayed to sub-agents', () => {
  it('round-trips the addressed message', () => {
    const text = taskMessagePrompt(
      'claude-code',
      { agentId: 't1', name: 'Map "auth"', status: 'running', address: 'auth-mapper' },
      'Also list TODOs\n\nThanks',
    )
    expect(parseTaskMessage(text)).toEqual({
      name: "Map 'auth'",
      address: 'auth-mapper',
      body: 'Also list TODOs\n\nThanks',
    })
    expect(parseTaskMessage('just a message')).toBeNull()
  })
})

describe('Claude on-demand usage', () => {
  it('maps the usage endpoint: percentages as given, ISO reset times, plan, unknown windows ignored', () => {
    const readings = claudeUsageReadings(
      {
        subscription_type: 'team',
        rate_limits: {
          five_hour: { utilization: 75, resets_at: '2026-10-11T04:29:59.905286+00:00' },
          seven_day: { utilization: 61, resets_at: '2026-10-14T05:59:59.905309+00:00' },
          seven_day_opus: null,
          extra_usage: { utilization: 100 },
          tangelo: null,
        } as never,
      },
      9,
    )
    expect(readings).toEqual([
      {
        provider: 'claude-code',
        window: 'five_hour',
        usedPercent: 75,
        resetsAt: Date.parse('2026-10-11T04:29:59.905Z'),
        status: 'ok',
        plan: 'team',
        updatedAt: 9,
      },
      {
        provider: 'claude-code',
        window: 'weekly',
        usedPercent: 61,
        resetsAt: Date.parse('2026-10-14T05:59:59.905Z'),
        status: 'ok',
        plan: 'team',
        updatedAt: 9,
      },
    ])
    expect(claudeUsageReadings({ rate_limits: null })).toEqual([])
  })
})

it('a fresh Antigravity read replaces groups it no longer reports, keeping limit notices and other logins', () => {
  const reading = (scope: string, extra: Partial<UsageReading> = {}): UsageReading => ({
    provider: 'antigravity',
    window: 'weekly',
    scope,
    usedPercent: 0,
    status: 'ok',
    updatedAt: 1,
    ...extra,
  })
  // Saved before Claude and GPT became one reading.
  const service = new UsageService(
    () => [
      reading('Claude'),
      reading('GPT'),
      reading('Gemini', { source: 'notice', status: 'limited' }),
      reading('Claude', { accountId: 'work' }),
      { provider: 'codex', window: 'weekly', usedPercent: 5, status: 'ok', updatedAt: 1 },
    ],
    () => {},
    () => {},
  )
  service.update([reading('Claude & GPT'), reading('Gemini', { window: 'quota', usedPercent: 66 })])
  expect(service.all().map((r) => `${r.provider}:${r.accountId ?? 'default'}:${r.scope ?? ''}:${r.window}`)).toEqual([
    'antigravity:default:Gemini:weekly',
    'antigravity:work:Claude:weekly',
    'codex:default::weekly',
    'antigravity:default:Claude & GPT:weekly',
    'antigravity:default:Gemini:quota',
  ])
})

it('keeps account windows separate and only exposes the selected account', async () => {
  const { configureProviderBinaries } = await import('../src/providers/providerBinaries')
  const stored: UsageReading[][] = []
  const service = new UsageService(
    () => [],
    (readings) => stored.push(readings),
    () => {},
  )
  const base = {
    provider: 'codex' as const,
    window: 'five_hour' as const,
    status: 'ok' as const,
    updatedAt: Date.now(),
  }
  try {
    configureProviderBinaries({})
    service.update([
      { ...base, usedPercent: 99 },
      { ...base, usedPercent: 10, accountId: 'work' },
    ])
    expect(service.list().map((reading) => reading.usedPercent)).toEqual([99])
    configureProviderBinaries({ codex: { binary: '', accountId: 'work', accounts: [{ id: 'work', name: 'Work' }] } })
    expect(service.list().map((reading) => reading.usedPercent)).toEqual([10])
    expect(service.list({ codex: 'default' }).map((reading) => reading.usedPercent)).toEqual([99])
    expect(stored.at(-1)).toHaveLength(2)
  } finally {
    configureProviderBinaries({})
  }
})

describe('sub-agent notes to their thread', () => {
  it('round-trips a note and a question, hiding the reply hint from the thread', () => {
    expect(parseTaskReport(subagentNotePrompt('Map "auth"', 'says', 'c1', 'Found two call sites'))).toEqual({
      name: "Map 'auth'",
      verb: 'says',
      body: 'Found two call sites',
    })
    const ask = subagentNotePrompt('Map', 'asks', 'c1', 'Rename or wrap?')
    expect(ask).toContain('answer_subagent, agent "c1"')
    expect(parseTaskReport(ask)).toEqual({ name: 'Map', verb: 'asks', body: 'Rename or wrap?' })
  })
})
