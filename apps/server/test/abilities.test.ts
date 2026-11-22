import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  type AgentEvent,
  type AgentProvider,
  type AgentSessionInfo,
  type AppPreferences,
  type ProviderCatalog,
} from '@ramu/shared/types'
import type { AbilityCall, AbilityPreferences } from '@ramu/shared/providers/abilities'
import { AbilityService, mcpArguments, type AbilityHost } from '../src/agent/abilities'
import type { AbilityRun } from '../src/agent/abilityRuns'
import type { AbilityDeclaration } from '../src/providers/adapter'
import { AttachmentStore } from '../src/attachments'
import { configuredCodexServers, codexAbilityConfig } from '../src/providers/codexAbility'
import { appPreferences } from '../src/ipc/preferences'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

const DECLARED: Partial<Record<AgentProvider, AbilityDeclaration[]>> = {
  codex: [
    { ability: 'image_generation', via: { tool: 'image_gen' } },
    { ability: 'image_edit', via: { tool: 'image_gen' } },
    { ability: 'web_search', via: { tool: 'web_search' } },
  ],
  'claude-code': [
    { ability: 'web_search', via: { tool: 'WebSearch' } },
    { ability: 'long_context', via: { contextWindow: 400_000 } },
  ],
}

const catalogs: ProviderCatalog[] = [
  {
    provider: 'codex',
    models: [{ provider: 'codex', id: 'gpt-x', name: 'GPT X', efforts: [], defaultEffort: null, isDefault: true }],
  },
  {
    provider: 'claude-code',
    models: [
      {
        provider: 'claude-code',
        id: 'small',
        name: 'Small',
        efforts: [],
        defaultEffort: null,
        isDefault: true,
        contextWindow: 200_000,
      },
      {
        provider: 'claude-code',
        id: 'wide',
        name: 'Wide',
        efforts: [],
        defaultEffort: null,
        isDefault: false,
        contextWindow: 1_000_000,
      },
    ],
  },
]

let root: string
let cwd: string
let stored: unknown[]
let events: AgentEvent[]
let preferences: AppPreferences
let permission: ReturnType<typeof vi.fn<AbilityHost['requestPermission']>>
let search: ReturnType<typeof vi.fn<AbilityHost['search']>>

const session = (provider: AgentProvider = 'claude-code'): AgentSessionInfo =>
  ({
    id: 'thread',
    taskId: 'task',
    provider,
    settings: { ...DEFAULT_AGENT_SETTINGS, provider },
    cwd,
  }) as AgentSessionInfo

function service(
  run: AbilityRun,
  provider: AgentProvider = 'claude-code',
  versions = { codex: '1.0.0', 'claude-code': '2.0.0' },
  extra: Partial<AbilityHost> = {},
) {
  const host: AbilityHost = {
    preferences: () => preferences,
    catalog: async () => catalogs,
    session: () => session(provider),
    events: () => events,
    record: (_id, event) => void events.push(event),
    requestPermission: permission,
    attachments: new AttachmentStore(join(root, 'attachments')),
    search,
    login: async (name) =>
      name === 'codex' || name === 'claude-code'
        ? { provider: name, accountId: 'default', version: versions[name], login: 'me@example.com', apiKey: false }
        : null,
    readChecks: () => stored,
    writeChecks: (checks) => {
      stored = checks
    },
    ...extra,
  }
  return new AbilityService(host, run, (name) => DECLARED[name] ?? [])
}

/** A fake provider: Codex makes images and searches; Claude searches and reads. */
const working: AbilityRun = async (route, declaration, request) => {
  // Reading back a check's sample image: the fake answers as if each picture showed what was asked for.
  if (request.ability === 'vision')
    return {
      text: /circles/.test(request.prompt)
        ? '1. 3\n2. blue'
        : /fruit/.test(request.prompt)
          ? '1. apple\n2. red'
          : '1. umbrella\n2. yellow',
      images: [],
      sources: [],
    }
  if (request.ability === 'image_generation' || request.ability === 'image_edit')
    return { text: 'A red apple.', images: [{ bytes: PNG, extension: 'png' }], sources: [] }
  if (request.ability === 'web_search')
    return {
      text: `Answer from ${route.provider}`,
      images: [],
      sources: [{ title: 'Node', url: 'https://nodejs.org' }],
    }
  // The long-read check asks about notes in its sample document; a real call gets a plain answer.
  const notes = [...request.prompt.matchAll(/Note \d: the [^.]+ is (\w+)\./g)].map((match) => match[1])
  return { text: notes.join('\n') || 'ready', images: [], sources: [], tokens: { input: 10, output: 2 } }
}

const withAbilities = (abilities: Partial<AbilityPreferences>) => {
  preferences = { ...preferences, abilities: { ...preferences.abilities, ...abilities } }
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-abilities-')))
  cwd = join(root, 'project')
  mkdirSync(cwd)
  stored = []
  events = []
  preferences = structuredClone(DEFAULT_APP_PREFERENCES)
  permission = vi.fn<AbilityHost['requestPermission']>(async () => true)
  search = vi.fn<AbilityHost['search']>(async () => [
    { title: 'Result', url: 'https://example.com', snippet: 'Snippet' },
  ])
  vi.stubEnv('RAMU_FAKE_AGENT', '')
  vi.stubEnv('RAMU_ABILITY_CHECKS', '')
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(root, { recursive: true, force: true })
})

