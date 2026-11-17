import { describe, expect, it } from 'vitest'
import {
  automaticallyInstallable,
  evaluateCompatibility,
  nextMajor,
  validatePolicy,
  type CompatibilityPolicy,
} from '../src/providers/compatibility'

const policy: CompatibilityPolicy = {
  revision: 3,
  rules: [
    {
      id: 'old',
      provider: 'codex',
      runtime: 'app-server',
      below: '0.40.0',
      status: 'incompatible',
      affects: ['resume'],
      recommend: '0.50.0',
      evidence: 'handshake rejected',
    },
    {
      id: 'ok',
      provider: 'codex',
      runtime: 'app-server',
      min: '0.40.0',
      below: '1.0.0',
      tested: '0.45.0',
      status: 'supported',
      evidence: 'protocol tests',
    },
    {
      id: 'dated',
      provider: 'cursor',
      runtime: 'cli',
      min: '2025.01.01-a',
      tested: '2025.01.01-a',
      status: 'supported',
      evidence: 'smoke',
    },
  ],
}

describe('provider compatibility', () => {
  it('honours range boundaries: min inclusive, below exclusive', () => {
    const at = (v: string) => evaluateCompatibility(policy, 'codex', 'app-server', v).status
    expect(at('0.39.9')).toBe('incompatible')
    expect(at('0.40.0')).toBe('supported')
    expect(at('0.99.9')).toBe('supported')
    expect(at('1.0.0')).toBe('unverified')
  })

  it('returns the affected features and recommendation for an incompatible runtime', () => {
    expect(evaluateCompatibility(policy, 'codex', 'app-server', '0.10.0')).toMatchObject({
      status: 'incompatible',
      affects: ['resume'],
      recommend: '0.50.0',
      policyRevision: 3,
      ruleId: 'old',
    })
  })

  it('stays Unverified for unknown providers, runtimes, missing or mixed-style versions', () => {
    expect(evaluateCompatibility(policy, 'claude-code', 'sdk', '1.0.0').reason).toBe('no-rule')
    expect(evaluateCompatibility(policy, 'codex', 'cli', '0.5.0').reason).toBe('no-rule')
    expect(evaluateCompatibility(policy, 'codex', 'app-server', null).reason).toBe('version-unknown')
    expect(evaluateCompatibility(policy, 'codex', 'app-server', '2025.01.02-x').reason).toBe('version-unparsed')
    expect(evaluateCompatibility(policy, 'cursor', 'cli', '2025.02.01-b').status).toBe('supported')
    expect(evaluateCompatibility(policy, 'cursor', 'cli', '0.1.0').reason).toBe('version-unparsed')
  })

  it('treats prereleases as older than the release they precede', () => {
    expect(evaluateCompatibility(policy, 'codex', 'app-server', '0.40.0-beta.1').status).toBe('incompatible')
  })

  it('validates the bundled shape: accepts a clean policy and flags conflicts', () => {
    expect(validatePolicy(policy)).toEqual([])
    const bad: CompatibilityPolicy = {
      revision: 1,
      rules: [
        {
          id: 'a',
          provider: 'codex',
          runtime: 'app-server',
          min: '0.1.0',
          below: '0.5.0',
          tested: '0.2.0',
          status: 'supported',
          evidence: 'x',
        },
        {
          id: 'b',
          provider: 'codex',
          runtime: 'app-server',
          min: '0.3.0',
          tested: '0.3.0',
          status: 'limited',
          recommend: '9.9.9',
          evidence: 'y',
        },
        {
          id: 'c',
          provider: 'codex',
          runtime: 'app-server',
          min: '2.0.0',
          below: '1.0.0',
          status: 'supported',
          evidence: '',
        },
      ],
    }
    const problems = validatePolicy(bad).join('\n')
    expect(problems).toContain('a and b')
    expect(problems).toContain('b: recommendation 9.9.9')
    expect(problems).toContain('c: empty range')
    expect(problems).toContain('c: evidence is required')
  })

  it('covers a release line: patches and minors after the tested release, not the next major', () => {
    const at = (v: string) => evaluateCompatibility(policy, 'codex', 'app-server', v)
    expect(at('0.46.3')).toMatchObject({ status: 'supported', testedVersion: '0.45.0' })
    expect(at('1.0.0')).toMatchObject({ status: 'unverified', reason: 'newer-than-tested', testedVersion: '0.45.0' })
    expect(nextMajor('2.1.308')).toBe('3.0.0')
    expect(nextMajor('0.167.0')).toBe('1.0.0')
    expect(nextMajor('2026.11.05-abc')).toBeNull()
  })

  it('rejects working rules that claim an untested major or no tested release; date versions may stay open', () => {
    const rule = { provider: 'codex', runtime: 'app-server', status: 'supported', evidence: 'probe' } as const
    const problems = validatePolicy({
      revision: 1,
      rules: [
        { ...rule, id: 'open', min: '2.0.0', tested: '2.1.0' },
        { ...rule, id: 'wide', provider: 'opencode', min: '2.0.0', below: '4.0.0', tested: '2.1.0' },
        { ...rule, id: 'untested', provider: 'claude-code', min: '1.0.0', below: '2.0.0' },
        { ...rule, id: 'outside', provider: 'antigravity', min: '1.0.0', below: '2.0.0', tested: '2.0.0' },
      ],
    }).join('\n')
    expect(problems).toContain('open: a supported range ends by 3.0.0')
    expect(problems).toContain('wide: a supported range ends by 3.0.0')
    expect(problems).toContain('untested: a supported rule names the release it was tested on')
    expect(problems).toContain('outside: tested 2.0.0 is outside its range')
    expect(validatePolicy(policy)).toEqual([])
  })

  it('lets automatic updates install within a tested line only', () => {
    const at = (v: string) => evaluateCompatibility(policy, 'codex', 'app-server', v)
    expect(automaticallyInstallable(at('0.99.0'))).toBe(true)
    expect(automaticallyInstallable(at('1.0.0'))).toBe(false)
    expect(automaticallyInstallable(at('0.10.0'))).toBe(false)
    expect(automaticallyInstallable(null)).toBe(true)
  })
})
