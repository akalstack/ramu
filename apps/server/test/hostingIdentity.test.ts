import { describe, expect, it } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { HostingAccounts } from '../src/workspace/deploy/accounts'

describe('several accounts of one hosting platform', () => {
  it('uses the identity’s own account in its projects, the shared one elsewhere, and removes only what was asked', async () => {
    const state = new Map<string, unknown>()
    const vault = new Map<string, string>()
    const accounts = new HostingAccounts(
      (key, fallback) => (state.has(key) ? (state.get(key) as never) : fallback),
      (key, value) => void state.set(key, value),
      new HostCredentialStore(async (_service, key) => ({
        setPassword: async (value) => void vault.set(key, value),
        getPassword: async () => vault.get(key) ?? null,
        deletePassword: async () => vault.delete(key),
      })),
      fetch,
      {},
      () => ({
        name: 'Vercel',
        tokenPage: 'https://vercel.com/account/tokens',
        kind: 'hosting',
        account: async ({ token }) => ({
          id: `acct-${token}`,
          name: token,
          defaultScope: null,
          broadScope: null,
          expiresAt: null,
        }),
      }),
    )
    accounts.identityOf = (projectId) =>
      projectId === 'client-site' ? 'globex' : projectId === 'blog' ? 'personal' : null
    await accounts.save('vercel', { token: 'mine-token' }, 'token')
    await accounts.save('vercel', { token: 'globex-token' }, 'token', 'globex')
    expect((await accounts.auth('vercel', 'client-site')).auth.token).toBe('globex-token')
    expect((await accounts.auth('vercel', 'blog')).auth.token).toBe('mine-token')
    expect((await accounts.auth('vercel')).auth.token).toBe('mine-token')
    expect(accounts.ownFor('vercel', 'client-site')).toBe(true)
    const listed = await accounts.list(false, () => false)
    expect(listed.filter((entry) => entry.platform === 'vercel').map((entry) => entry.identityId ?? 'shared')).toEqual([
      'shared',
      'globex',
    ])
    await accounts.disconnect('vercel', 'globex')
    expect((await accounts.auth('vercel', 'client-site')).auth.token).toBe('mine-token')
    expect(accounts.connected('vercel')).toBe(true)
  })
})
