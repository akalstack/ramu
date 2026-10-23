import { expect, it } from 'vitest'
import { evaluateCompatibility, validatePolicy } from '@ramu/shared/providers/compatibility'
import { COMPATIBILITY_POLICY, COMPATIBILITY_RUNTIME } from '../src/providers/compatibilityPolicy'

it('the bundled policy is valid and only audited runtimes are evaluated', () => {
  expect(validatePolicy(COMPATIBILITY_POLICY)).toEqual([])
  expect(Object.keys(COMPATIBILITY_RUNTIME)).toEqual(['codex'])
})

it('marks the exact Codex release that was probed as supported and every other release unverified', () => {
  const evaluate = (observedVersion: string | null) =>
    evaluateCompatibility(COMPATIBILITY_POLICY, 'codex', 'app-server', observedVersion)
  expect(evaluate('0.163.0')).toMatchObject({ status: 'supported', ruleId: 'codex-app-server-0.163.0' })
  expect(evaluate('0.163.1').status).toBe('unverified')
  expect(evaluate('0.162.9').status).toBe('unverified')
  expect(evaluate(null).status).toBe('unverified')
})
