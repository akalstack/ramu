import { describe, expect, it } from 'vitest'
import { evaluateCompatibility, validatePolicy, type CompatibilityPolicy } from '../src/providers/compatibility'

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
      status: 'supported',
      evidence: 'protocol tests',
    },
    { id: 'dated', provider: 'cursor', runtime: 'cli', min: '2025.01.01-a', status: 'supported', evidence: 'smoke' },
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
          status: 'supported',
          evidence: 'x',
        },
        {
          id: 'b',
          provider: 'codex',
          runtime: 'app-server',
          min: '0.3.0',
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
})
