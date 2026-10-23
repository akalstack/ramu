import { expect, it } from 'vitest'
import * as forge from '../src/workspace/forge'
import { forgeAdapter, registerForgeAdapter, type ForgeAdapter } from '../src/workspace/forge/adapter'

const OPERATIONS: (keyof ForgeAdapter)[] = [
  'repositoryAccount',
  'checkAccess',
  'pullRequestStatus',
  'pullRequestDraft',
  'createPullRequest',
  'pullRequestFeedback',
  'listIssues',
  'issueDetails',
  'publishRepository',
  'searchRepositories',
]

it('registers GitHub behind the shared boundary, with every operation the facade offers', () => {
  const github = forgeAdapter('github')
  expect(github.id).toBe('github')
  for (const operation of OPERATIONS) expect(typeof github[operation]).toBe('function')
  // The facade and the adapter are the same implementation, not two copies.
  expect(github.pullRequestStatus).toBe(forge.pullRequestStatus)
  expect(github.searchRepositories).toBe(forge.searchRepositories)
  expect(forge.forgeAdapter('github')).toBe(github)
})

it('refuses a second adapter for the same provider and a provider with none', () => {
  expect(() => registerForgeAdapter(forgeAdapter('github'))).toThrow('already registered')
  expect(() => forgeAdapter('gitlab' as never)).toThrow('No forge adapter')
})
