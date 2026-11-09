// A media key from Settings › Media to a finished ability call: the key is checked with the service and kept in the
// credential store, the host then lists the service as connected, an ability call runs on that key, and after
// Disconnect the same call is refused with where to save one. Only the network is faked.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AgentSessionInfo,
} from '@ramu/shared/types'
import { MEDIA_SERVICES } from '@ramu/shared/types/deploy'

const GOOD_KEY = 'el-good-key-123'
const requests: { url: string; key: string | null; body?: string }[] = []
vi.stubGlobal('fetch', async (input: string | URL, init: RequestInit = {}) => {
  const url = String(input)
  const key = new Headers(init.headers).get('xi-api-key')
  requests.push({ url, key, ...(typeof init.body === 'string' ? { body: init.body } : {}) })
  if (!url.startsWith('https://api.elevenlabs.io/v1/')) return new Response('unexpected', { status: 500 })
  if (key !== GOOD_KEY) return Response.json({ detail: { message: 'Invalid API key' } }, { status: 401 })
  if (url.endsWith('/models')) return Response.json([{ model_id: 'eleven_multilingual_v2' }])
  return new Response(Buffer.from('ID3-fake-mp3'), { headers: { 'Content-Type': 'audio/mpeg' } })
})

const { HostCredentialStore } = await import('../src/credentials/store')
const { HostingAccounts } = await import('../src/workspace/deploy/accounts')
const { AbilityService } = await import('../src/agent/abilities')
const { AttachmentStore } = await import('../src/attachments')
type Host = ConstructorParameters<typeof AbilityService>[0]

let root: string
let events: AgentEvent[]

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-media-key-')))
  mkdirSync(join(root, 'project'))
  events = []
  requests.length = 0
  vi.stubEnv('RAMU_FAKE_AGENT', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

function setup() {
  const secrets = new Map<string, string>()
  const credentials = new HostCredentialStore(async (_service, key) => ({
    setPassword: async (value: string) => void secrets.set(key, value),
    getPassword: async () => secrets.get(key) ?? null,
    deletePassword: async () => secrets.delete(key),
  }))
  credentials.verify = async () => {}
  const state = new Map<string, unknown>()
  const accounts = new HostingAccounts(
    (key, fallback) => (state.get(key) ?? fallback) as never,
    (key, value) => void state.set(key, value),
    credentials,
  )
  const host: Host = {
    preferences: () => structuredClone(DEFAULT_APP_PREFERENCES),
    catalog: async () => [],
    session: () =>
      ({
        id: 'thread',
        taskId: 'task',
        provider: 'claude-code',
        settings: { ...DEFAULT_AGENT_SETTINGS, provider: 'claude-code' },
        cwd: join(root, 'project'),
      }) as AgentSessionInfo,
    events: () => events,
    record: (_id, event) => void events.push(event),
    requestPermission: async () => true,
    attachments: new AttachmentStore(join(root, 'attachments')),
    search: async () => [],
    login: async () => null,
    readChecks: () => [],
    writeChecks: () => {},
    // Wired as the host wires it (apps/server/src/index.ts).
    media: {
      connected: () => MEDIA_SERVICES.filter((service) => accounts.connected(service)),
      auth: async (service) => (await accounts.auth(service)).auth,
    },
  }
  const abilities = new AbilityService(
    host,
    async () => ({ text: '', images: [], sources: [] }),
    () => [],
  )
  return { accounts, abilities, secrets, state }
}

const recorded = () => (events.at(-1) as Extract<AgentEvent, { kind: 'ability' }>).call

it('a saved key makes speech on that service, and Disconnect sends the person back to Settings › Media', async () => {
  const { accounts, abilities, secrets, state } = setup()

  // A refused key is not kept, and the error says where to replace it.
  await expect(accounts.save('elevenlabs', { token: 'wrong-key-000' }, 'token')).rejects.toThrow('Settings → Media')
  expect(accounts.connected('elevenlabs')).toBe(false)

  const shown = await accounts.save('elevenlabs', { token: GOOD_KEY }, 'token')
  expect(shown).toMatchObject({ platform: 'elevenlabs', kind: 'media', connected: true })
  expect([...secrets.values()].join()).toContain(GOOD_KEY)
  expect(JSON.stringify([...state.values()])).not.toContain(GOOD_KEY)
  expect(abilities.status().media).toEqual(['elevenlabs'])

  await abilities.call('thread', 'speak', { text: 'Welcome to the demo' })
  const call = recorded()
  expect(call).toMatchObject({ status: 'done', media: 'elevenlabs', model: 'eleven_multilingual_v2' })
  expect(call.attachments?.[0]).toMatchObject({ mimeType: 'audio/mpeg' })
  const speech = requests.find((request) => request.url.includes('/text-to-speech/'))
  expect(speech).toMatchObject({ key: GOOD_KEY })
  expect(JSON.parse(speech!.body!)).toMatchObject({ text: 'Welcome to the demo' })

  await accounts.disconnect('elevenlabs')
  expect(abilities.status().media).toEqual([])
  await abilities.call('thread', 'speak', { text: 'Again' })
  expect(recorded()).toMatchObject({ status: 'refused', refusal: 'unavailable' })
  expect(recorded().summary).toContain('Settings → Media')
  expect(requests.filter((request) => request.url.includes('/text-to-speech/'))).toHaveLength(1)
})
