import { expect, it } from 'vitest'
import { githubTokenLink } from '../src/githubTokenLink'

it('opens GitHub’s fine-grained token form with Ramu’s name, an expiry and its permissions chosen', () => {
  const link = new URL(githubTokenLink())
  expect(link.origin + link.pathname).toBe('https://github.com/settings/personal-access-tokens/new')
  expect(link.searchParams.get('name')).toBe('Ramu')
  expect(link.searchParams.get('expires_in')).toBe('90')
  expect(link.searchParams.get('pull_requests')).toBe('write')
  expect(link.searchParams.get('checks')).toBe('read')
  expect(new URL(githubTokenLink('ghe.example.com')).host).toBe('ghe.example.com')
})
