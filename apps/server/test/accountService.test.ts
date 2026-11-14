import { describe, expect, it, vi } from 'vitest'
import { HostCredentialStore } from '../src/credentials/store'
import { AccountService } from '../src/account/service'
import type { SettingsExport } from '@ramu/shared/settingsTransfer'

/** An in-memory stand-in for the account service, enough for this host's side: it stores what it is sent, unread. */
function fakeService() {
  const backups = new Map<
    string,
    { label: string; versions: { id: string; ciphertext: string; createdAt: number }[] }
  >()
  let recovery: string | null = null
  const requests = new Map<string, Record<string, unknown>>()
  const listed: Record<string, unknown>[] = []
  const relayed: { id: string; path: string; body: unknown; from: string; account: string }[] = []
  const replies: { id: string; reply: unknown }[] = []
  let next = 1
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
    const path = url.pathname
    if (path === '/api/me') return json({ id: 'u1', name: 'Ada', email: 'ada@example.com', image: null })
    if (path === '/api/hosts' && method === 'PUT') {
      listed.push(body)
      return json({ id: '00000000-0000-4000-8000-0000000000aa' })
    }
    const messages = /^\/api\/hosts\/[^/]+\/messages(?:\/([^/]+))?$/.exec(path)
    if (messages && method === 'GET') return json(relayed.splice(0))
    if (messages && method === 'POST') {
      replies.push({ id: messages[1]!, reply: body.reply })
      return json({ ok: true })
    }
    if (path === '/api/recovery') {
      if (method === 'PUT') recovery = body.sealed as string
      return json({ sealed: recovery })
    }
    const backup = /^\/api\/backups\/([0-9a-f]{32})(?:\/(\d+))?$/.exec(path)
    if (path === '/api/backups')
      return json(
        [...backups].map(([slot, entry]) => ({
          slot,
          kind: 'host',
          label: entry.label,
          versions: entry.versions.map(({ id, createdAt }) => ({ id, size: 1, createdAt })),
        })),
      )
    if (backup && method === 'PUT') {
      const entry = backups.get(backup[1]!) ?? { label: '', versions: [] }
      entry.label = body.label as string
      entry.versions.unshift({ id: String(next++), ciphertext: body.ciphertext as string, createdAt: Date.now() })
      backups.set(backup[1]!, entry)
      return json({ id: entry.versions[0]!.id })
    }
    if (backup && backup[2])
      return json({ ciphertext: backups.get(backup[1]!)!.versions.find((v) => v.id === backup[2])!.ciphertext })
    if (path === '/api/key-requests' && method === 'POST') {
      const id = `00000000-0000-4000-8000-00000000000${next++}`
      requests.set(id, {
        id,
        name: body.name,
        commit: body.commit,
        requesterKey: null,
        approverKey: null,
        envelope: null,
        expiresAt: Date.now() + 600_000,
      })
      return json({ id })
    }
    if (path === '/api/key-requests') return json([...requests.values()])
    const request = /^\/api\/key-requests\/([^/]+)(?:\/(offer|reveal|approve))?$/.exec(path)
    if (request) {
      const entry = requests.get(request[1]!)!
      if (request[2] === 'offer') entry.approverKey = body.approverKey
      if (request[2] === 'reveal') entry.requesterKey = body.requesterKey
      if (request[2] === 'approve') entry.envelope = body.envelope
      return json(entry)
    }
    return json({ error: `unexpected ${method} ${path}` }, 404)
  })
  return { fetcher, backups, listed, relayed, replies }
}

const file: SettingsExport = {
  format: 'ramu-settings',
  version: 1,
  exportedAt: 1,
  host: 'ada-mac',
  groups: ['appearance'],
  preferences: { accent: 'teal' },
}

function host(
  service: ReturnType<typeof fakeService>,
  name = 'ada-mac',
  pairing: (peer: string, path: string, body: unknown) => Promise<{ status: number; body: unknown }> = async () => ({
    status: 200,
    body: {},
  }),
) {
  const state = new Map<string, unknown>()
  const vault = new Map<string, string>()
  const account = new AccountService({
    getState: (key, fallback) => (state.has(key) ? (structuredClone(state.get(key)) as never) : fallback),
    setState: (key, value) => void state.set(key, structuredClone(value)),
    hostName: () => name,
    hostId: 'host-1234567890abcdef',
    exportSettings: async () => file,
    githubToken: async () => null,
    pairing,
    changed: () => {},
    credentials: new HostCredentialStore(async (_service, key) => ({
      setPassword: async (value) => void vault.set(key, value),
      getPassword: async () => vault.get(key) ?? null,
      deletePassword: async () => vault.delete(key),
    })),
    fetch: service.fetcher,
    url: 'https://account.test',
  })
  return { account, state, vault }
}

async function signedIn(service: ReturnType<typeof fakeService>, name?: string, pairing?: Parameters<typeof host>[2]) {
  const made = host(service, name, pairing)
  // As after the device code sign-in: a session token in the credential store and the user in state.
  await (made.account as unknown as { session: { save(value: { token: string }): Promise<void> } }).session.save({
    token: 'session-token',
  })
  made.state.set('account:v1', {
    ...(made.state.get('account:v1') as object),
    user: { id: 'u1', name: 'Ada', email: 'ada@example.com', image: null },
  })
  return made
}