describe('ability checks', () => {
  it('runs each declared check once per version and sign-in, and offers only what passed', async () => {
    const run = vi.fn(working)
    const abilities = service(run)
    await abilities.refresh()
    const passed = abilities.checks.list().filter((check) => check.ok)
    expect(passed.map((check) => `${check.provider}:${check.ability}`).sort()).toEqual([
      'claude-code:long_context',
      'claude-code:web_search',
      'codex:image_edit',
      'codex:image_generation',
      'codex:web_search',
    ])
    // Long context runs on the widest model; the rest on the default.
    expect(passed.find((check) => check.ability === 'long_context')?.model).toBe('wide')
    // Image generation makes three sample images and reads each back; the rest take one call each.
    expect(run).toHaveBeenCalledTimes(10)
    expect(passed.find((check) => check.ability === 'image_generation')?.score).toBe(1)
    // The read-back runs with no tool, so it cannot answer by making another image.
    expect(run.mock.calls.filter(([, declaration]) => declaration.ability === 'vision')).toHaveLength(3)
    // Check again runs one provider's checks anew.
    await abilities.recheck('codex')
    expect(run).toHaveBeenCalledTimes(18)
    expect(abilities.native('codex', 'image_generation')).toBe(true)
    expect(abilities.native('claude-code', 'image_generation')).toBe(false)
  })

  it('keeps a failure, skips the edit check without generation, and checks again after an update', async () => {
    const run = vi.fn<AbilityRun>(async (route, declaration, request) =>
      request.ability === 'image_generation'
        ? { text: 'I cannot make images here.', images: [], sources: [] }
        : working(route, declaration, request, new AbortController().signal, 1),
    )
    const versions = { codex: '1.0.0', 'claude-code': '2.0.0' }
    const first = service(run, 'claude-code', versions)
    await first.refresh()
    const codex = first.checks.list('codex')
    expect(codex.find((check) => check.ability === 'image_generation')).toMatchObject({ ok: false })
    expect(codex.find((check) => check.ability === 'image_edit')).toMatchObject({
      ok: false,
      detail: 'Image generation did not pass its check.',
    })
    const calls = run.mock.calls.length
    // A new service instance shares the kept results: nothing runs again for the same version.
    await service(run, 'claude-code', versions).refresh()
    expect(run.mock.calls.length).toBe(calls)
    versions.codex = '1.1.0'
    await service(run, 'claude-code', versions).refresh()
    expect(run.mock.calls.length).toBe(calls + 2)
    expect(stored.some((check) => (check as { login?: string }).login === undefined)).toBe(false)
    expect(JSON.stringify(first.checks.list())).not.toContain('me@example.com')
  })

  it('scores image generation by what its sample images show, read back on the same login', async () => {
    const run = vi.fn<AbilityRun>(async (route, declaration, request, signal, timeout) =>
      request.ability === 'vision' && /circles/.test(request.prompt)
        ? { text: '1. 2\n2. green', images: [], sources: [] }
        : working(route, declaration, request, signal, timeout),
    )
    const abilities = service(run)
    await abilities.refresh()
    const check = abilities.checks.list('codex').find((entry) => entry.ability === 'image_generation')
    // Four of the six answers are right: the circles came out wrong.
    expect(check?.score).toBeCloseTo(4 / 6)
  })

  it('reads long documents with the window the provider reports when its model list has none', async () => {
    const listed = catalogs.map((catalog) => ({
      ...catalog,
      models: catalog.models.map(({ contextWindow: _window, ...model }) => model),
    }))
    const windows: Partial<Record<AgentProvider, number>> = { 'claude-code': 1_000_000 }
    const reported: AbilityRun = async (route, declaration, request, signal, timeout) => ({
      ...(await working(route, declaration, request, signal, timeout)),
      ...(windows[route.provider] ? { contextWindow: windows[route.provider] } : {}),
    })
    const abilities = service(reported, 'claude-code', undefined, { catalog: async () => listed })
    await abilities.refresh()
    expect(abilities.checks.list('claude-code').find((check) => check.ability === 'long_context')).toMatchObject({
      ok: true,
      model: 'small',
    })
    // A run on a smaller window fails with the figure, not because the list said nothing.
    windows['claude-code'] = 200_000
    await abilities.recheck('claude-code')
    expect(abilities.checks.list('claude-code').find((check) => check.ability === 'long_context')).toMatchObject({
      ok: false,
      detail: expect.stringContaining('200,000 tokens'),
    })
  })

  it('never runs on a simulated host', async () => {
    vi.stubEnv('RAMU_FAKE_AGENT', '1')
    const run = vi.fn(working)
    await service(run).refresh()
    expect(run).not.toHaveBeenCalled()
  })
})

