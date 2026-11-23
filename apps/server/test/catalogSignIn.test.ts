import { beforeEach, expect, it, vi } from 'vitest'

const acpModels = vi.fn(async () => [])
const signInState = vi.fn(async () => ({ signedIn: false }))
vi.mock('../src/providers/acp', () => ({ acpModels }))
vi.mock('../src/providers/adapters', () => ({ providerAdapter: () => ({ signInState }) }))
vi.mock('../src/providers/providerBinaries', () => ({ providerEnvironment: () => ({}) }))

const { discoverCatalogs } = await import('../src/agent/catalog')
const onlyAntigravity = {
  providerOff: (provider: string) => provider !== 'antigravity',
  providerQuery: (() => {
    throw new Error('not used')
  }) as never,
}

beforeEach(() => {
  acpModels.mockClear()
})

it('does not start Antigravity at launch without a login, since its runtime would open a sign-in page', async () => {
  signInState.mockResolvedValueOnce({ signedIn: false })
  const catalogs = await discoverCatalogs(onlyAntigravity)
  expect(acpModels).not.toHaveBeenCalled()
  expect(catalogs.find((catalog) => catalog.provider === 'antigravity')).toMatchObject({
    models: [],
    error: expect.stringContaining('Sign in'),
  })
})

it('lists Antigravity models once it has a login', async () => {
  signInState.mockResolvedValueOnce({ signedIn: true })
  await discoverCatalogs(onlyAntigravity)
  expect(acpModels).toHaveBeenCalledWith('antigravity')
})
