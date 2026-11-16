import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  antigravityModelReadings,
  antigravityUsageReadings,
  mergeAntigravityReadings,
  cursorUsageReadings,
  readAntigravityUsage,
  readCursorUsage,
} from '../src/providers/providerUsage'

const execFile = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', () => ({ execFile }))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('maps Cursor plan usage to monthly readings: overall, and the two allowances behind it', () => {
  const readings = cursorUsageReadings(
    {
      billingCycleEnd: '1793000000000',
      planUsage: { totalPercentUsed: 42.26, autoPercentUsed: 10, apiPercentUsed: 85 },
    },
    5,
  )
  expect(readings).toEqual([
    { provider: 'cursor', window: 'monthly', usedPercent: 42.3, status: 'ok', resetsAt: 1793000000000, updatedAt: 5 },
    {
      provider: 'cursor',
      window: 'monthly',
      scope: 'Cursor models',
      usedPercent: 10,
      status: 'ok',
      resetsAt: 1793000000000,
      updatedAt: 5,
    },
    {
      provider: 'cursor',
      window: 'monthly',
      scope: 'Other models',
      usedPercent: 85,
      status: 'warning',
      resetsAt: 1793000000000,
      updatedAt: 5,
    },
  ])
  expect(cursorUsageReadings({ planUsage: { totalPercentUsed: 120 } })[0]).toMatchObject({
    usedPercent: 100,
    status: 'limited',
  })
  expect(cursorUsageReadings({ planUsage: { autoPercentUsed: 30 } })).toHaveLength(1)
  expect(cursorUsageReadings({})).toEqual([])
})
it('maps Antigravity quota buckets to scoped windows and keeps the fullest bucket', () => {
  const readings = antigravityUsageReadings(
    {
      groups: [
        {
          buckets: [
            { bucketId: 'gemini-pro', window: '5h', remainingFraction: 0.75, resetTime: '2026-10-14T20:00:00Z' },
            { bucketId: 'gemini-flash', window: '5h', remainingFraction: 0.25 },
            { bucketId: 'gemini-pro', window: 'weekly', remainingFraction: 1 },
            { bucketId: '3p-claude', window: 'weekly', remainingFraction: 0 },
            { bucketId: 'gemini-off', window: 'weekly', remainingFraction: 0, disabled: true },
            { bucketId: 'other', window: '5h', remainingFraction: 0 },
          ],
        },
      ],
    },
    1,
  )
  expect(readings).toHaveLength(3)
  expect(readings.find((r) => r.scope === 'Gemini' && r.window === 'five_hour')).toMatchObject({ usedPercent: 75 })
  // Claude and GPT share one allowance: one reading, not one per family.
  expect(readings.filter((r) => r.scope === 'Claude & GPT')).toEqual([
    expect.objectContaining({ window: 'weekly', usedPercent: 100, status: 'limited' }),
  ])
})

it('places Gemini 4 Argon in its own weekly group, by bucket id or group name', () => {
  const readings = antigravityUsageReadings({
    groups: [
      {
        displayName: 'Gemini 4 Argon',
        buckets: [{ bucketId: 'pro-weekly', window: 'weekly', remainingFraction: 0.4 }],
      },
      {
        displayName: 'Claude and GPT models',
        buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 }],
      },
      { buckets: [{ bucketId: 'gemini-argon', window: 'weekly', remainingFraction: 0.9 }] },
    ],
  })
  expect(readings.map((r) => [r.scope, r.window, r.usedPercent])).toEqual([
    ['Gemini 4 Argon', 'weekly', 60],
    ['Claude & GPT', 'weekly', 0],
  ])
})

