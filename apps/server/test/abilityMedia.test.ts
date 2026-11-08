// Abilities on a media service with the person's own key: a fixed choice and Auto both run there, the file is kept as
// an attachment of the thread, the call names the service, and a choice whose key is missing is refused plainly.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AgentSessionInfo,
  type AppPreferences,
} from '@ramu/shared/types'
import type { AbilityPreferences } from '@ramu/shared/providers/abilities'
import type { MediaService } from '@ramu/shared/types/deploy'
import type { MediaRequest } from '../src/media/mediaServices'

const made: { service: MediaService; request: MediaRequest; token: string }[] = []
vi.mock('../src/media/mediaServices', () => ({
  mediaConnector: (service: MediaService) => ({
    id: service,
    name: { gemini: 'Google Gemini', elevenlabs: 'ElevenLabs', openai: 'OpenAI' }[service],
    tokenPage: '',
    kind: 'media',
    account: async () => ({ id: service, name: service, defaultScope: null, broadScope: null, expiresAt: null }),
    make: async (auth: { token: string }, request: MediaRequest) => {
      made.push({ service, request, token: auth.token })
      return {
        bytes: Buffer.from(request.ability === 'video_generation' ? 'mp4' : 'audio'),
        extension: request.ability === 'video_generation' ? 'mp4' : 'mp3',
        model: `${service}-model`,
      }
    },
  }),
}))

const { AbilityService } = await import('../src/agent/abilities')
const { AttachmentStore } = await import('../src/attachments')
type Host = ConstructorParameters<typeof AbilityService>[0]

let root: string
let events: AgentEvent[]
let preferences: AppPreferences
let connected: MediaService[]
let permission: ReturnType<typeof vi.fn<Host['requestPermission']>>

function service() {
  const host: Host = {
    preferences: () => preferences,
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
    requestPermission: permission,
    attachments: new AttachmentStore(join(root, 'attachments')),
    search: async () => [],
    login: async () => null,
    readChecks: () => [],
    writeChecks: () => {},
    media: { connected: () => connected, auth: async (service) => ({ token: `${service}-key` }) },
  }
  return new AbilityService(
    host,
    async () => ({ text: '', images: [], sources: [] }),
    () => [],
  )
}

/** The call the thread recorded last. */
const recorded = () => (events.at(-1) as Extract<AgentEvent, { kind: 'ability' }>).call

const withAbilities = (abilities: Partial<AbilityPreferences>) => {
  preferences = { ...preferences, abilities: { ...preferences.abilities, ...abilities } }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-media-')))
  mkdirSync(join(root, 'project'))
  events = []
  made.length = 0
  connected = []
  preferences = structuredClone(DEFAULT_APP_PREFERENCES)
  permission = vi.fn<Host['requestPermission']>(async () => true)
  vi.stubEnv('RAMU_FAKE_AGENT', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('abilities on a media service', () => {
  it('runs a video on the chosen service with its key, keeps the file and names the service', async () => {
    connected = ['gemini']
    withAbilities({ choices: { video_generation: { media: 'gemini' } } })
    const answer = await service().call('thread', 'make_video', {
      prompt: 'A paper plane',
      seconds: 8,
      aspect: 'portrait',
    })
    expect(answer).toMatchObject({ status: 'done', ranOn: "Google Gemini (gemini-model) on the person's API key" })
    const call = recorded()
    expect(call).toMatchObject({ status: 'done', media: 'gemini', model: 'gemini-model' })
    expect(made).toEqual([
      {
        service: 'gemini',
        token: 'gemini-key',
        request: { ability: 'video_generation', prompt: 'A paper plane', seconds: 8, aspect: 'portrait' },
      },
    ])
    expect(call.attachments?.[0]).toMatchObject({ mimeType: 'video/mp4' })
  })

  it('with Auto, uses the first connected service that makes the ability, after the signed-in providers', async () => {
    connected = ['gemini', 'elevenlabs']
    const abilities = service()
    // Gemini makes no sound effects, so a sound goes to ElevenLabs; speech goes to Gemini, first in order.
    await abilities.call('thread', 'make_sound', { prompt: 'A whoosh' })
    expect(recorded()).toMatchObject({ media: 'elevenlabs' })
    await abilities.call('thread', 'speak', { text: 'Hello' })
    expect(recorded()).toMatchObject({ media: 'gemini' })
    expect(made.map((entry) => [entry.service, entry.request.prompt])).toEqual([
      ['elevenlabs', 'A whoosh'],
      ['gemini', 'Hello'],
    ])
    expect(abilities.listing().available.find((entry) => entry.ability === 'sound_effect')).toMatchObject({
      media: ['elevenlabs'],
    })
  })

  it('refuses a chosen service with no saved key, and one that does not make the ability', async () => {
    withAbilities({ choices: { music: { media: 'elevenlabs' }, video_generation: { media: 'openai' } } })
    await service().call('thread', 'make_music', { prompt: 'Calm piano' })
    expect(recorded()).toMatchObject({ status: 'refused', refusal: 'unavailable' })
    expect(recorded().summary).toContain('no API key for it is saved')
    connected = ['openai']
    await service().call('thread', 'make_video', { prompt: 'x' })
    expect(recorded().summary).toContain('does not make')
    expect(made).toEqual([])
  })

  it('asks first, naming the service and that it is billed to that account, when the person wants that', async () => {
    connected = ['openai']
    withAbilities({ askBeforeOtherProvider: true })
    permission.mockResolvedValueOnce(false)
    await service().call('thread', 'speak', { text: 'Hello' })
    expect(recorded()).toMatchObject({ status: 'refused', refusal: 'declined' })
    expect(permission.mock.calls[0]![1]).toContain('OpenAI')
    expect(permission.mock.calls[0]![2]).toContain('billed to that account')
    expect(made).toEqual([])
  })
})
