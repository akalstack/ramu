import { expect, it } from 'vitest'
import { compatibilitySummary, evaluateCompatibility, validatePolicy } from '@ramu/shared/providers/compatibility'
import { COMPATIBILITY_POLICY, COMPATIBILITY_RUNTIME } from '../src/providers/compatibilityPolicy'

it('the bundled policy is valid and only audited runtimes are evaluated', () => {
  expect(validatePolicy(COMPATIBILITY_POLICY)).toEqual([])
  expect(Object.keys(COMPATIBILITY_RUNTIME)).toEqual(['codex', 'opencode', 'claude-code', 'antigravity'])
})

it('marks the exact Codex release that was probed as supported and every other release unverified', () => {
  const evaluate = (observedVersion: string | null) =>
    evaluateCompatibility(COMPATIBILITY_POLICY, 'codex', 'app-server', observedVersion)
  expect(evaluate('0.163.0')).toMatchObject({ status: 'supported', ruleId: 'codex-app-server-0.163.0' })
  expect(evaluate('0.162.1')).toMatchObject({ status: 'supported', ruleId: 'codex-app-server-0.162.1' })
  expect(evaluate('0.150.0')).toMatchObject({ status: 'supported', ruleId: 'codex-app-server-0.150.0' })
  expect(evaluate('0.163.1').status).toBe('unverified')
  expect(evaluate('0.162.0').status).toBe('unverified')
  expect(evaluate('0.151.0').status).toBe('unverified')
  expect(evaluate('0.162.9').status).toBe('unverified')
  expect(evaluate(null).status).toBe('unverified')
})

it('says a release newer than anything tested is newer, not merely unknown', () => {
  const result = evaluateCompatibility(COMPATIBILITY_POLICY, 'codex', COMPATIBILITY_RUNTIME.codex!, '99.0.0')
  expect(result).toMatchObject({ status: 'unverified', reason: 'newer-than-tested', testedVersion: '0.167.0' })
  expect(compatibilitySummary(result).values).toEqual({ '0': '0.167.0' })
  expect(evaluateCompatibility(COMPATIBILITY_POLICY, 'codex', COMPATIBILITY_RUNTIME.codex!, '0.100.0').reason).toBe(
    'no-rule',
  )
})

it('marks the OpenCode 2 release that was probed as supported; OpenCode 1 and other releases stay unverified', () => {
  const evaluate = (version: string | null) =>
    evaluateCompatibility(COMPATIBILITY_POLICY, 'opencode', COMPATIBILITY_RUNTIME.opencode!, version)
  expect(evaluate('2.1.3')).toMatchObject({ status: 'supported', ruleId: 'opencode-http-2.1.3' })
  expect(evaluate('2.1.4').status).toBe('unverified')
  expect(evaluate('1.4.0').status).toBe('unverified')
})

it('marks the Claude Code executable that was probed with the pinned SDK as supported; other releases stay unverified', () => {
  const evaluate = (version: string | null) =>
    evaluateCompatibility(COMPATIBILITY_POLICY, 'claude-code', COMPATIBILITY_RUNTIME['claude-code']!, version)
  expect(evaluate('2.1.308')).toMatchObject({ status: 'supported', ruleId: 'claude-code-sdk-2.1.308' })
  expect(evaluate('2.1.309').status).toBe('unverified')
  expect(evaluate('2.1.0').status).toBe('unverified')
  expect(evaluate(null).status).toBe('unverified')
})

it('evaluates the Antigravity ACP runtime it was probed on, and leaves other releases unverified', () => {
  const evaluate = (version: string | null) =>
    evaluateCompatibility(COMPATIBILITY_POLICY, 'antigravity', COMPATIBILITY_RUNTIME.antigravity!, version)
  expect(COMPATIBILITY_RUNTIME.antigravity).toBe('acp')
  expect(evaluate('1.4.3')).toMatchObject({ status: 'supported', ruleId: 'antigravity-acp-1.4.3' })
  expect(evaluate('1.4.4').status).toBe('unverified')
  expect(evaluate(null).status).toBe('unverified')
})