describe('ability calls', () => {
  it('runs an image on a provider that has it, saves it to the thread and records the row', async () => {
    const run = vi.fn(working)
    const abilities = service(run)
    await abilities.refresh()
    run.mockClear()
    const answer = await abilities.call('thread', 'generate_image', { prompt: 'A calm workspace', size: 'landscape' })
    expect(answer).toMatchObject({ status: 'done', ranOn: 'Codex (gpt-x)' })
    expect(run).toHaveBeenCalledTimes(1)
    const [route, , request] = run.mock.calls[0]!
    expect(route).toEqual({ provider: 'codex', model: 'gpt-x', accountId: 'default' })
    expect(request.prompt).toContain('A calm workspace')
    expect(request.prompt).toContain('Shape: landscape.')
    const call = (events.at(-1) as { call: AbilityCall }).call
    expect(call).toMatchObject({ status: 'done', provider: 'codex', sent: { prompt: 'A calm workspace', inputs: [] } })
    expect(call.attachments?.[0]).toMatchObject({ name: 'a-calm-workspace.png', mimeType: 'image/png' })
    expect('files' in answer && answer.files?.[0]?.path).toBe(call.attachments?.[0]?.path)
  })

  it('refuses clearly when no provider has the ability, and when it is turned off', async () => {
    const abilities = service(working)
    expect(await abilities.call('thread', 'generate_image', { prompt: 'Hero' })).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('No signed-in provider here has image generation'),
    })
    expect((events.at(-1) as { call: AbilityCall }).call.refusal).toBe('unavailable')
    await abilities.refresh()
    withAbilities({ choices: { image_generation: 'off' } })
    expect(await abilities.call('thread', 'generate_image', { prompt: 'Hero' })).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('turned off'),
    })
  })

  it('follows a project’s own choice in its ramu.json over the host’s', async () => {
    const abilities = service(working)
    await abilities.refresh()
    writeFileSync(join(cwd, 'ramu.json'), JSON.stringify({ abilities: { web_search: 'off' } }))
    expect(await abilities.call('thread', 'web_search', { query: 'Node release' })).toMatchObject({
      status: 'refused',
      message: expect.stringContaining("turned off in this project's ramu.json"),
    })
    writeFileSync(join(cwd, 'ramu.json'), JSON.stringify({ abilities: { web_search: 'auto' } }))
    expect(await abilities.call('thread', 'web_search', { query: 'Node release' })).toMatchObject({ status: 'done' })
  })

  it('moves on to the next provider at a usage limit, and never to another login of the same one', async () => {
    await service(working, 'opencode').refresh()
    const run = vi.fn<AbilityRun>(async (route, declaration, request, signal, timeout) => {
      if (route.provider === 'claude-code') throw Object.assign(new Error('limited'), { code: 'usage_limit_reached' })
      return working(route, declaration, request, signal, timeout)
    })
    const routed = service(run, 'opencode')
    const answer = await routed.call('thread', 'web_search', { query: 'Node release' })
    expect(answer).toMatchObject({ status: 'done', ranOn: 'Codex (gpt-x)' })
    expect(run.mock.calls.map(([route]) => route.provider)).toEqual(['claude-code', 'codex'])
    expect(run.mock.calls.every(([route]) => route.accountId === 'default')).toBe(true)
  })

  it('scores each check on its sample tasks, and Auto picks the cheaper of two good-enough providers', async () => {
    // Codex signs in with an API key and Claude with a subscription; both search equally well.
    const login: AbilityHost['login'] = async (name) =>
      name === 'codex' || name === 'claude-code'
        ? { provider: name, accountId: 'default', version: '1', login: name, apiKey: name === 'codex' }
        : null
    const run = vi.fn<AbilityRun>(async (route, declaration, request, signal, timeout) => ({
      ...(await working(route, declaration, request, signal, timeout)),
      costUsd: 0.01,
    }))
    const abilities = service(run, 'opencode', undefined, { login })
    await abilities.refresh()
    const checks = abilities.checks.list()
    const of = (provider: AgentProvider, ability: string) =>
      checks.find((check) => check.provider === provider && check.ability === ability)
    // The fake cites one of the five sites the search sample asks for, and finds every note in the long document.
    expect(of('claude-code', 'web_search')?.score).toBe(0.2)
    expect(of('claude-code', 'long_context')?.score).toBe(1)
    expect(of('codex', 'web_search')).toMatchObject({ apiKey: true, typicalCostUsd: 0.01 })
    withAbilities({})
    preferences = { ...preferences, fallback: { ...preferences.fallback, order: [{ provider: 'codex' }] as never } }
    await abilities.call('thread', 'web_search', { query: 'Node release' })
    const recorded = (events.at(-1) as { call: AbilityCall }).call
    expect(recorded).toMatchObject({ provider: 'claude-code', cheapest: true, costUsd: 0.01 })
  })

  it("falls back to Ramu's own search when no provider can search", async () => {
    const abilities = service(working)
    const answer = await abilities.call('thread', 'web_search', { query: 'Node release' })
    expect(answer).toMatchObject({
      status: 'done',
      ranOn: "Ramu's web search",
      sources: [{ url: 'https://example.com' }],
    })
    expect(search).toHaveBeenCalledWith('Node release', expect.any(AbortSignal))
  })

  it('asks before using another provider when the person wants that, and stops when declined', async () => {
    const run = vi.fn(working)
    const abilities = service(run)
    await abilities.refresh()
    run.mockClear()
    withAbilities({ askBeforeOtherProvider: true })
    permission.mockResolvedValueOnce(false)
    expect(await abilities.call('thread', 'generate_image', { prompt: 'Hero' })).toMatchObject({ status: 'refused' })
    expect(permission).toHaveBeenCalledWith(
      'thread',
      'image generation with Codex',
      expect.stringContaining('Hero'),
      expect.any(AbortSignal),
    )
    expect(run).not.toHaveBeenCalled()
  })

  it('sends only files inside the thread folder or attachments the thread holds', async () => {
    const abilities = service(working)
    await abilities.refresh()
    writeFileSync(join(cwd, 'hero.png'), PNG)
    writeFileSync(join(root, 'secret.png'), PNG)
    expect(await abilities.call('thread', 'edit_image', { prompt: 'Recolor', images: ['hero.png'] })).toMatchObject({
      status: 'done',
    })
    expect((events.at(-1) as { call: AbilityCall }).call.sent.inputs).toEqual(['hero.png'])
    expect(
      await abilities.call('thread', 'edit_image', { prompt: 'Recolor', images: [join(root, 'secret.png')] }),
    ).toMatchObject({ status: 'failed', message: expect.stringContaining('outside') })
    const foreign = new AttachmentStore(join(root, 'attachments')).add('other.png', PNG)
    expect(await abilities.call('thread', 'edit_image', { prompt: 'Recolor', images: [foreign.id] })).toMatchObject({
      status: 'failed',
      message: 'That attachment is not in this thread.',
    })
  })

  it('reads long files on the widest model and bounds the input', async () => {
    const run = vi.fn(working)
    const abilities = service(run)
    await abilities.refresh()
    run.mockClear()
    writeFileSync(join(cwd, 'notes.md'), 'The launch is on Tuesday.')
    expect(await abilities.call('thread', 'read_long', { question: 'When?', files: ['notes.md'] })).toMatchObject({
      status: 'done',
    })
    expect(run.mock.calls[0]![0]).toMatchObject({ provider: 'claude-code', model: 'wide' })
    expect(run.mock.calls[0]![2].prompt).toContain('The launch is on Tuesday.')
    expect(
      await abilities.call('thread', 'read_long', { question: 'When?', text: 'x'.repeat(1_300_000) }),
    ).toMatchObject({
      status: 'failed',
    })
  })

  it('runs a recorded call again on another provider', async () => {
    const run = vi.fn(working)
    const abilities = service(run, 'opencode')
    await abilities.refresh()
    await abilities.call('thread', 'web_search', { query: 'Node release' })
    const first = (events.at(-1) as { call: AbilityCall }).call
    expect(first.provider).toBe('claude-code')
    const again = await abilities.again('thread', first.id, true)
    expect(again).toMatchObject({ status: 'done', provider: 'codex' })
  })
})