describe('settings backup on this host', () => {
  it('seals the settings before upload and restores them with the recovery code on a new host', async () => {
    const service = fakeService()
    const first = await signedIn(service)
    const { recoveryCode } = await first.account.setBackup({ account: true })
    expect(recoveryCode).toMatch(/^([0-9A-Z]{4}-){7}[0-9A-Z]{4}$/)
    const [entry] = [...service.backups.values()]
    expect(entry!.versions).toHaveLength(1)
    // The service only ever sees ciphertext.
    expect(Buffer.from(entry!.versions[0]!.ciphertext, 'base64').toString('latin1')).not.toMatch(/teal|accent/)
    expect(JSON.stringify([...first.state.values()])).not.toContain(recoveryCode!)

    const second = await signedIn(service, 'new-mac')
    await expect(second.account.restoreChoices()).rejects.toThrow(/backup key first/)
    await expect(second.account.useRecoveryCode('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'account')).rejects.toThrow(
      /does not open/,
    )
    await second.account.useRecoveryCode(recoveryCode!.toLowerCase(), 'account')
    const [choice] = await second.account.restoreChoices()
    expect(choice).toMatchObject({ source: 'account', name: 'ada-mac', kind: 'host' })
    expect(
      await second.account.restoreFile({ source: 'account', slot: choice!.slot, version: choice!.versions[0]!.id }),
    ).toEqual(file)
  })

  it('hands the key to a new host after both show the same number', async () => {
    const service = fakeService()
    const trusted = await signedIn(service)
    await trusted.account.setBackup({ account: true })
    const fresh = await signedIn(service, 'new-mac')
    vi.useFakeTimers()
    try {
      await fresh.account.requestKey()
      const [request] = await trusted.account.keyRequests()
      expect(request).toMatchObject({ name: 'new-mac', code: null })
      await trusted.account.answerKeyRequest(request!.id)
      await vi.advanceTimersByTimeAsync(2_100)
      const shown = fresh.account.keyRequestState()!.code
      const [answered] = await trusted.account.keyRequests()
      expect(shown).toMatch(/^\d{3} \d{3}$/)
      expect(answered!.code).toBe(shown)
      await trusted.account.approveKeyRequest(request!.id)
      await vi.advanceTimersByTimeAsync(2_100)
      expect(fresh.account.keyRequestState()).toMatchObject({ done: true, error: null })
    } finally {
      vi.useRealTimers()
    }
    const [choice] = await fresh.account.restoreChoices()
    expect(
      await fresh.account.restoreFile({ source: 'account', slot: choice!.slot, version: choice!.versions[0]!.id }),
    ).toEqual(file)
  })

  it('signing out removes this host’s session and its copy of the key', async () => {
    const service = fakeService()
    const made = await signedIn(service)
    await made.account.setBackup({ account: true })
    expect((await made.account.status()).backup.hasKey).toBe(true)
    await made.account.signOut()
    expect(await made.account.status()).toMatchObject({ signedIn: false, backup: { hasKey: false } })
    expect(made.vault.size).toBe(0)
  })
})

describe('Your hosts on this host', () => {
  it('lets the account’s devices in with the access chosen here, until one of them is removed', async () => {
    const service = fakeService()
    const { account } = await signedIn(service)
    const paired = new Set<string>()
    const stillPaired = (id: string) => paired.has(id)
    // Not listed: every relayed request asks the person here.
    expect(account.trustFor('account:phone', stillPaired)).toBeNull()
    await account.setListed(true)
    account.close()
    // Listing defaults to connecting the account's devices with full access, and tells the account so.
    expect(service.listed.at(-1)).toMatchObject({ hostKey: 'host-1234567890abcdef', trust: 'owner' })
    expect((await account.status()).trust).toBe('owner')
    expect(account.trustFor('account:phone', stillPaired)).toBe('owner')
    // Only relayed requests: a nearby address is never let in this way.
    expect(account.trustFor('192.168.1.50', stillPaired)).toBeNull()

    await account.setTrust('viewer')
    account.close()
    expect(service.listed.at(-1)).toMatchObject({ trust: 'viewer' })
    expect(account.trustFor('account:phone', stillPaired)).toBe('viewer')

    account.pairedOnItsOwn('account:phone', 'device-1')
    paired.add('device-1')
    expect(account.trustFor('account:phone', stillPaired)).toBe('viewer')
    // Removed here (or from the CLI, or expired): that device asks the person next time; others still connect.
    paired.delete('device-1')
    expect(account.trustFor('account:phone', stillPaired)).toBeNull()
    expect(account.trustFor('account:laptop', stillPaired)).toBe('viewer')

    await account.setTrust('ask')
    expect(account.trustFor('account:laptop', stillPaired)).toBeNull()
    account.close()
  })

  it('answers only relayed messages from its own account', async () => {
    const service = fakeService()
    const seen: string[] = []
    const { account } = await signedIn(service, 'ada-mac', async (peer) => {
      seen.push(peer)
      return { status: 200, body: { ok: true } }
    })
    await account.setListed(true)
    account.close()
    service.relayed.push(
      { id: 'm1', path: '/pair/request', body: {}, from: 'phone', account: 'u1' },
      { id: 'm2', path: '/pair/request', body: {}, from: 'stranger', account: 'u2' },
    )
    await account.checkRelay()
    expect(seen).toEqual(['account:phone'])
    expect(service.replies.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'm1', reply: { status: 200, body: { ok: true } } },
      { id: 'm2', reply: { status: 403, body: { error: 'This host is listed under another Ramu account.' } } },
    ])
  })
})
