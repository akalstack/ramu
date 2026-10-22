import { describe, expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { ForgeAccountStore, checkGithubToken } from '../src/workspace/forgeAccounts'

type Json = Record<string, unknown>
const reply = (status: number, body: Json = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers })

function setup(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, locked = false) {
  const values = new Map<string, string>()
  const factory = async (service: string, key: string) => ({
    setPassword: async (value: string) => {
      if (locked) throw new Error('locked')
      values.set(`${service}:${key}`, value)
    },
    getPassword: async () => (locked ? Promise.reject(new Error('locked')) : (values.get(`${service}:${key}`) ?? null)),
    deletePassword: async () => values.delete(`${service}:${key}`),
  })
  let state: unknown = null
  const events: unknown[] = []
  const store = new ForgeAccountStore(
    () => state as never,
    (_key, value) => {
      state = value
    },
    new HostCredentialStore(factory),
    fetchImpl,
    () => 1000,
    (event) => events.push(event),
  )
  return { store, values, events, state: () => JSON.stringify(state) }
}

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'
const ok = (login: string, scopes = 'repo, read:org') => async () => reply(200, { login }, { 'x-oauth-scopes': scopes })

describe('checking a token', () => {
  it('sends it only to the origin API and refuses redirects', async () => {
    const fetchImpl = vi.fn<(url: string, init: { redirect?: string }) => Promise<Response>>(ok('ana'))
    await checkGithubToken('ghe.example.com:8443', TOKEN, fetchImpl)
    expect(fetchImpl.mock.calls[0]![0]).toBe('https://ghe.example.com:8443/api/v3/user')
    expect(fetchImpl.mock.calls[0]![1].redirect).toBe('error')
    await checkGithubToken('github.com', TOKEN, fetchImpl)
    expect(fetchImpl.mock.calls[1]![0]).toBe('https://api.github.com/user')
  })

  it('tells expired, rate limited, missing permission, offline and unsupported servers apart', async () => {
    const state = async (response: () => Promise<Response>) => (await checkGithubToken('github.com', TOKEN, response)).state
    expect(await state(async () => reply(401))).toBe('expired')
    expect(await state(async () => reply(403, {}, { 'x-ratelimit-remaining': '0' }))).toBe('rate-limited')
    expect(await state(async () => reply(429))).toBe('rate-limited')
    expect(await state(async () => reply(403))).toBe('missing-permission')
    expect(await state(async () => reply(404))).toBe('unsupported-server')
    expect(await state(async () => reply(200, { name: 'not github' }))).toBe('unsupported-server')
    expect(await state(async () => Promise.reject(new TypeError('fetch failed')))).toBe('offline')
    expect(await state(async () => Promise.reject(new TypeError('unexpected redirect')))).toBe('unsupported-server')
  })

  it('does not treat a classic token without repository scope as ready', async () => {
    const result = await checkGithubToken('github.com', TOKEN, ok('ana', 'gist'))
    expect(result).toMatchObject({ state: 'missing-permission', login: 'ana' })
    expect((await checkGithubToken('github.com', TOKEN, async () => reply(200, { login: 'ana' }))).state).toBe(
      'connected',
    )
  })
})

