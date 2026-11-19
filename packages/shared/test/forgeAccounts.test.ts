import { expect, it } from 'vitest'
import { parseGhAuthStatus } from '../src/forgeAccounts'

const SIGNED_IN = `github.com
  ✓ Logged in to github.com account ahxar (keyring)
  - Active account: true
  - Git operations protocol: ssh
  - Token: gho_************************************
  - Token scopes: 'admin:public_key', 'gist', 'read:org', 'repo'
`

it('reads the host, login, protocol and scopes, and never the token', () => {
  const accounts = parseGhAuthStatus(SIGNED_IN)
  expect(accounts).toEqual([
    {
      host: 'github.com',
      login: 'ahxar',
      active: true,
      state: 'ok',
      protocol: 'ssh',
      scopes: ['admin:public_key', 'gist', 'read:org', 'repo'],
    },
  ])
  expect(JSON.stringify(accounts)).not.toContain('gho_')
})

it('keeps several accounts and hosts apart, with the active one marked', () => {
  const text = `${SIGNED_IN}  ✓ Logged in to github.com account work (keyring)
  - Active account: false
  - Git operations protocol: https
  - Token scopes: 'repo'
ghe.example.com
  ✓ Logged in to ghe.example.com account corp (keyring)
  - Active account: true
`
  const accounts = parseGhAuthStatus(text)
  expect(accounts.map((a) => [a.host, a.login, a.active])).toEqual([
    ['github.com', 'ahxar', true],
    ['github.com', 'work', false],
    ['ghe.example.com', 'corp', true],
  ])
  expect(accounts[1]).toMatchObject({ protocol: 'https', scopes: ['repo'] })
})

it('marks an expired token invalid and treats empty or unrelated output as no accounts', () => {
  const failed = `github.com
  X Failed to log in to github.com account ahxar (keyring)
  - Active account: true
  - The token in keyring is invalid.
`
  expect(parseGhAuthStatus(failed)).toMatchObject([{ login: 'ahxar', state: 'invalid', active: true }])
  expect(parseGhAuthStatus('')).toEqual([])
  expect(parseGhAuthStatus('You are not logged into any GitHub hosts. To log in, run: gh auth login')).toEqual([])
})
