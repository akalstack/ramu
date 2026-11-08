// Abilities: things one provider can do that another cannot (make an image, search the web, read a very long document).
// The list is data so the desktop, the phone and the host show the same thing; adapters declare which they provide and a
// live check on the host decides which are offered.
import type { AgentProvider, Attachment } from '../types'

export const ABILITIES = [
  'image_generation',
  'image_edit',
  'web_search',
  'long_context',
  'vision',
  'video_generation',
  'speech',
] as const
export type Ability = (typeof ABILITIES)[number]

/** Ramu's tools that call an ability on another provider, and the ability each one needs. */
export const ABILITY_TOOLS = {
  generate_image: 'image_generation',
  edit_image: 'image_edit',
  web_search: 'web_search',
  read_long: 'long_context',
} as const satisfies Record<string, Ability>
export type AbilityTool = keyof typeof ABILITY_TOOLS

/** `@images`, `@search` and `@long` bring in a teammate on a provider with that ability, whichever it is here. */
export const ABILITY_HANDLES = {
  images: 'image_generation',
  search: 'web_search',
  long: 'long_context',
} as const satisfies Record<string, Ability>
export type AbilityHandle = keyof typeof ABILITY_HANDLES

export const isAbility = (value: unknown): value is Ability =>
  typeof value === 'string' && (ABILITIES as readonly string[]).includes(value)

/** The name a person reads, as a translation key. */
export const ABILITY_LABELS: Record<Ability, string> = {
  image_generation: 'Image generation',
  image_edit: 'Image editing',
  web_search: 'Web search',
  long_context: 'Long documents',
  vision: 'Reading images',
  video_generation: 'Video generation',
  speech: 'Speech',
}

/** The row's headline once a call finished, as a translation key with the provider as {0}. */
export const ABILITY_DONE: Record<Ability, string> = {
  image_generation: 'Image made with {0}',
  image_edit: 'Image edited with {0}',
  web_search: 'Searched the web with {0}',
  long_context: 'Read with {0}',
  vision: 'Image read with {0}',
  video_generation: 'Video made with {0}',
  speech: 'Narration made with {0}',
}

/** The live check's outcome for one ability of one provider login on one installed version. */
export interface AbilityCheck {
  ability: Ability
  provider: AgentProvider
  accountId: string
  /** The model the check ran on; calls use it unless the person picks another. */
  model: string
  version: string
  ok: boolean
  checkedAt: string
  /** Why it failed, in a sentence. */
  detail?: string
  /** The share of the check's sample tasks answered right, 0 to 1; absent for an ability without measured samples. */
  score?: number
  /** The login uses an API key, billed per call, rather than a subscription. */
  apiKey?: boolean
  /** The middle of the costs the provider reported for this ability's recent calls, in US dollars. */
  typicalCostUsd?: number
}

/** A Shared MCP server's tool the person mapped to an ability, called through the thread's own Shared MCP access. */
export interface AbilityMcpTool {
  connectionId: string
  tool: string
}

/**
 * Auto picks the best signed-in provider; a fixed choice names one provider and model, or a Shared MCP tool; Off
 * refuses the ability.
 */
export type AbilityChoice = 'auto' | 'off' | { provider: AgentProvider; model: string } | AbilityMcpTool

/**
 * Abilities a Shared MCP tool can stand in for: text in (a long read's documents go in its prompt), and for image
 * editing the images as data URLs in the tool's image field.
 */
export const MCP_ABILITIES: readonly Ability[] = ['image_generation', 'image_edit', 'web_search', 'long_context']
/** The ones Auto can also try on a Shared MCP tool, which have a sample check to run first. */
export const AUTO_MCP_ABILITIES: readonly Ability[] = ['image_generation', 'web_search']

/** A Shared MCP tool offered for mapping, with its server's name for the menu. */
export interface AbilityMcpToolOption extends AbilityMcpTool {
  server: string
}

export const isMcpChoice = (choice: AbilityChoice | undefined): choice is AbilityMcpTool =>
  typeof choice === 'object' && 'connectionId' in choice

/** A Shared MCP tool's live check, run through the first thread that would use it in Auto. */
export interface AbilityMcpCheck extends AbilityMcpTool {
  ability: Ability
  ok: boolean
  checkedAt: string
  /** The share of the check's sample tasks answered right, where they can be checked. */
  score?: number
  detail?: string
}

export interface AbilityPreferences {
  choices: Partial<Record<Ability, AbilityChoice>>
  /**
   * A Shared MCP tool Auto also tries, after the signed-in providers, for an ability a tool can stand in for. It is
   * used only once its live check passed.
   */
  autoMcp?: Partial<Record<Ability, AbilityMcpTool>>
  /** Each call routed to a provider other than the thread's own waits for the person's approval. */
  askBeforeOtherProvider: boolean
}
export const DEFAULT_ABILITY_PREFERENCES: AbilityPreferences = { choices: {}, askBeforeOtherProvider: false }

/** Where an ability call can run, in the order Ramu tries them. */
export interface AbilityRoute {
  provider: AgentProvider
  model: string
  accountId: string
  /** Auto chose it over a pricier provider whose sample score was no better by more than the margin. */
  cheapest?: true
}

/** How far below the best sample score a provider may be and still count as good enough. */
export const ABILITY_SCORE_MARGIN = 0.2

