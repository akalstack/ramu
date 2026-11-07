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

/** Abilities a Shared MCP tool can stand in for: the ones that take only text, so any such tool can be given it. */
export const MCP_ABILITIES: readonly Ability[] = ['image_generation', 'web_search']

/** A Shared MCP tool offered for mapping, with its server's name for the menu. */
export interface AbilityMcpToolOption extends AbilityMcpTool {
  server: string
}

export const isMcpChoice = (choice: AbilityChoice | undefined): choice is AbilityMcpTool =>
  typeof choice === 'object' && 'connectionId' in choice

export interface AbilityPreferences {
  choices: Partial<Record<Ability, AbilityChoice>>
  /** Each call routed to a provider other than the thread's own waits for the person's approval. */
  askBeforeOtherProvider: boolean
}
export const DEFAULT_ABILITY_PREFERENCES: AbilityPreferences = { choices: {}, askBeforeOtherProvider: false }

/** Where an ability call can run, in the order Ramu tries them. */
export interface AbilityRoute {
  provider: AgentProvider
  model: string
  accountId: string
}

/**
 * The providers a call tries, in order: a fixed choice alone, or with Auto every provider whose check passed, in the
 * person's fallback order (providers missing from it last). Only each provider's chosen login is used: moving to another
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
  return passed
    .slice()
    .sort((a, b) => rank(a.provider) - rank(b.provider))
    .flatMap((check) => {
      if (seen.has(check.provider)) return []
      seen.add(check.provider)
      return [{ provider: check.provider, model: check.model, accountId: check.accountId }]
    })
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
  durationMs?: number
}