it('fills the groups a quota summary leaves out from the model list', () => {
  // The summary often names only the shared Claude & GPT allowance; Gemini's quota is on each Gemini model.
  const summary = antigravityUsageReadings({
    groups: [{ buckets: [{ bucketId: '3p-weekly', window: 'weekly', remainingFraction: 1 }] }],
  })
  const models = antigravityModelReadings({
    models: {
      'gemini-3-flash': { modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0.34 } },
      'claude-sonnet-4-6': { modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { remainingFraction: 1 } },
      tab_flash_lite_preview: { modelProvider: 'MODEL_PROVIDER_GOOGLE', quotaInfo: { remainingFraction: 0 } },
    },
  })
  expect(mergeAntigravityReadings(summary, models).map((r) => [r.scope, r.window, r.usedPercent])).toEqual([
    ['Claude & GPT', 'weekly', 0],
    ['Gemini', 'quota', 66],
  ])
})
it('falls back to per-model quotas for accounts without a quota summary', () => {
  const readings = antigravityModelReadings(
    {
      models: {
        'gemini-pro': { quotaInfo: { remainingFraction: 0.6, resetTime: '2026-10-14T20:00:00Z' } },
        'gemini-flash': {
          quotaInfo: { remainingFraction: 0.9 },
          weeklyQuotaInfo: { remainingFraction: 0.2, resetTime: '2026-10-20T00:00:00Z' },
        },
        'claude-sonnet': { modelProvider: 'MODEL_PROVIDER_ANTHROPIC', quotaInfo: { remainingFraction: 0 } },
        'gpt-oss': { quotaInfo: { remainingFraction: 1 } },
        mystery: { quotaInfo: { remainingFraction: 0 } },
      },
    },
    7,
  )
  const pick = (scope: string, window: string) => readings.find((r) => r.scope === scope && r.window === window)
  // No stated window: a plain quota, not an invented five-hour or weekly one. The fullest model per family wins.
  expect(pick('Gemini', 'quota')).toMatchObject({
    usedPercent: 40,
    status: 'ok',
    resetsAt: Date.parse('2026-10-14T20:00:00Z'),
  })
  expect(pick('Gemini', 'weekly')).toMatchObject({ usedPercent: 80, status: 'warning' })
  expect(pick('Claude & GPT', 'quota')).toMatchObject({ usedPercent: 100, status: 'limited' })
  expect(readings.some((r) => r.scope === undefined)).toBe(false)
  expect(antigravityModelReadings({})).toEqual([])
})
it('reads nothing without a stored login, and never sends a Cursor token to another host', async () => {
  expect(await readCursorUsage({ AGENT_CLI_CREDENTIAL_STORE: 'memory' })).toEqual([])
  expect(await readCursorUsage({ CURSOR_AUTH_TOKEN: 'secret', CURSOR_API_ENDPOINT: 'https://evil.example' })).toEqual(
    [],
  )
  expect(await readAntigravityUsage({ GEMINI_HOME: '/nonexistent' })).toEqual([])
})

const token = { client_id: 'client', client_secret: 'secret', refresh_token: 'refresh', project_id: 'project' }
const quotaResponse = { buckets: [{ bucketId: 'gemini-pro', window: '5h', remainingFraction: 0.6 }] }
function mockQuotaService() {
  const fetchMock = vi.fn(
    async (url: string) =>
      new Response(JSON.stringify(url.includes('oauth2.googleapis.com') ? { access_token: 'access' } : quotaResponse)),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
it('reads a private file login and never borrows the shared Keychain login', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ramu-agy-usage-'))
  const keychainCalls = execFile.mock.calls.length
  try {
    mkdirSync(join(home, 'antigravity-acp'))
    writeFileSync(join(home, 'antigravity-acp', 'acp_token.json'), JSON.stringify(token))
    mockQuotaService()
    expect(await readAntigravityUsage({ GEMINI_HOME: home, AGY_ACP_FORCE_FILE_STORAGE: '1' })).toEqual([
      expect.objectContaining({ usedPercent: 40 }),
    ])
    rmSync(join(home, 'antigravity-acp', 'acp_token.json'))
    expect(await readAntigravityUsage({ GEMINI_HOME: home })).toEqual([])
    expect(execFile.mock.calls.length).toBe(keychainCalls)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
it('never runs the macOS security tool to find a login', async () => {
  const calls = execFile.mock.calls.length
  const fetchMock = mockQuotaService()
  expect(await readAntigravityUsage({ GEMINI_HOME: '/nonexistent' })).toEqual([])
  expect(await readCursorUsage({ CURSOR_CONFIG_DIR: '/nonexistent', RAMU_CURSOR_SDK_DIR: '/nonexistent' })).toEqual([])
  expect(execFile.mock.calls.length).toBe(calls)
  expect(fetchMock).not.toHaveBeenCalled()
})
it('reads the default Antigravity login from its file in the home folder, with file storage', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ramu-agy-home-'))
  try {
    mkdirSync(join(home, 'antigravity-acp'))
    writeFileSync(join(home, 'antigravity-acp', 'acp_token.json'), JSON.stringify(token))
    mockQuotaService()
    expect(await readAntigravityUsage({ GEMINI_HOME: home })).toEqual([expect.objectContaining({ usedPercent: 40 })])
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
it("reads a Cursor account's own saved login and never another account's", async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-cursor-'))
  try {
    mkdirSync(join(dir, 'sdk'))
    writeFileSync(
      join(dir, 'sdk', 'auth.json'),
      JSON.stringify({ version: 1, backendUrl: 'x', apiKey: 'account-key', createdAtMs: 1 }),
    )
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ planUsage: { totalPercentUsed: 10 } })))
    vi.stubGlobal('fetch', fetchMock)
    await readCursorUsage({ RAMU_CURSOR_SDK_DIR: join(dir, 'sdk'), CURSOR_CONFIG_DIR: dir })
    const headers = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer account-key')
    // An expired key is not used.
    writeFileSync(
      join(dir, 'sdk', 'auth.json'),
      JSON.stringify({ version: 1, backendUrl: 'x', apiKey: 'old', createdAtMs: 1, apiKeyExpiresAtMs: 5 }),
    )
    fetchMock.mockClear()
    expect(await readCursorUsage({ RAMU_CURSOR_SDK_DIR: join(dir, 'sdk'), CURSOR_CONFIG_DIR: dir })).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
