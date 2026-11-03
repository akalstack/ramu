import { expect, it } from 'vitest'
import { hostNeedsUpdate, hostUpdateSummary } from '../src/updates'

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