/**
 * What a call is likely to cost on a login: a subscription costs nothing extra while it has room (a limited one hands
 * over to the next route), an API key its typical reported cost, and an API key with no reported cost ranks last.
 */
const callCost = (check: AbilityCheck) => (check.apiKey ? (check.typicalCostUsd ?? Number.POSITIVE_INFINITY) : 0)

/**
 * The providers a call tries, in order: a fixed choice alone, or with Auto every provider whose check passed. Auto
 * puts the good-enough ones first (within the margin of the best sample score, or all when none is scored), cheapest
 * first, then the rest by score; equal ones keep the person's fallback order (providers missing from it last). Only each provider's chosen login is used: moving to another
 * subscription when one is limited is never automatic. Null when the ability is Off.
 */
export function abilityRoutes(
  ability: Ability,
  preferences: AbilityPreferences,
  checks: readonly AbilityCheck[],
  order: readonly AgentProvider[],
  currentAccount: (provider: AgentProvider) => string,
  exclude: ReadonlySet<AgentProvider> = new Set(),
): AbilityRoute[] | null {
  const choice = preferences.choices[ability] ?? 'auto'
  if (choice === 'off') return null
  const passed = checks.filter(
    (check) =>
      check.ok &&
      check.ability === ability &&
      check.accountId === currentAccount(check.provider) &&
      !exclude.has(check.provider),
  )
  // A Shared MCP tool runs through the thread's own MCP access, never on a provider.
  if (isMcpChoice(choice)) return []
  if (typeof choice === 'object') {
    const check = passed.find((entry) => entry.provider === choice.provider)
    return check ? [{ provider: choice.provider, model: choice.model || check.model, accountId: check.accountId }] : []
  }
  const rank = (provider: AgentProvider) => {
    const index = order.indexOf(provider)
    return index < 0 ? order.length : index
  }
  const seen = new Set<AgentProvider>()
  const candidates = passed
    .slice()
    .sort((a, b) => rank(a.provider) - rank(b.provider))
    .filter((check) => !seen.has(check.provider) && !!seen.add(check.provider))
  const scores = candidates.flatMap((check) => (check.score === undefined ? [] : [check.score]))
  const best = scores.length ? Math.max(...scores) : null
  const good = (check: AbilityCheck) =>
    best === null || (check.score !== undefined && check.score >= best - ABILITY_SCORE_MARGIN)
  const ordered = [
    ...candidates.filter(good).sort((a, b) => callCost(a) - callCost(b)),
    ...candidates.filter((check) => !good(check)).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
  ]
  const first = ordered[0]
  const cheapest = !!first && candidates.some((check) => good(check) && callCost(check) > callCost(first))
  return ordered.map((check, index) => ({
    provider: check.provider,
    model: check.model,
    accountId: check.accountId,
    ...(cheapest && index === 0 ? { cheapest: true as const } : {}),
  }))
}

/** What `agent_models` says about abilities: which provider offers each, and which are not available here. */
export interface AbilityListing {
  available: { ability: Ability; providers: { provider: AgentProvider; model: string }[]; tool?: AbilityTool }[]
  unavailable: Ability[]
  off: Ability[]
}

export function abilityListing(
  preferences: AbilityPreferences,
  checks: readonly AbilityCheck[],
  order: readonly AgentProvider[],
  currentAccount: (provider: AgentProvider) => string,
): AbilityListing {
  const listing: AbilityListing = { available: [], unavailable: [], off: [] }
  for (const ability of ABILITIES) {
    const routes = abilityRoutes(ability, preferences, checks, order, currentAccount)
    if (routes === null) listing.off.push(ability)
    else if (!routes.length) listing.unavailable.push(ability)
    else {
      const tool = (Object.keys(ABILITY_TOOLS) as AbilityTool[]).find((name) => ABILITY_TOOLS[name] === ability)
      listing.available.push({
        ability,
        providers: routes.map(({ provider, model }) => ({ provider, model })),
        ...(tool ? { tool } : {}),
      })
    }
  }
  return listing
}

/** A source an ability call cited, such as a web search result. */
export interface AbilitySource {
  title: string
  url: string
}

/**
 * One ability call as the thread shows it. `provider` is `ramu` for Ramu's own keyless search. `sent` is exactly what
 * went to the other provider.
 */
export interface AbilityCall {
  id: string
  ability: Ability
  tool: AbilityTool
  status: 'done' | 'failed' | 'refused'
  provider?: AgentProvider | 'ramu'
  model?: string
  /** The Shared MCP server and tool that ran it, when the ability is mapped to one. */
  mcp?: { server: string; tool: string }
  sent: { prompt: string; inputs: string[] }
  /** The caller's arguments, so the person can run the same call again. */
  args: Record<string, unknown>
  summary: string
  attachments?: Attachment[]
  sources?: AbilitySource[]
  /** Why a refused call was refused: no provider has it, the person turned it Off, or declined the approval. */
  refusal?: 'unavailable' | 'off' | 'declined' | 'limited'
  tokens?: { input: number; output: number }
  /** What the provider reported the call cost, in US dollars. */
  costUsd?: number
  /** Auto chose the provider as the cheapest good-enough one. */
  cheapest?: true
  durationMs?: number
}