describe('abilities on a Shared MCP tool', () => {
  it('with Auto, tries the offered Shared MCP tool after the providers, once its check through the thread passed', async () => {
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, tool, build) => {
      const args = build({ properties: { prompt: { type: 'string' } } })
      return tool === 'make'
        ? {
            server: 'Pictures',
            result: {
              content: [
                { type: 'text', text: `Made ${String(args.prompt)}` },
                { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' },
              ],
            },
          }
        : { server: 'Pictures', result: { content: [{ type: 'text', text: 'Nothing here.' }] } }
    })
    let checks: unknown = []
    const mcpTools = () => [
      { connectionId: 'c1', tool: 'make', server: 'Pictures' },
      { connectionId: 'c1', tool: 'text', server: 'Pictures' },
    ]
    // No provider here makes images, so Auto reaches the tool.
    const abilities = service(working, 'claude-code', undefined, {
      mcp,
      mcpTools,
      login: async () => null,
      readMcpChecks: () => checks,
      writeMcpChecks: (next) => void (checks = next),
    })
    withAbilities({ autoMcp: { image_generation: { connectionId: 'c1', tool: 'make' } } })
    expect(await abilities.call('thread', 'generate_image', { prompt: 'a red apple' })).toMatchObject({
      status: 'done',
    })
    // The sample image first, then the call itself; the passed check is kept and not run again.
    expect(mcp).toHaveBeenCalledTimes(2)
    expect(abilities.status().mcpChecks).toMatchObject([{ ability: 'image_generation', tool: 'make', ok: true }])
    await abilities.call('thread', 'generate_image', { prompt: 'a pear' })
    expect(mcp).toHaveBeenCalledTimes(3)
    // A tool whose check fails is never used: the call is refused as before.
    withAbilities({ autoMcp: { image_generation: { connectionId: 'c1', tool: 'text' } } })
    expect(await abilities.call('thread', 'generate_image', { prompt: 'x' })).toMatchObject({ status: 'refused' })
    expect(abilities.status().mcpChecks.find((check) => check.tool === 'text')).toMatchObject({ ok: false })
  })

  it('makes an image for an artifact with no thread, and refuses a mapping to a Shared MCP tool', async () => {
    const abilities = service(working)
    await abilities.refresh()
    const image = await abilities.pageImage('a red apple')
    expect(image.extension).toBe('png')
    expect(image.bytes.equals(PNG)).toBe(true)
    withAbilities({ choices: { image_generation: { connectionId: 'c1', tool: 'make' } } })
    await expect(abilities.pageImage('a pear')).rejects.toThrow('an artifact cannot use')
    withAbilities({ choices: { image_generation: 'off' } })
    await expect(abilities.pageImage('a pear')).rejects.toThrow('turned off')
  })

  it('passes an edit’s images to the tool’s image field as data URLs, and refuses a tool without one', () => {
    const image = 'data:image/png;base64,AAAA'
    expect(
      mcpArguments({ properties: { prompt: { type: 'string' }, images: { type: 'array' } } }, 'make it green', [image]),
    ).toEqual({ prompt: 'make it green', images: [image] })
    expect(
      mcpArguments({ properties: { prompt: { type: 'string' }, image_url: { type: 'string' } } }, 'green', [image]),
    ).toEqual({ prompt: 'green', image_url: image })
    expect(() => mcpArguments({ properties: { prompt: { type: 'string' } } }, 'green', [image])).toThrow(
      'takes no image',
    )
  })

  it('checks vision on a picture of one color, then reads a thread’s image for a provider that cannot', async () => {
    DECLARED['claude-code']!.push({ ability: 'vision', via: { input: 'image' } })
    try {
      const seen: { prompt: string; images: string[] }[] = []
      const run = vi.fn<AbilityRun>(async (route, declaration, request, signal, timeout) => {
        if (request.ability !== 'vision') return working(route, declaration, request, signal, timeout)
        seen.push({ prompt: request.prompt, images: request.images })
        return { text: /one color/.test(request.prompt) ? 'Red.' : 'A bar chart of signups.', images: [], sources: [] }
      })
      const abilities = service(run, 'opencode')
      await abilities.refresh()
      expect(abilities.checks.list('claude-code').find((check) => check.ability === 'vision')).toMatchObject({
        ok: true,
      })
      // The check sent a real PNG.
      expect(seen[0]?.images).toHaveLength(1)
      writeFileSync(join(cwd, 'chart.png'), PNG)
      const answer = await abilities.call('thread', 'read_image', {
        question: 'What does it show?',
        images: ['chart.png'],
      })
      expect(answer).toMatchObject({ status: 'done' })
      expect(seen.at(-1)?.prompt).toContain('What does it show?')
      expect(seen.at(-1)?.images[0]).toMatch(/chart\.png$/)
    } finally {
      DECLARED['claude-code']!.pop()
    }
  })

  it('makes music on the mapped Shared MCP tool, keeping its audio and license words, and refuses one with no audio', async () => {
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, tool) => ({
      server: 'Tunes',
      result: {
        content:
          tool === 'compose'
            ? [
                { type: 'text', text: 'License: free for any use, credit Tunes.' },
                { type: 'audio', data: Buffer.from('ID3fake').toString('base64'), mimeType: 'audio/mpeg' },
              ]
            : [{ type: 'text', text: 'No audio today.' }],
      },
    }))
    const abilities = service(working, 'claude-code', undefined, { mcp })
    withAbilities({ choices: { music: { connectionId: 'c1', tool: 'compose' } } })
    const answer = await abilities.call('thread', 'make_music', { prompt: 'calm piano', seconds: 30 })
    expect(answer).toMatchObject({ status: 'done' })
    const recorded = (events.at(-1) as { call: AbilityCall }).call
    expect(recorded.attachments?.[0]).toMatchObject({ mimeType: 'audio/mpeg' })
    expect(recorded.summary).toContain('License: free for any use')
    expect(abilities.heldFile('thread', recorded.attachments![0]!.id).mimeType).toBe('audio/mpeg')
    withAbilities({ choices: { music: { connectionId: 'c1', tool: 'silent' } } })
    expect(await abilities.call('thread', 'make_music', { prompt: 'x' })).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('returned no audio'),
    })
  })

  it('records a scene’s narration on the Shared MCP tool mapped to speech, sending only the words', async () => {
    const sent: Record<string, unknown>[] = []
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, _tool, build) => {
      sent.push(build({ properties: { text: { type: 'string' } } }))
      return {
        server: 'Voices',
        result: { content: [{ type: 'audio', data: Buffer.from('RIFF').toString('base64'), mimeType: 'audio/wav' }] },
      }
    })
    const abilities = service(working, 'claude-code', undefined, { mcp })
    withAbilities({ choices: { speech: { connectionId: 'c1', tool: 'say' } } })
    expect(await abilities.call('thread', 'speak', { text: 'Sync keeps every device current.' })).toMatchObject({
      status: 'done',
    })
    expect(sent).toEqual([{ text: 'Sync keeps every device current.' }])
    const recorded = (events.at(-1) as { call: AbilityCall }).call
    expect(recorded.attachments?.[0]).toMatchObject({ mimeType: 'audio/wav' })
  })

  it('fills the tool’s prompt or query, else its first required text', () => {
    expect(mcpArguments({ properties: { size: { type: 'number' }, prompt: { type: 'string' } } }, 'apple')).toEqual({
      prompt: 'apple',
    })
    expect(
      mcpArguments({ properties: { a: { type: 'string' }, b: { type: 'string' } }, required: ['b'] }, 'x'),
    ).toEqual({
      b: 'x',
    })
    expect(() => mcpArguments({ properties: { n: { type: 'number' } } }, 'x')).toThrow('takes no text')
  })

  it('runs a mapped ability on the tool through the thread’s own MCP access, and names the server', async () => {
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, tool, build) => {
      const args = build({ properties: { prompt: { type: 'string' } } })
      return tool === 'make'
        ? {
            server: 'Pictures',
            result: {
              content: [
                { type: 'text', text: `Made ${String(args.prompt)}` },
                { type: 'image', data: PNG.toString('base64'), mimeType: 'image/png' },
              ],
            },
          }
        : { server: 'Pictures', result: { isError: true, content: [{ type: 'text', text: 'quota' }] } }
    })
    const abilities = service(working, 'claude-code', undefined, { mcp })
    withAbilities({ choices: { image_generation: { connectionId: 'c1', tool: 'make' } } })
    const call = await abilities.call('thread', 'generate_image', { prompt: 'a red apple' })
    expect(call).toMatchObject({ status: 'done', summary: 'Made a red apple' })
    const recorded = (events.at(-1) as { call: AbilityCall }).call
    expect(recorded.mcp).toEqual({ server: 'Pictures', tool: 'make' })
    expect(recorded.attachments).toHaveLength(1)
    expect(mcp).toHaveBeenCalledWith('thread', 'c1', 'make', expect.any(Function), expect.any(AbortSignal))
    withAbilities({ choices: { image_generation: { connectionId: 'c1', tool: 'broken' } } })
    expect(await abilities.call('thread', 'generate_image', { prompt: 'x' })).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Pictures returned an error. quota'),
    })
    // A long read sends its whole prompt, the file's text included, as the tool's text.
    withAbilities({ choices: { long_context: { connectionId: 'c1', tool: 'make' } } })
    writeFileSync(join(cwd, 'notes.md'), 'Tuesday.')
    expect(await abilities.call('thread', 'read_long', { question: 'When?', files: ['notes.md'] })).toMatchObject({
      status: 'done',
      summary: expect.stringContaining('Tuesday.'),
    })
  })
})