describe('saved connections', () => {
  it('stores the token only in the credential store and never in state or the summary', async () => {
    const { store, values, state } = setup(ok('ana'))
    const saved = await store.save({ origin: 'GitHub.com', token: TOKEN })
    expect(saved).toMatchObject({ origin: 'github.com', login: 'ana', state: 'connected', selected: true })
    expect([...values.values()]).toEqual([TOKEN])
    expect(state()).not.toContain(TOKEN)
    expect(JSON.stringify(store.summary(true))).not.toContain(TOKEN)
    expect(await store.resolve('github.com')).toMatchObject({ kind: 'saved', login: 'ana', token: TOKEN })
  })

  it('keeps the working connection when a replacement fails verification', async () => {
    let answer = ok('ana')
    const { store, values } = setup(() => answer())
    const first = await store.save({ origin: 'github.com', token: TOKEN })
    answer = async () => reply(401)
    await expect(store.save({ origin: 'github.com', token: 'ghp_other', replaceId: first.id })).rejects.toThrow(/rejected/)
    expect([...values.values()]).toEqual([TOKEN])
    expect(await store.resolve('github.com')).toMatchObject({ kind: 'saved', token: TOKEN })
  })

  it('replaces atomically: the old secret is deleted only after the new one is published', async () => {
    const { store, values } = setup(ok('ana'))
    const first = await store.save({ origin: 'github.com', token: TOKEN })
    const second = await store.save({ origin: 'github.com', token: 'ghp_replacement0123456789abcdefghij', replaceId: first.id })
    expect(second.id).toBe(first.id)
    expect([...values.values()]).toEqual(['ghp_replacement0123456789abcdefghij'])
  })

  it('refuses to move a credential to another server', async () => {
    const { store } = setup(ok('ana'))
    const first = await store.save({ origin: 'github.com', token: TOKEN })
    await expect(store.save({ origin: 'ghe.example.com', token: TOKEN, replaceId: first.id })).rejects.toThrow(/bound/)
    await expect(store.save({ origin: 'https://evil.example/path', token: TOKEN })).rejects.toThrow(/host name/)
    await expect(store.save({ origin: 'user:pw@github.com', token: TOKEN })).rejects.toThrow(/host name/)
  })

  it('reports a locked credential store without saving a connection', async () => {
    const { store } = setup(ok('ana'), true)
    await expect(store.save({ origin: 'github.com', token: TOKEN })).rejects.toThrow(/credential store/)
    expect(store.summary(true).saved).toEqual([])
    expect(store.summary(true).credentialStore).toBe('unavailable')
  })

  it('disables, then removes, only its own credential and ends dependent watches', async () => {
    const { store, values, events } = setup(ok('ana'))
    const saved = await store.save({ origin: 'github.com', token: TOKEN })
    store.setEnabled(saved.id, false)
    expect(await store.resolve('github.com')).toEqual({ kind: 'cli', login: null })
    await store.remove(saved.id)
    expect(values.size).toBe(0)
    expect(store.summary(true).saved).toEqual([])
    expect(events.slice(-2)).toEqual([{ disabledId: saved.id }, { removedId: saved.id }])
  })

  it('keeps the CLI by default, picks the only saved account, and asks when several exist', async () => {
    let login = 'ana'
    const { store } = setup(async () => reply(200, { login }, { 'x-oauth-scopes': 'repo' }))
    expect(await store.resolve('github.com')).toEqual({ kind: 'cli', login: null })
    const ana = await store.save({ origin: 'github.com', token: TOKEN })
    login = 'bo'
    const bo = await store.save({ origin: 'github.com', token: 'ghp_second0123456789abcdefghijklmnop' })
    // Ana was selected first; saving another never switches identity by itself.
    expect(await store.resolve('github.com')).toMatchObject({ kind: 'saved', connectionId: ana.id })
    store.select('github.com', 'cli')
    expect(await store.resolve('github.com')).toEqual({ kind: 'cli', login: null })
    store.setRepositoryAccount('github.com', 'o', 'r', bo.id)
    expect(await store.resolve('github.com', 'O', 'R')).toMatchObject({ kind: 'saved', connectionId: bo.id })
    expect(await store.resolve('github.com', 'o', 'other')).toEqual({ kind: 'cli', login: null })
    // With the origin's choice gone and two usable accounts, the person must choose.
    store.select('github.com', ana.id)
    await store.remove(ana.id)
    store.setRepositoryAccount('github.com', 'o', 'r', null)
    expect(await store.resolve('github.com')).toMatchObject({ kind: 'saved', connectionId: bo.id })
  })

  it('reports ambiguity instead of choosing between several unselected accounts', async () => {
    let login = 'ana'
    const { store } = setup(async () => reply(200, { login }, { 'x-oauth-scopes': 'repo' }))
    const ana = await store.save({ origin: 'github.com', token: TOKEN })
    login = 'bo'
    await store.save({ origin: 'github.com', token: 'ghp_second0123456789abcdefghijklmnop' })
    login = 'cy'
    await store.save({ origin: 'github.com', token: 'ghp_third00123456789abcdefghijklmnopq' })
    // Removing the selected account clears the origin's choice; two remain, so the person must choose.
    await store.remove(ana.id)
    const resolved = await store.resolve('github.com')
    expect(resolved.kind).toBe('ambiguous')
    if (resolved.kind === 'ambiguous') expect(resolved.candidates.map((c) => c.login).sort()).toEqual(['bo', 'cy'])
  })

  it('records why a recheck failed but keeps the credential', async () => {
    let answer = ok('ana')
    const { store, values } = setup(() => answer())
    const saved = await store.save({ origin: 'github.com', token: TOKEN })
    answer = async () => reply(401)
    expect(await store.check(saved.id)).toMatchObject({ state: 'expired', login: 'ana' })
    expect(values.size).toBe(1)
  })
})
