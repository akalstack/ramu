import { expect, it } from 'vitest'
import { pullRequestLinkKey, pullRequestLinksFrom } from '../src/browserLinks'

it('recognises a pull or merge request on each service, whichever of its pages the link names', () => {
  expect(pullRequestLinkKey('https://github.com/Acme/Shop/pull/42')).toBe('github.com/acme/shop/pull/42')
  expect(pullRequestLinkKey('https://github.com/acme/shop/pull/42/files#diff-abc')).toBe('github.com/acme/shop/pull/42')
  expect(pullRequestLinkKey('https://gitlab.com/group/sub/shop/-/merge_requests/7/diffs')).toBe(
    'gitlab.com/group/sub/shop/-/merge_requests/7',
  )
  expect(pullRequestLinkKey('https://bitbucket.org/acme/shop/pull-requests/3')).toBe(
    'bitbucket.org/acme/shop/pull-requests/3',
  )
  expect(pullRequestLinkKey('https://dev.azure.com/acme/proj/_git/shop/pullrequest/9?_a=files')).toBe(
    'dev.azure.com/acme/proj/_git/shop/pullrequest/9',
  )
})

it('leaves every other link alone', () => {
  expect(pullRequestLinkKey('https://github.com/acme/shop/pulls')).toBeNull()
  expect(pullRequestLinkKey('https://github.com/acme/shop/issues/42')).toBeNull()
  expect(pullRequestLinkKey('https://github.com/acme/shop/pull/new')).toBeNull()
  expect(pullRequestLinkKey('ramu://pull/42')).toBeNull()
  expect(pullRequestLinkKey('not a link')).toBeNull()
})

it('opens pull requests in Ramu unless the person chose the service', () => {
  expect(pullRequestLinksFrom(null)).toBe('app')
  expect(pullRequestLinksFrom('anything')).toBe('app')
  expect(pullRequestLinksFrom('service')).toBe('service')
})
