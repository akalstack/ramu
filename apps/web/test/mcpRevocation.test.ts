import { expect, it } from 'vitest'
import { revocationNotice } from '../src/settings/mcpRevocation'

it('never lets a deleted copy pass for a revoked token', () => {
  expect(revocationNotice('revoked')).toMatch(/told to revoke/)
  expect(revocationNotice('unsupported')).toMatch(/no way to revoke/)
  expect(revocationNotice('failed')).toMatch(/could not be asked/)
  // Nothing was signed in, so there is nothing to say; an older host returns nothing at all.
  expect(revocationNotice('none')).toBeNull()
  expect(revocationNotice(undefined)).toBeNull()
})
