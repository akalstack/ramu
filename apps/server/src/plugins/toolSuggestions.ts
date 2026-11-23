// Tools suggested while a thread runs. The thread's agent suggests most of them with `tool_suggest` when it judges a
// plugin, skill or MCP server would help; two cheap rules add the clearest cases as events arrive, without asking a
// model: a link a known service's tool handles, and the one listed plugin made for the project's stack. Either way a
// thread shows at most one waiting card, never for a tool already here or one the person put off for the project.
// The card turns nothing on: Customize's own calls do that from the person's device.
import { randomUUID } from 'node:crypto'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { AgentEvent } from '@ramu/shared/types'
import { toolKind } from '@ramu/shared/chat/agentTools'
import { LINKED_PLUGINS, RECOMMENDED_MCP_SERVERS, serverAddress } from '@ramu/shared/mcpCatalog'
import { PLUGIN_NAME, type PluginListing } from '@ramu/shared/plugins'
import type { StackId } from '@ramu/shared/stacks'
import {
  AGENT_SUGGESTIONS_PER_THREAD,
  linksIn,
  pluginForStack,
  toolForLink,
  toolKey,
  type SuggestedTool,
  type SuggestionReason,
  type ToolSuggestionCard,
  type ToolSuggestionStatus,
  type ToolSuggestionView,
} from '@ramu/shared/toolSuggestions'

const CARDS = 'tool-suggestion-cards'
/** Tool keys put off with **Not now**, by project. */
const DISMISSED = 'tool-suggestion-dismissed'
const MAX_CARDS = 200
const MAX_DISMISSED = 100
/** Sessions whose current turn is remembered. */
const MAX_TURNS = 200
/** How often an empty plugin list may ask for the indexes to be read. */
const LISTINGS_RETRY_MS = 10 * 60_000

export interface ToolSuggestionsHost {
  getAppState<T>(key: string, fallback: T): T
  setAppState(key: string, value: unknown): void
  /** Settings → Threads → Suggest tools while threads run. */
  enabled(): boolean
  /** A thread's own session: its thread, project and folder. Null for a helper's session or one that is gone. */
  session(sessionId: string): { taskId: string; projectId: string; cwd: string } | null
  /** Shared MCP connections: each one's address, its status, and whether any agent has it. */
  connections(): { id: string; url: string | null; status: string; granted: boolean }[]
  plugins(): { id: string; name: string; needsSetup: boolean }[]
  /** Installed skills, with the repository and skill an installed one came from. */
  skills(): { name: string; source: string | null; skill: string | null }[]
  /** Plugin listings as the indexes were last read. */
  listings(): PluginListing[]
  /** Reads the indexes in the background, so a later match has listings. */
  readListings(): void
  /** Listings matching `query`, reading the indexes first when they are stale. */
  browse(query: string): Promise<PluginListing[]>
  /** The skill in the skills.sh directory, when `source` lists one by that name. */
  findSkill(source: string, name: string): Promise<boolean>
  /** Ramu already reaches GitHub through a signed-in `gh` or a saved account. */
  githubSignedIn(): Promise<boolean>
  stackOf(cwd: string): StackId | null
  /** Records the card's event in the thread. */
  show(sessionId: string, cardId: string): void
  changed(): void
}

type Described = Pick<ToolSuggestionCard, 'title' | 'description' | 'signIn'>

const titleOf = (name: string) =>
  name
    .split('-')
    .filter(Boolean)
    .map((word, index) => (index ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')

/** What an agent may suggest: a tool named by a catalog, never an address or a command. */
export const agentSuggestion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('mcp'), name: z.enum(RECOMMENDED_MCP_SERVERS.map((server) => server.name)) }),
  z.object({ kind: z.literal('plugin'), name: z.string().regex(PLUGIN_NAME) }),
  z.object({
    kind: z.literal('skill'),
    source: z
      .string()
      .regex(/^[\w.-]+\/[\w.-]+$/)
      .max(200),
    name: z.string().trim().min(1).max(200),
  }),
])
export type AgentSuggestion = z.infer<typeof agentSuggestion>

