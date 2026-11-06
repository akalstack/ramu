import { expect, it } from 'vitest'
import * as forge from '../src/workspace/forge'
import { forgeAdapter, registerForgeAdapter, type ForgeAdapter } from '../src/workspace/forge/adapter'

const OPERATIONS: (keyof ForgeAdapter)[] = [
  'repositoryAccount',
  'checkAccess',
  'pullRequestStatus',
  'pullRequestDraft',
  'createPullRequest',
  'checksFeedback',
  'listPullRequests',
  'mergeOptions',
  'pullRequestAction',
  'pullRequestBody',
  'reviewThreads',
  'replyToThread',
  'resolveThread',
  'requestReviews',
  'submitReview',
  'listIssues',
  'issueDetails',
  'publishRepository',
  'searchRepositories',
]

it('registers every hosting service behind the shared boundary, with every operation the facade offers', () => {
  for (const id of ['github', 'gitlab', 'bitbucket', 'azure'] as const) {
    const adapter = forgeAdapter(id)
    expect(adapter.id).toBe(id)
    for (const operation of OPERATIONS) {
      expect(typeof adapter[operation]).toBe('function')
      expect(typeof (forge as Record<string, unknown>)[operation]).toBe('function')
    }
  }
  expect(forge.forgeAdapter('github')).toBe(forgeAdapter('github'))
})

it('refuses a second adapter for the same provider and a provider with none', () => {
  expect(() => registerForgeAdapter(forgeAdapter('github'))).toThrow('already registered')
  expect(() => forgeAdapter('gitea' as never)).toThrow('No forge adapter')
})
