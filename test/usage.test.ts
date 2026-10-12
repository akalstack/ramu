import { describe, expect, it } from 'vitest'
import { claudeReadings, claudeUsageReadings } from '../src/main/usage'
import { parseTaskMessage, taskMessagePrompt } from '../src/shared/agentTasks'

describe('Claude plan usage', () => {
  it('reads every window of a real rate_limit_event, with reset times in milliseconds', () => {
    const info = { status: 'allowed', resetsAt: 1791693000, rateLimitType: 'five_hour', overageStatus: 'rejected', unifiedWindows: { five_hour: { utilization: 0.73, resetsAt: 1791693000 }, seven_day: { utilization: 0.61, resetsAt: 1791957600 } } }
    expect(claudeReadings(info, [], 7)).toEqual([
      { provider: 'claude-code', window: 'five_hour', usedPercent: 73, resetsAt: 1791693000000, status: 'ok', updatedAt: 7 },
      { provider: 'claude-code', window: 'weekly', usedPercent: 61, resetsAt: 1791957600000, status: 'ok', updatedAt: 7 },
    ])
  })
  it('maps model-specific windows, warnings and rejections', () => {
    expect(claudeReadings({ status: 'allowed_warning', rateLimitType: 'five_hour', unifiedWindows: { five_hour: { utilization: 0.917, resetsAt: 1_800_000_000 }, seven_day_opus: { utilization: 0.4 } } })).toMatchObject([{ window: 'five_hour', usedPercent: 92, status: 'warning' }, { window: 'weekly', scope: 'Opus', usedPercent: 40, status: 'ok' }])
    expect(claudeReadings({ status: 'rejected', rateLimitType: 'seven_day' })).toMatchObject([{ window: 'weekly', usedPercent: 100, status: 'limited' }])
  })
  it('understands the single-window form the typings describe, and ignores unknown windows', () => {
    expect(claudeReadings({ status: 'allowed', rateLimitType: 'seven_day_sonnet', utilization: 0.4, resetsAt: 1_800_000_000 })).toMatchObject([{ window: 'weekly', scope: 'Sonnet', usedPercent: 40 }])
    expect(claudeReadings({ status: 'allowed', rateLimitType: 'overage', utilization: 0.1 })).toEqual([])
  })
  it('keeps the last known percent when an event only changes the status', () => {
    const previous = claudeReadings({ rateLimitType: 'five_hour', utilization: 0.5, resetsAt: 1_800_000_000 })
    expect(claudeReadings({ status: 'allowed', rateLimitType: 'five_hour' }, previous)).toMatchObject([{ usedPercent: 50, resetsAt: 1_800_000_000_000 }])
  })
})

describe('Messages relayed to sub-agents', () => {
  it('round-trips the addressed message', () => {
    const text = taskMessagePrompt('claude-code', { agentId: 't1', name: 'Map "auth"', status: 'running', address: 'auth-mapper' }, 'Also list TODOs\n\nThanks')
    expect(parseTaskMessage(text)).toEqual({ name: "Map 'auth'", address: 'auth-mapper', body: 'Also list TODOs\n\nThanks' })
    expect(parseTaskMessage('just a message')).toBeNull()
  })
})

describe('Agent checklists', () => {
  it('maps Claude TodoWrite and Codex plan steps', async () => {
    const { todoItems } = await import('../src/main/agent')
    const { codexPlanItems } = await import('../src/main/codex')
    expect(todoItems([{ content: 'Read', status: 'completed' }, { content: 'Write', activeForm: 'Writing', status: 'in_progress' }, { content: 'Test', status: 'pending' }, { status: 'pending' }])).toEqual([{ text: 'Read', status: 'done' }, { text: 'Write', status: 'active' }, { text: 'Test', status: 'pending' }])
    expect(todoItems('nope')).toBeNull()
    expect(codexPlanItems([{ step: ' Survey ', status: 'completed' }, { step: 'Edit', status: 'inProgress' }, { step: 'Verify', status: 'pending' }, { step: '' }])).toEqual([{ text: 'Survey', status: 'done' }, { text: 'Edit', status: 'active' }, { text: 'Verify', status: 'pending' }])
  })
})

describe('Claude on-demand usage', () => {
  it('maps the usage endpoint: percentages as given, ISO reset times, plan, unknown windows ignored', () => {
    const readings = claudeUsageReadings({ subscription_type: 'team', rate_limits: { five_hour: { utilization: 75, resets_at: '2026-10-11T04:29:59.905286+00:00' }, seven_day: { utilization: 61, resets_at: '2026-10-14T05:59:59.905309+00:00' }, seven_day_opus: null, extra_usage: { utilization: 100 }, tangelo: null } as never }, 9)
    expect(readings).toEqual([
      { provider: 'claude-code', window: 'five_hour', usedPercent: 75, resetsAt: Date.parse('2026-10-11T04:29:59.905Z'), status: 'ok', plan: 'team', updatedAt: 9 },
      { provider: 'claude-code', window: 'weekly', usedPercent: 61, resetsAt: Date.parse('2026-10-14T05:59:59.905Z'), status: 'ok', plan: 'team', updatedAt: 9 },
    ])
    expect(claudeUsageReadings({ rate_limits: null })).toEqual([])
  })
})