export class ToolSuggestions {
  /** Whether the rules already suggested something in each session's current turn. */
  private readonly turns = new Map<string, { offered: boolean }>()
  /** Sessions whose stack was matched against listings already. */
  private readonly stacksChecked = new Set<string>()
  /** Sessions with an offer waiting on a check, so two links in a row make one card. */
  private readonly offering = new Set<string>()
  private listingsAskedAt = 0

  constructor(
    private readonly host: ToolSuggestionsHost,
    private readonly now: () => number = Date.now,
  ) {}

  observe(sessionId: string, event: AgentEvent): void {
    if (event.kind === 'user') {
      this.turns.delete(sessionId)
      this.turns.set(sessionId, { offered: false })
      if (this.turns.size > MAX_TURNS) this.turns.delete(this.turns.keys().next().value!)
      this.fromLinks(sessionId, event.text)
      this.fromStack(sessionId)
      return
    }
    // An edit's input is file contents, whose links say what the file holds rather than what the thread works with.
    if (event.kind === 'tool-use' && event.input && toolKind(event) !== 'edit') this.fromLinks(sessionId, event.input)
  }

  /**
   * An agent's suggestion: the tool is checked against its catalog, then shown under the same rules as Ramu's own.
   * A refusal says why, so the agent stops asking.
   */
  async suggest(
    sessionId: string,
    input: AgentSuggestion,
    reason: string,
    scope: 'project' | 'everywhere',
  ): Promise<{ cardId: string }> {
    if (!this.host.enabled())
      throw new Error('The person turned tool suggestions off. Do not suggest tools; carry on with the task.')
    const session = this.host.session(sessionId)
    if (!session) throw new Error('Suggest tools from the thread itself, not from a helper.')
    const { tool, described } = await this.resolve(input)
    const name = described.title
    if (this.installed(tool)) throw new Error(`${name} is already set up here. Use it, or tell the person it is off.`)
    if (this.dismissed()[session.projectId]?.includes(toolKey(tool)))
      throw new Error(`The person chose Not now for ${name} in this project. Do not suggest it again.`)
    const cards = this.cards().filter((card) => card.taskId === session.taskId)
    if (cards.some((card) => toolKey(card.tool) === toolKey(tool)))
      throw new Error(`${name} was already suggested in this thread.`)
    if (cards.some((card) => this.waiting(card)))
      throw new Error('A suggestion is already waiting for the person in this thread. Let them answer it first.')
    if (cards.filter((card) => card.reason.kind === 'agent').length >= AGENT_SUGGESTIONS_PER_THREAD)
      throw new Error(`This thread already has ${AGENT_SUGGESTIONS_PER_THREAD} suggestions. Do not suggest more.`)
    return { cardId: this.create(sessionId, session, tool, described, { kind: 'agent', reason, scope }) }
  }

  get(cardId: string, access: { canTurnOn: boolean; canAnswer: boolean }): ToolSuggestionView | null {
    if (!this.host.enabled()) return null
    const card = this.cards().find((entry) => entry.id === cardId)
    return card ? { card, status: this.status(card), ...access } : null
  }

  /** **Not now**: the card is put away, and the same tool is not suggested again in this project. */
  dismiss(cardId: string, access: { canTurnOn: boolean; canAnswer: boolean }): ToolSuggestionView | null {
    const card = this.cards().find((entry) => entry.id === cardId)
    if (!card) throw new Error('This suggestion is gone.')
    if (!card.dismissed) {
      this.save({ ...card, dismissed: true })
      const dismissed = this.dismissed()
      const keys = new Set([...(dismissed[card.projectId] ?? []), toolKey(card.tool)])
      this.host.setAppState(DISMISSED, { ...dismissed, [card.projectId]: [...keys].slice(-MAX_DISMISSED) })
      this.host.changed()
    }
    return this.get(cardId, access)
  }

  /** The tool an agent named, as its catalog lists it; refused when no catalog does. */
  private async resolve(input: AgentSuggestion): Promise<{ tool: SuggestedTool; described: Described }> {
    if (input.kind === 'mcp') {
      const tool: SuggestedTool = { kind: 'mcp', name: input.name }
      return { tool, described: this.describe(tool)! }
    }
    if (input.kind === 'plugin') {
      const listing = (await this.host.browse(input.name)).find((entry) => entry.name === input.name)
      if (!listing) throw new Error(`No plugin index lists ${input.name}. Use a name plugin_search returned.`)
      return {
        tool: { kind: 'plugin', index: listing.index, name: listing.name },
        described: this.describeListing(listing),
      }
    }
    if (!(await this.host.findSkill(input.source, input.name)))
      throw new Error(`skills.sh lists no skill ${input.name} in ${input.source}. Use one skill_find returned.`)
    return {
      tool: { kind: 'skill', source: input.source, name: input.name },
      described: { title: input.name, description: '', signIn: false },
    }
  }

