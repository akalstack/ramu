import { describe, expect, it } from 'vitest'
import {
  hostNeedsUpdate,
  hostUpdateSummary,
  offeredVersion,
  pendingProviderUpdates,
  providerUpdateKey,
  recordSeen,
  serviceReportsOlderVersion,
  UPDATE_WAIT_MS,
} from '../src/updates'

it('lists a newer Ramu release and the provider updates that can run, skipping ones already updating', () => {
  const provider = (patch: object) => ({
    provider: 'codex' as const,
    version: '1.0.0',
    latestVersion: '1.1.0',
    updateAvailable: true,
    updateCommand: 'npm i -g @openai/codex',
    ...patch,
  })
  const summary = hostUpdateSummary({ currentVersion: '0.1.0', release: { version: '0.2.0' } as never }, [
    provider({}),
    provider({ provider: 'claude-code', updating: true }),
    provider({ provider: 'cursor', updateCommand: null }),
    provider({ provider: 'opencode', updateAvailable: false }),
  ])
  expect(summary).toEqual({
    currentVersion: '0.1.0',
    nextVersion: '0.2.0',
    providers: [{ provider: 'codex', version: '1.0.0', latest: '1.1.0' }],
    waiting: [],
  })
  // Releases still waiting out their day are listed with when they come, Ramu first.
  const waiting = hostUpdateSummary(
    { currentVersion: '0.1.0', release: null, waiting: { version: '0.3.0', notesUrl: '', settlesAt: 'tomorrow' } },
    [provider({ updateAvailable: false, latestVersion: '1.0.0', waitingVersion: '1.2.0', waitingUntil: 'later' })],
  )
  expect(waiting.waiting).toEqual([
    { provider: 'ramu', version: '0.3.0', until: 'tomorrow' },
    { provider: 'codex', version: '1.2.0', until: 'later' },
  ])
  expect(hostNeedsUpdate(waiting)).toBe(false)
  expect(hostNeedsUpdate(summary)).toBe(true)
  expect(hostNeedsUpdate(hostUpdateSummary({ currentVersion: '0.2.0', release: null }, []))).toBe(false)
  expect(hostUpdateSummary(null, []).currentVersion).toBeNull()
})

it('offers every host its runnable provider updates, leaving out dismissed versions only', () => {
  const status = (provider: 'codex' | 'opencode' | 'claude-code', patch: object = {}) => ({
    provider,
    binary: provider,
    version: '1.0.0',
    latestVersion: '1.1.0',
    updateAvailable: true,
    updateCommand: 'install',
    ...patch,
  })
  const dismissed = new Set([providerUpdateKey({ host: 'mini', provider: 'codex', binary: 'codex', latest: '1.1.0' })])
  const pending = pendingProviderUpdates(
    [
      [
        'local',
        [status('codex'), status('opencode', { updating: true }), status('claude-code', { updateCommand: null })],
      ],
      ['mini', [status('codex'), status('opencode', { latestVersion: '2.0.0' })]],
    ],
    dismissed,
  )
  expect(pending.map((update) => `${update.host}/${update.provider}@${update.latest}`)).toEqual([
    'local/codex@1.1.0',
    'mini/opencode@2.0.0',
  ])
})

describe('waiting before an update is offered', () => {
  const day = UPDATE_WAIT_MS
  const t0 = Date.parse('2026-11-10T00:00:00Z')
  it('notes each newest release once and forgets a pulled one', () => {
    let seen = recordSeen({}, '1.0.0', t0)
    seen = recordSeen(seen, '1.1.0', t0 + 1000)
    expect(recordSeen(seen, '1.1.0', t0 + day)).toEqual(seen)
    // The source went back to 1.0.0: 1.1.0 was pulled.
    expect(Object.keys(recordSeen(seen, '1.0.0', t0 + 2000))).toEqual(['1.0.0'])
  })
  it('offers the newest version that has waited, pinned to it while a newer one waits', () => {
    const seen = { '1.0.0': new Date(t0).toISOString(), '1.1.0': new Date(t0 + day / 2).toISOString() }
    expect(offeredVersion(seen, '1.1.0', { wait: true, pins: true, now: t0 + day })).toBe('1.0.0')
    expect(offeredVersion(seen, '1.1.0', { wait: true, pins: true, now: t0 + day * 2 })).toBe('1.1.0')
    expect(offeredVersion(seen, '1.1.0', { wait: false, pins: true, now: t0 })).toBe('1.1.0')
  })
  it('holds a self-updating tool until its newest release has waited', () => {
    const seen = { '1.0.0': new Date(t0).toISOString(), '1.1.0': new Date(t0 + day / 2).toISOString() }
    expect(offeredVersion(seen, '1.1.0', { wait: true, pins: false, now: t0 + day })).toBeNull()
    expect(offeredVersion(seen, '1.1.0', { wait: true, pins: false, now: t0 + day * 2 })).toBe('1.1.0')
  })
})

describe('serviceReportsOlderVersion', () => {
  it('flags a service on the bundled build that still reports the version it started under', () => {
    expect(serviceReportsOlderVersion({ version: '0.1.0-alpha.3', bundledVersion: '0.1.0-alpha.4' })).toBe(true)
  })
  it('stays quiet when versions match, a service update is pending, or nothing is known', () => {
    expect(serviceReportsOlderVersion({ version: '0.1.0-alpha.4', bundledVersion: '0.1.0-alpha.4' })).toBe(false)
    expect(
      serviceReportsOlderVersion({ version: '0.1.0-alpha.3', bundledVersion: '0.1.0-alpha.4', updateAvailable: true }),
    ).toBe(false)
    expect(serviceReportsOlderVersion({ version: '0.1.0-alpha.3' })).toBe(false)
    expect(serviceReportsOlderVersion(null)).toBe(false)
  })
})