describe('helpers by ability', () => {
  it('picks a provider that has every need, or names what is missing', async () => {
    const abilities = service(working)
    await abilities.refresh()
    expect(await abilities.helperModel(['image_generation'])).toMatchObject({ provider: 'codex', id: 'gpt-x' })
    expect(abilities.has('codex', ['image_generation', 'web_search'])).toBe(true)
    await expect(abilities.helperModel(['image_generation', 'long_context'])).rejects.toThrow('No single provider')
    await expect(abilities.helperModel(['video_generation'])).rejects.toThrow('video generation')
  })

  it('names the model each @ability handle starts a helper on, routed like a helper that needs that ability', async () => {
    const abilities = service(working)
    await abilities.refresh()
    const models = await abilities.mentionModels()
    expect(models.images).toMatchObject({ provider: 'codex', id: 'gpt-x' })
    expect(models.long?.provider).toBe('claude-code')
    expect(Object.keys(models).sort()).toEqual(['images', 'long', 'search'])
  })
})

describe('Codex ability runs', () => {
  it('switch off every MCP server the login configures, and every tool but the one asked for', () => {
    expect(
      configuredCodexServers('[mcp_servers.figma]\nurl = "x"\n[mcp_servers."node-repl"]\n[mcp_servers.bad name]\n'),
    ).toEqual(['figma', 'node-repl'])
    const config = codexAbilityConfig('web_search', ['figma'])
    expect(config).toContain('features.shell_tool=false')
    expect(config).toContain('web_search="live"')
    expect(config).toContain('features.image_generation=false')
    expect(config).toContain('mcp_servers.figma.enabled=false')
  })
})