  private turn(sessionId: string) {
    let turn = this.turns.get(sessionId)
    if (!turn) {
      turn = { offered: false }
      this.turns.set(sessionId, turn)
    }
    return turn
  }

  private fromLinks(sessionId: string, text: string) {
    for (const url of linksIn(text)) {
      const match = toolForLink(url)
      if (!match) continue
      this.offer(sessionId, match.tool, { kind: 'link', host: url.hostname }, match.unlessSignedIn)
      return
    }
  }

  private fromStack(sessionId: string) {
    if (this.stacksChecked.has(sessionId) || !this.host.enabled()) return
    const session = this.host.session(sessionId)
    if (!session) return
    const stack = this.host.stackOf(session.cwd)
    const listings = stack ? this.listings() : []
    // With no listings read yet, the next message tries again.
    if (stack && !listings.length) return
    this.stacksChecked.add(sessionId)
    const listing = stack ? pluginForStack(listings, stack) : null
    if (stack && listing)
      this.offer(sessionId, { kind: 'plugin', index: listing.index, name: listing.name }, { kind: 'stack', stack })
  }

  private listings(): PluginListing[] {
    const listings = this.host.listings()
    if (!listings.length && this.now() - this.listingsAskedAt > LISTINGS_RETRY_MS) {
      this.listingsAskedAt = this.now()
      this.host.readListings()
    }
    return listings
  }

  private offer(sessionId: string, tool: SuggestedTool, reason: SuggestionReason, unlessSignedIn?: 'github') {
    // Read only once something matched: the setting is parsed with the rest of the preferences.
    if (!this.host.enabled() || !this.mayOffer(sessionId, tool)) return
    const create = () => {
      const session = this.host.session(sessionId)
      const described = this.describe(tool)
      if (!session || !described) return
      this.turn(sessionId).offered = true
      this.create(sessionId, session, tool, described, reason)
    }
    if (!unlessSignedIn) return create()
    this.offering.add(sessionId)
    void this.host
      .githubSignedIn()
      .catch(() => true)
      .then((signedIn) => {
        this.offering.delete(sessionId)
        if (!signedIn && this.mayOffer(sessionId, tool)) create()
      })
  }

  /** The rules suggest once per turn, each tool once per thread, nothing here or put off, while no card waits. */
  private mayOffer(sessionId: string, tool: SuggestedTool): boolean {
    if (this.offering.has(sessionId) || this.turn(sessionId).offered) return false
    const session = this.host.session(sessionId)
    if (!session || !this.describe(tool) || this.installed(tool)) return false
    const key = toolKey(tool)
    if (this.dismissed()[session.projectId]?.includes(key)) return false
    return !this.cards().some(
      (card) => card.taskId === session.taskId && (toolKey(card.tool) === key || this.waiting(card)),
    )
  }

  private create(
    sessionId: string,
    session: { taskId: string; projectId: string },
    tool: SuggestedTool,
    described: Described,
    reason: SuggestionReason,
  ): string {
    const card: ToolSuggestionCard = {
      id: randomUUID(),
      sessionId,
      taskId: session.taskId,
      projectId: session.projectId,
      tool,
      ...described,
      reason,
      dismissed: false,
      createdAt: this.now(),
    }
    this.save(card)
    this.host.show(sessionId, card.id)
    this.host.changed()
    return card.id
  }

