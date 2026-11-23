import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@ramu/shared/types'
import { DEFAULT_PLUGIN_INDEX, CLAUDE_PLUGIN_INDEX, type PluginListing } from '@ramu/shared/plugins'
import type { StackId } from '@ramu/shared/stacks'
import { ToolSuggestions, agentSuggestion, type ToolSuggestionsHost } from '../src/plugins/toolSuggestions'

const listing = (name: string, extra: Partial<PluginListing> = {}): PluginListing => ({
  index: DEFAULT_PLUGIN_INDEX,
  indexName: 'ramu-plugins',
  name,
  description: `${name} for agents`,
  source: `https://github.com/example/${name}`,
  commit: null,
  byRamu: false,
  signed: false,
  stacks: [],
  keywords: [],
  category: null,
  picture: null,
  installed: false,
  alternatives: [],
  companion: null,
  ...extra,
})

const owner = { canTurnOn: true, canAnswer: true }

function setup(options: { store?: Map<string, unknown> } = {}) {
  const store = options.store ?? new Map<string, unknown>()
  const shown: { sessionId: string; cardId: string }[] = []
  const state = {
    enabled: true,
    sessions: new Map<string, { taskId: string; projectId: string; cwd: string }>([
      ['s1', { taskId: 't1', projectId: 'p1', cwd: '/work/shop' }],
      ['s2', { taskId: 't2', projectId: 'p1', cwd: '/work/shop' }],
      ['s3', { taskId: 't3', projectId: 'p2', cwd: '/work/blog' }],
    ]),
    connections: [] as ReturnType<ToolSuggestionsHost['connections']>,
    plugins: [] as ReturnType<ToolSuggestionsHost['plugins']>,
    listings: [] as PluginListing[],
    listingReads: 0,
    github: false,
    stacks: new Map<string, StackId>(),
    skills: [] as ReturnType<ToolSuggestionsHost['skills']>,
    directory: [] as { source: string; name: string }[],
  }
  const host: ToolSuggestionsHost = {
    getAppState: <T>(key: string, fallback: T) => (store.has(key) ? (store.get(key) as T) : fallback),
    setAppState: (key, value) => void store.set(key, structuredClone(value)),
    enabled: () => state.enabled,
    session: (id) => state.sessions.get(id) ?? null,
    connections: () => state.connections,
    plugins: () => state.plugins,
    skills: () => state.skills,
    listings: () => state.listings,
    readListings: () => void state.listingReads++,
    browse: async (query) => state.listings.filter((entry) => entry.name.includes(query)),
    findSkill: async (source, name) => state.directory.some((skill) => skill.source === source && skill.name === name),
    githubSignedIn: async () => state.github,
    stackOf: (cwd) => state.stacks.get(cwd) ?? null,
    show: (sessionId, cardId) => void shown.push({ sessionId, cardId }),
    changed: () => {},
  }
  return { service: new ToolSuggestions(host), shown, state, store, host }
}

const user = (text: string): AgentEvent => ({ kind: 'user', text })

