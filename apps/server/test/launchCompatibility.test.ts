import { mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { CompatibilityPolicy } from '@ramu/shared/providers/compatibility'
import { nextStep } from '@ramu/shared/providers/routing'
import { LaunchCompatibility, ProviderIncompatibleError } from '../src/providers/launchCompatibility'

const policy: CompatibilityPolicy = {
  revision: 2,
  rules: [
    {
      id: 'old',
      provider: 'codex',
      runtime: 'app-server',
      below: '0.40.0',
      status: 'incompatible',
      affects: ['resume'],
      recommend: '0.50.0',
      evidence: 'fixture',
    },
    { id: 'ok', provider: 'codex', runtime: 'app-server', min: '0.40.0', status: 'supported', evidence: 'fixture' },
  ],
}

function setup(version: string | null | Error) {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-compat-'))
  const binary = join(dir, 'codex')
  writeFileSync(binary, 'a')
  const probe = vi.fn(async () => {
    if (version instanceof Error) throw version
    return version
  })
  const guard = new LaunchCompatibility(policy, { codex: 'app-server' }, probe, () => binary)
  return { guard, probe, binary }
}

describe('launch compatibility', () => {
  it('blocks only a proven incompatible runtime, with the fix', async () => {
    const { guard } = setup('0.30.0')
    const error = await guard.assertLaunchable('codex').catch((e) => e)
    expect(error).toBeInstanceOf(ProviderIncompatibleError)
    expect(error.message).toContain('0.50.0')
    expect(error.message).toContain('resume')
    expect(guard.isBlocked('codex')).toBe(true)
  })

  it('keeps unknown versions, probe failures and unaudited providers launchable', async () => {
    await expect(setup('0.50.0').guard.assertLaunchable('codex')).resolves.toBeUndefined()
    await expect(setup(null).guard.assertLaunchable('codex')).resolves.toBeUndefined()
    await expect(setup(new Error('boom')).guard.assertLaunchable('codex')).resolves.toBeUndefined()
    await expect(setup('0.30.0').guard.assertLaunchable('claude-code')).resolves.toBeUndefined()
  })

  it('coalesces concurrent probes and caches by executable identity', async () => {
    const { guard, probe, binary } = setup('0.30.0')
    await Promise.all([guard.evaluate('codex'), guard.evaluate('codex'), guard.evaluate('codex')])
    expect(probe).toHaveBeenCalledTimes(1)
    await guard.evaluate('codex')
    expect(probe).toHaveBeenCalledTimes(1)
    // Replacement at the same path is a new identity.
    writeFileSync(binary, 'a longer replacement')
    utimesSync(binary, new Date(), new Date(Date.now() + 5000))
    await guard.evaluate('codex')
    expect(probe).toHaveBeenCalledTimes(2)
    guard.invalidate('codex')
    await guard.evaluate('codex')
    expect(probe).toHaveBeenCalledTimes(3)
  })

  it('evaluates a release before recommending or installing it', () => {
    const { guard } = setup('0.50.0')
    expect(guard.target('codex', '0.30.1')?.status).toBe('incompatible')
    expect(guard.target('codex', '0.60.0')?.status).toBe('supported')
    expect(guard.target('codex', null)).toBeNull()
  })

  it('skips blocked destinations in automatic routing without calling them limited', async () => {
    const { guard } = setup('0.30.0')
    const blocked = await guard.blockedProviders(['codex', 'claude-code'])
    expect([...blocked]).toEqual(['codex'])
    const catalogs = [
      {
        provider: 'codex' as const,
        models: [{ id: 'm', name: 'm', isDefault: true, efforts: [], defaultEffort: null } as never],
      },
      {
        provider: 'claude-code' as const,
        models: [{ id: 'c', name: 'c', isDefault: true, efforts: [], defaultEffort: null } as never],
      },
    ]
    const chain = [
      { id: '1', provider: 'codex' as const, model: 'm', effort: null },
      { id: '2', provider: 'claude-code' as const, model: 'c', effort: null },
    ]
    const context = { usage: [], catalogs, switchAt: 90 as never }
    expect(nextStep(chain, context)?.provider).toBe('codex')
    expect(nextStep(chain, { ...context, blocked })?.provider).toBe('claude-code')
    expect(nextStep(chain.slice(0, 1), { ...context, blocked })).toBeNull()
  })
})