  /** The service's name, what it does and whether it signs in, from the catalog or its listing. */
  private describe(tool: SuggestedTool): Described | null {
    if (tool.kind === 'mcp') {
      const server = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === tool.name)
      return server ? { title: server.title, description: server.description, signIn: server.signIn } : null
    }
    if (tool.kind === 'skill') return { title: tool.name, description: '', signIn: false }
    const listing = this.listings().find((entry) => entry.name === tool.name && entry.index === tool.index)
    return listing ? this.describeListing(listing) : null
  }

  private describeListing(listing: PluginListing): Described {
    const linked = LINKED_PLUGINS.find((entry) => entry.name === listing.name && entry.index === listing.index)
    return { title: linked?.title ?? titleOf(listing.name), description: listing.description, signIn: false }
  }

  /** A card still waiting on the person: not answered with Not now, and its tool not on yet. */
  private waiting(card: ToolSuggestionCard): boolean {
    return !['on', 'dismissed'].includes(this.status(card).state)
  }

  private installed(tool: SuggestedTool): boolean {
    return this.status({ tool, dismissed: false }).state !== 'open'
  }

  private status(card: Pick<ToolSuggestionCard, 'tool' | 'dismissed'>): ToolSuggestionStatus {
    if (card.dismissed) return { state: 'dismissed' }
    const { tool } = card
    if (tool.kind === 'skill') {
      const here = this.host
        .skills()
        .some((skill) => skill.name === tool.name || (skill.source === tool.source && skill.skill === tool.name))
      return here ? { state: 'on' } : { state: 'open' }
    }
    const plugins = this.host.plugins()
    if (tool.kind === 'plugin') {
      const plugin = plugins.find((entry) => entry.name === tool.name)
      if (!plugin) return { state: 'open' }
      return plugin.needsSetup ? { state: 'needs-setup', pluginId: plugin.id } : { state: 'on' }
    }
    const server = RECOMMENDED_MCP_SERVERS.find((entry) => entry.name === tool.name)
    if (!server) return { state: 'open' }
    // The service's own plugin brings the same server with its skills.
    if (server.plugin && plugins.some((entry) => entry.name === server.plugin)) return { state: 'on' }
    const address = serverAddress(server.url)
    const connection = this.host
      .connections()
      .find((entry) => entry.url !== null && serverAddress(entry.url) === address)
    if (!connection) return { state: 'open' }
    if (connection.granted) return { state: 'on' }
    if (connection.status === 'sign-in-required' || connection.status === 'insufficient-permission')
      return { state: 'sign-in', connectionId: connection.id }
    return { state: 'added', connectionId: connection.id }
  }

  private cards(): ToolSuggestionCard[] {
    return this.host.getAppState<ToolSuggestionCard[]>(CARDS, [])
  }

  private save(card: ToolSuggestionCard) {
    const others = this.cards().filter((entry) => entry.id !== card.id)
    this.host.setAppState(CARDS, [...others, card].slice(-MAX_CARDS))
  }

  private dismissed(): Record<string, string[]> {
    return this.host.getAppState<Record<string, string[]>>(DISMISSED, {})
  }
}

/**
 * `tool_suggest`: the agent puts a card in the thread for a tool it thinks would help, and carries on. The person
 * decides; the agent never sees the answer as approval to install.
 */
export function registerSuggestTool(server: McpServer, suggestions: ToolSuggestions, sessionId: string) {
  server.registerTool(
    'tool_suggest',
    {
      description:
        'Suggest a plugin, skill or MCP server that would clearly help this thread, when the person has not asked for one. Name it as plugin_search or skill_find returned it, or a recommended MCP server by name (figma, linear, notion, sentry, atlassian, vercel, stripe, supabase, context7, deepwiki). A card in the thread shows it with your reason; the person turns it on for the project or everywhere, or chooses Not now. Returns at once and installs nothing, so carry on without it. Prefer this to plugin_install or skill_install unless the person asked for the tool. One suggestion waits at a time, and a refusal is final.',
      inputSchema: {
        tool: agentSuggestion,
        reason: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('One sentence for the person: what it would do in this thread.'),
        scope: z
          .enum(['project', 'everywhere'])
          .describe('"project" when it helps this project only, "everywhere" when it helps most work.'),
      },
    },
    async ({ tool, reason, scope }: { tool: AgentSuggestion; reason: string; scope: 'project' | 'everywhere' }) => {
      const { cardId } = await suggestions.suggest(sessionId, tool, reason, scope)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ suggested: true, cardId, next: 'The person decides. Carry on with the task.' }),
          },
        ],
      }
    },
  )
}
