import { expect, it } from 'vitest'
import { isProtectedBranch } from '../src/protectedBranch'

it('protects the default branch and common environment branches by whole name', () => {
  for (const name of [
    'main',
    'master',
    'dev',
    'develop',
    'development',
    'stg',
    'staging',
    'prod',
    'production',
    'Production',
  ])
    expect(isProtectedBranch(name)).toBe(true)
  expect(isProtectedBranch('trunk', 'trunk')).toBe(true)
})

it('leaves feature branches alone, even when they mention an environment', () => {
  for (const name of ['GENESIS-20602-DEV', 'epic/GENESIS-20605', 'safar/test', 'feature/prod-fix'])
    expect(isProtectedBranch(name, 'main')).toBe(false)
  expect(isProtectedBranch(null)).toBe(false)
})

it('round-trips branch-specific sync approval through a transport error message and rejects malformed payloads', async () => {
  const { readSyncConfirmation, syncConfirmationMessage } = await import('../src/protectedBranch')
  const approval = { branch: 'feature', targetBranch: 'main', oid: 'a'.repeat(40) }
  expect(readSyncConfirmation(new Error(syncConfirmationMessage(approval)))).toEqual(approval)
  expect(readSyncConfirmation(`Error: ${syncConfirmationMessage(approval)}`)).toEqual(approval)
  for (const message of [
    'offline',
    'Protected branch confirmation required: {}',
    'Protected branch confirmation required: null',
  ])
    expect(readSyncConfirmation(message)).toBeNull()
})
