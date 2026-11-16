import { expect, it } from 'vitest'
import { hostNeedsUpdate, hostUpdateSummary, pendingProviderUpdates, providerUpdateKey } from '../src/updates'

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
  })
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