describe('saved ability preferences', () => {
  it('defaults to Auto without asking, and validates choices', () => {
    const parse = (abilities: unknown) => appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, abilities }).abilities
    expect(parse({})).toEqual({ choices: {}, askBeforeOtherProvider: false })
    expect(parse({ choices: { image_generation: { provider: 'codex', model: 'gpt-x' } } }).choices).toEqual({
      image_generation: { provider: 'codex', model: 'gpt-x' },
    })
    expect(() => parse({ choices: { image_generation: 'sometimes' } })).toThrow()
  })

  it('drops a choice of a media service Ramu no longer offers, so that ability falls back to Auto', () => {
    const parse = (abilities: unknown) => appPreferences.parse({ ...DEFAULT_APP_PREFERENCES, abilities }).abilities
    expect(parse({ choices: { speech: { media: 'openai' }, music: { media: 'elevenlabs' } } }).choices).toEqual({
      music: { media: 'elevenlabs' },
    })
  })
})

describe('3D models on a plugin’s service', () => {
  const GLB = Buffer.concat([Buffer.from('glTF'), Buffer.alloc(16, 1)])
  const meshy = { connectionId: 'm1', tool: 'text_to_3d', status: 'task_status', balance: 'balance' }
  const declared = { ...meshy, downloads: ['https://assets.meshy.ai'] }
  const tools = () => [{ connectionId: 'm1', tool: 'text_to_3d', server: 'Meshy' }]

  function meshyServer(statuses: string[], credits = 120) {
    const sent: { tool: string; args: Record<string, unknown> }[] = []
    let polls = 0
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, tool, build) => {
      const schema =
        tool === 'text_to_3d'
          ? {
              properties: {
                prompt: { type: 'string' },
                image_url: { type: 'string' },
                should_texture: { type: 'boolean' },
                target_polycount: { type: 'number' },
              },
            }
          : tool === 'task_status'
            ? { properties: { task_id: { type: 'string' } } }
            : { properties: {} }
      sent.push({ tool, args: build(schema) })
      if (tool === 'balance')
        return { server: 'Meshy', result: { content: [{ type: 'text', text: `{"balance": ${credits}}` }] } }
      if (tool === 'text_to_3d')
        return {
          server: 'Meshy',
          result: { content: [{ type: 'text', text: '{"task_id":"t-42","status":"PENDING"}' }] },
        }
      const status = statuses[Math.min(polls++, statuses.length - 1)]!
      return {
        server: 'Meshy',
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                status === 'SUCCEEDED'
                  ? {
                      status,
                      model_urls: { glb: 'https://assets.meshy.ai/t-42/fox.glb' },
                      thumbnail_url: 'https://assets.meshy.ai/t-42/fox.png',
                    }
                  : { status, message: status === 'FAILED' ? 'Not enough credits.' : 'Working' },
              ),
            },
          ],
        },
      }
    })
    return { mcp, sent }
  }
  const download = vi.fn<NonNullable<AbilityHost['download']>>(
    async (url) => new Response(url.endsWith('.glb') ? GLB : PNG, { status: 200 }),
  )

  it('waits on the task, downloads the GLB from the declared origin, asks once per thread and saves it in the project', async () => {
    const { mcp, sent } = meshyServer(['IN_PROGRESS', 'SUCCEEDED'])
    const abilities = service(working, 'claude-code', undefined, {
      mcp,
      mcpTools: tools,
      download,
      statusEveryMs: 1,
      inProject: () => true,
    })
    withAbilities({ choices: { model_3d: declared } })
    const answer = await abilities.call('thread', 'make_model', {
      prompt: 'a low-poly fox',
      detail: 'low',
      textured: true,
    })
    expect(answer).toMatchObject({ status: 'done' })
    const recorded = (events.at(-1) as { call: AbilityCall }).call
    expect(recorded.mcp).toEqual({ server: 'Meshy', tool: 'text_to_3d' })
    expect(recorded.attachments?.map((file) => file.mimeType)).toEqual(['model/gltf-binary', 'image/png'])
    expect(recorded.savedTo).toBe('assets/models/a-low-poly-fox.glb')
    expect(readFileSync(join(cwd, recorded.savedTo!))).toEqual(GLB)
    expect(recorded.credits).toBe(120)
    expect(sent[0]).toEqual({
      tool: 'text_to_3d',
      args: { prompt: 'a low-poly fox', should_texture: true, target_polycount: 5_000 },
    })
    expect(sent.filter((entry) => entry.tool === 'task_status').map((entry) => entry.args)).toEqual([
      { task_id: 't-42' },
      { task_id: 't-42' },
    ])
    expect(permission).toHaveBeenCalledTimes(1)
    expect(permission.mock.calls[0]![1]).toBe('3D model with Meshy')
    // A second model in the same thread does not ask again, and lands beside the first.
    await abilities.call('thread', 'make_model', { prompt: 'a low-poly fox' })
    expect(permission).toHaveBeenCalledTimes(1)
    expect((events.at(-1) as { call: AbilityCall }).call.savedTo).toBe('assets/models/a-low-poly-fox-2.glb')
  })

  it('stops with the service’s words when the task fails, and refuses a link outside the declared origins', async () => {
    const failing = meshyServer(['FAILED'])
    const abilities = service(working, 'claude-code', undefined, {
      mcp: failing.mcp,
      mcpTools: tools,
      download,
      statusEveryMs: 1,
    })
    withAbilities({ choices: { model_3d: declared } })
    expect(await abilities.call('thread', 'make_model', { prompt: 'a fox' })).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('Not enough credits.'),
    })
    const elsewhere = service(working, 'claude-code', undefined, {
      mcp: meshyServer(['SUCCEEDED']).mcp,
      mcpTools: tools,
      download,
      statusEveryMs: 1,
    })
    withAbilities({ choices: { model_3d: { ...meshy, downloads: ['https://cdn.example.com'] } } })
    expect(await elsewhere.call('thread', 'make_model', { prompt: 'a fox' })).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('does not list as a place to download from'),
    })
  })

  it('uses a plugin’s tool under Auto only after its balance check, and refuses an empty account', async () => {
    const empty = meshyServer(['SUCCEEDED'], 0)
    const abilities = service(working, 'claude-code', undefined, {
      mcp: empty.mcp,
      mcpTools: tools,
      download,
      statusEveryMs: 1,
      readMcpChecks: () => [],
      writeMcpChecks: () => {},
    })
    withAbilities({ autoMcp: { model_3d: declared } })
    expect(await abilities.call('thread', 'make_model', { prompt: 'a fox' })).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('No credits are left on the Meshy account.'),
    })
    // The check only read the balance; nothing was made.
    expect(empty.sent.map((entry) => entry.tool)).toEqual(['balance'])
    const funded = meshyServer(['SUCCEEDED'])
    const paid = service(working, 'claude-code', undefined, {
      mcp: funded.mcp,
      mcpTools: tools,
      download,
      statusEveryMs: 1,
      readMcpChecks: () => [],
      writeMcpChecks: () => {},
    })
    expect(await paid.call('thread', 'make_model', { prompt: 'a fox' })).toMatchObject({ status: 'done' })
  })

  it('sends an image by its path to the image tool, textures a text preview, and never waits inside a call', async () => {
    const calls: { tool: string; args: Record<string, unknown> }[] = []
    const done = (id: string) => ({
      server: 'Meshy',
      result: {
        structuredContent: { status: 'SUCCEEDED', model_urls: { glb: `https://cdn-7.meshy.ai/${id}/model.glb` } },
        content: [{ type: 'text', text: 'Done' }],
      },
    })
    const mcp = vi.fn<NonNullable<AbilityHost['mcp']>>(async (_session, _connection, tool, build) => {
      const schemas: Record<string, Record<string, unknown>> = {
        meshy_text_to_3d: { properties: { prompt: { type: 'string' }, target_polycount: { type: 'number' } } },
        meshy_image_to_3d: { properties: { image_url: { type: 'string' }, file_path: { type: 'string' } } },
        meshy_text_to_3d_refine: { properties: { preview_task_id: { type: 'string' } } },
        meshy_get_task_status: { properties: { task_id: { type: 'string' }, wait: { type: 'boolean' } } },
      }
      const args = build(schemas[tool] ?? { properties: {} })
      calls.push({ tool, args })
      if (tool === 'meshy_get_task_status') return done(String(args.task_id))
      const task =
        tool === 'meshy_text_to_3d_refine' ? 'refined' : tool === 'meshy_image_to_3d' ? 'from-image' : 'preview'
      return {
        server: 'Meshy',
        result: { structuredContent: { task_id: task }, content: [{ type: 'text', text: 'Started' }] },
      }
    })
    const abilities = service(working, 'claude-code', undefined, {
      mcp,
      mcpTools: () => [{ connectionId: 'm1', tool: 'meshy_text_to_3d', server: 'Meshy' }],
      download: async (url) => new Response(url.includes('/refined/') || url.includes('/from-image/') ? GLB : PNG),
      statusEveryMs: 1,
    })
    withAbilities({
      choices: {
        model_3d: {
          connectionId: 'm1',
          tool: 'meshy_text_to_3d',
          fromImage: 'meshy_image_to_3d',
          refine: 'meshy_text_to_3d_refine',
          status: 'meshy_get_task_status',
          downloads: ['https://*.meshy.ai'],
        },
      },
    })
    const coin = await abilities.call('thread', 'make_model', { prompt: 'a coin', detail: 'low' })
    expect(coin, JSON.stringify(coin)).toMatchObject({ status: 'done' })
    expect(calls.map((entry) => entry.tool)).toEqual([
      'meshy_text_to_3d',
      'meshy_get_task_status',
      'meshy_text_to_3d_refine',
      'meshy_get_task_status',
    ])
    expect(calls[0]!.args).toEqual({ prompt: 'a coin', target_polycount: 5_000 })
    expect(calls[1]!.args).toEqual({ task_id: 'preview', wait: false })
    expect(calls[2]!.args).toEqual({ preview_task_id: 'preview' })
    calls.length = 0
    writeFileSync(join(cwd, 'fox.png'), PNG)
    expect(await abilities.call('thread', 'make_model', { image: 'fox.png' })).toMatchObject({ status: 'done' })
    expect(calls[0]).toEqual({ tool: 'meshy_image_to_3d', args: { file_path: join(cwd, 'fox.png') } })
  })

  it('points the agent at plugins when no 3D service is set up', async () => {
    expect(await service(working).call('thread', 'make_model', { prompt: 'a fox' })).toMatchObject({
      status: 'refused',
      message: expect.stringContaining('plugin_search'),
    })
  })
})
