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
