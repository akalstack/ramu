import { expect, it } from 'vitest'
import { validatePolicy } from '@ramu/shared/providers/compatibility'
import { COMPATIBILITY_POLICY, COMPATIBILITY_RUNTIME } from '../src/providers/compatibilityPolicy'

it('the bundled policy is valid and only audited runtimes are evaluated', () => {
  expect(validatePolicy(COMPATIBILITY_POLICY)).toEqual([])
  expect(Object.keys(COMPATIBILITY_RUNTIME)).toEqual(['codex'])
})
