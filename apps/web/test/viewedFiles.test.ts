import { expect, it } from 'vitest'
import { diffSignature } from '../src/git/viewedFiles'

const file = (patch: string | null) => ({ patch, additions: 1, deletions: 0, status: 'modified' as const })

it('gives the same diff the same fingerprint and a changed one another, so a tick is for what was read', () => {
  expect(diffSignature(file('@@ -1 +1,2 @@\n a\n+b'))).toBe(diffSignature(file('@@ -1 +1,2 @@\n a\n+b')))
  expect(diffSignature(file('@@ -1 +1,2 @@\n a\n+b'))).not.toBe(diffSignature(file('@@ -1 +1,2 @@\n a\n+c')))
  expect(diffSignature(file(null))).toBe(diffSignature(file(null)))
  expect(diffSignature({ ...file(null), status: 'renamed' })).not.toBe(diffSignature(file(null)))
})