describe('suggesting a tool from a link', () => {
  it('suggests the service’s server once for a link the thread mentions, and shows the card in the thread', () => {
    const { service, shown } = setup()
    service.observe('s1', user('Build the page from https://www.figma.com/design/abc/Home'))
    expect(shown).toHaveLength(1)
    const view = service.get(shown[0]!.cardId, owner)
    expect(view?.card).toMatchObject({
      taskId: 't1',
      projectId: 'p1',
      tool: { kind: 'mcp', name: 'figma' },
      title: 'Figma',
      signIn: true,
      reason: { kind: 'link', host: 'www.figma.com' },
    })
    expect(view?.status).toEqual({ state: 'open' })
    service.observe('s1', user('And this one https://www.figma.com/design/def/About'))
    expect(shown).toHaveLength(1)
  })

  it('reads links in tool inputs but not in file contents an edit writes', () => {
    const { service, shown } = setup()
    service.observe('s1', user('Go'))
    service.observe('s1', {
      kind: 'tool-use',
      toolUseId: 'e1',
      name: 'Write',
      summary: 'README.md',
      input: JSON.stringify({ file_path: 'README.md', content: 'Designs: https://www.figma.com/design/abc' }),
    } as AgentEvent)
    expect(shown).toHaveLength(0)
    service.observe('s1', {
      kind: 'tool-use',
      toolUseId: 'f1',
      name: 'WebFetch',
      summary: 'linear',
      input: JSON.stringify({ url: 'https://linear.app/acme/issue/ENG-1' }),
    } as AgentEvent)
    expect(service.get(shown[0]!.cardId, owner)?.card.tool).toEqual({ kind: 'mcp', name: 'linear' })
  })

  it('shows one card at a time in a thread until it is answered', () => {
    const { service, shown } = setup()
    service.observe('s1', user('https://linear.app/acme/issue/ENG-1'))
    service.observe('s1', user('https://www.figma.com/design/abc'))
    expect(shown).toHaveLength(1)
    service.dismiss(shown[0]!.cardId, owner)
    service.observe('s1', user('https://www.figma.com/design/abc'))
    expect(shown).toHaveLength(2)
  })

  it('never suggests a server already added, or one whose plugin is installed', () => {
    const { service, shown, state } = setup()
    state.connections = [
      { id: 'c1', url: 'https://mcp.figma.com/mcp/?utm_source=x', status: 'disabled', granted: false },
    ]
    service.observe('s1', user('https://www.figma.com/design/abc'))
    state.plugins = [{ id: 'p', name: 'notion', needsSetup: false }]
    service.observe('s1', user('https://www.notion.so/acme/Plan'))
    expect(shown).toHaveLength(0)
  })

  it('suggests GitHub’s plugin for an issue link only when Ramu has no GitHub sign-in', async () => {
    const signedIn = setup()
    signedIn.state.github = true
    signedIn.state.listings = [listing('github', { index: CLAUDE_PLUGIN_INDEX })]
    signedIn.service.observe('s1', user('Fix https://github.com/acme/shop/issues/7'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signedIn.shown).toHaveLength(0)

    const signedOut = setup()
    signedOut.state.listings = [listing('github', { index: CLAUDE_PLUGIN_INDEX })]
    signedOut.service.observe('s1', user('Fix https://github.com/acme/shop/issues/7'))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(signedOut.service.get(signedOut.shown[0]!.cardId, owner)?.card).toMatchObject({
      tool: { kind: 'plugin', name: 'github' },
      title: 'GitHub',
    })
  })
})

describe('Not now', () => {
  it('hides the tool for the project, kept on the host across restarts, and not for other projects', () => {
    const { service, shown, store, host } = setup()
    service.observe('s1', user('https://linear.app/acme/issue/ENG-1'))
    expect(service.dismiss(shown[0]!.cardId, owner)?.status).toEqual({ state: 'dismissed' })
    const restarted = new ToolSuggestions(host)
    expect(restarted.get(shown[0]!.cardId, owner)?.card.dismissed).toBe(true)
    restarted.observe('s2', user('https://linear.app/acme/issue/ENG-2'))
    expect(shown).toHaveLength(1)
    restarted.observe('s3', user('https://linear.app/acme/issue/ENG-3'))
    expect(shown).toHaveLength(2)
    expect(store.get('tool-suggestion-dismissed')).toEqual({ p1: ['mcp:linear'] })
  })
})

describe('the project’s stack', () => {
  it('suggests the one plugin made for it, reading the indexes first when none are read yet', () => {
    const { service, shown, state } = setup()
    state.stacks.set('/work/shop', 'django')
    service.observe('s1', user('Hello'))
    expect(state.listingReads).toBe(1)
    expect(shown).toHaveLength(0)
    state.listings = [listing('django-deploy', { stacks: ['django'] })]
    service.observe('s1', user('Again'))
    expect(service.get(shown[0]!.cardId, owner)?.card).toMatchObject({
      tool: { kind: 'plugin', name: 'django-deploy' },
      reason: { kind: 'stack', stack: 'django' },
      title: 'Django deploy',
    })
  })
})

describe('the card’s state', () => {
  it('follows the tool through Customize: added, signing in, on; and a plugin that still needs its key', () => {
    const { service, shown, state } = setup()
    service.observe('s1', user('https://www.figma.com/design/abc'))
    const id = shown[0]!.cardId
    state.connections = [{ id: 'c1', url: 'https://mcp.figma.com/mcp', status: 'sign-in-required', granted: false }]
    expect(service.get(id, owner)?.status).toEqual({ state: 'sign-in', connectionId: 'c1' })
    state.connections = [{ id: 'c1', url: 'https://mcp.figma.com/mcp', status: 'connected', granted: false }]
    expect(service.get(id, owner)?.status).toEqual({ state: 'added', connectionId: 'c1' })
    state.connections = [{ id: 'c1', url: 'https://mcp.figma.com/mcp', status: 'connected', granted: true }]
    expect(service.get(id, owner)?.status).toEqual({ state: 'on' })

    state.stacks.set('/work/blog', 'astro')
    state.listings = [listing('fly-cli', { stacks: ['astro'] })]
    service.observe('s3', user('Deploy'))
    state.plugins = [{ id: 'plugin-1', name: 'fly-cli', needsSetup: true }]
    expect(service.get(shown[1]!.cardId, owner)?.status).toEqual({ state: 'needs-setup', pluginId: 'plugin-1' })
  })

  it('turns every card off with the setting, and suggests nothing while it is off', () => {
    const { service, shown, state } = setup()
    service.observe('s1', user('https://linear.app/acme/issue/ENG-1'))
    state.enabled = false
    expect(service.get(shown[0]!.cardId, owner)).toBeNull()
    service.observe('s3', user('https://linear.app/acme/issue/ENG-1'))
    expect(shown).toHaveLength(1)
  })

  it('suggests nothing in a helper’s session', () => {
    const { service, shown } = setup()
    service.observe('helper', user('https://linear.app/acme/issue/ENG-1'))
    expect(shown).toHaveLength(0)
  })
})

describe('tool_suggest', () => {
  const because = 'It reads the errors this thread is chasing.'

  it('shows the agent’s suggestion as a card with its reason and the scope it recommends', async () => {
    const { service, shown } = setup()
    const { cardId } = await service.suggest('s1', { kind: 'mcp', name: 'sentry' }, because, 'everywhere')
    expect(shown).toEqual([{ sessionId: 's1', cardId }])
    expect(service.get(cardId, owner)?.card).toMatchObject({
      tool: { kind: 'mcp', name: 'sentry' },
      title: 'Sentry',
      reason: { kind: 'agent', reason: because, scope: 'everywhere' },
    })
  })

  it('accepts catalog names only, never an address or a command', () => {
    expect(agentSuggestion.safeParse({ kind: 'mcp', name: 'figma' }).success).toBe(true)
    expect(agentSuggestion.safeParse({ kind: 'mcp', name: 'https://evil.example/mcp' }).success).toBe(false)
    expect(agentSuggestion.safeParse({ kind: 'plugin', name: '--upload-pack=touch x' }).success).toBe(false)
    expect(agentSuggestion.safeParse({ kind: 'skill', source: 'https://evil.example/x', name: 'a' }).success).toBe(
      false,
    )
    expect(agentSuggestion.safeParse({ kind: 'stdio', command: 'rm' }).success).toBe(false)
  })

  it('takes a plugin or a skill only as its catalog lists it', async () => {
    const { service, state } = setup()
    await expect(service.suggest('s1', { kind: 'plugin', name: 'made-up' }, because, 'project')).rejects.toThrow(
      'No plugin index lists made-up',
    )
    await expect(
      service.suggest('s1', { kind: 'skill', source: 'acme/skills', name: 'deploy' }, because, 'project'),
    ).rejects.toThrow('skills.sh lists no skill deploy in acme/skills')
    state.directory = [{ source: 'acme/skills', name: 'deploy' }]
    const { cardId } = await service.suggest(
      's1',
      { kind: 'skill', source: 'acme/skills', name: 'deploy' },
      because,
      'project',
    )
    expect(service.get(cardId, owner)?.card.tool).toEqual({ kind: 'skill', source: 'acme/skills', name: 'deploy' })
    state.skills = [{ name: 'deploy', source: 'acme/skills', skill: 'deploy' }]
    expect(service.get(cardId, owner)?.status).toEqual({ state: 'on' })
  })

  it('refuses while suggestions are off, for a tool already here, and for one put off in this project', async () => {
    const { service, state, shown } = setup()
    state.enabled = false
    await expect(service.suggest('s1', { kind: 'mcp', name: 'linear' }, because, 'project')).rejects.toThrow(
      'turned tool suggestions off',
    )
    state.enabled = true
    state.connections = [{ id: 'c1', url: 'https://mcp.linear.app/mcp', status: 'disabled', granted: false }]
    await expect(service.suggest('s1', { kind: 'mcp', name: 'linear' }, because, 'project')).rejects.toThrow(
      'already set up here',
    )
    const { cardId } = await service.suggest('s1', { kind: 'mcp', name: 'notion' }, because, 'project')
    service.dismiss(cardId, owner)
    await expect(service.suggest('s2', { kind: 'mcp', name: 'notion' }, because, 'project')).rejects.toThrow(
      'chose Not now for Notion',
    )
    expect(shown).toHaveLength(1)
  })

  it('keeps one card waiting at a time, and stops an agent after three in a thread', async () => {
    const { service } = setup()
    const first = await service.suggest('s1', { kind: 'mcp', name: 'linear' }, because, 'project')
    await expect(service.suggest('s1', { kind: 'mcp', name: 'notion' }, because, 'project')).rejects.toThrow(
      'already waiting',
    )
    await expect(service.suggest('s1', { kind: 'mcp', name: 'linear' }, because, 'project')).rejects.toThrow(
      'already suggested in this thread',
    )
    service.dismiss(first.cardId, owner)
    for (const name of ['notion', 'sentry'] as const)
      service.dismiss((await service.suggest('s1', { kind: 'mcp', name }, because, 'project')).cardId, owner)
    await expect(service.suggest('s1', { kind: 'mcp', name: 'figma' }, because, 'project')).rejects.toThrow(
      'already has 3 suggestions',
    )
  })

  it('holds back the rules while the agent’s card waits', async () => {
    const { service, shown } = setup()
    await service.suggest('s1', { kind: 'mcp', name: 'sentry' }, because, 'project')
    service.observe('s1', user('https://linear.app/acme/issue/ENG-1'))
    expect(shown).toHaveLength(1)
  })
})
