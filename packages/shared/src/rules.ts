import type { AgentProvider } from './types/agent'
import type { TranslationValues } from './i18n'
import { RULE_PATH_LIMIT, RULE_PATTERN_LIMIT, RULE_TOTAL_LIMIT, type Rule } from './types/rules'

export interface RuleDelivery {
  /**
   * `system`: the runtime takes the rules as separate instructions it keeps for the whole session.
   * `first-message`: the runtime has no such slot, so the rules travel ahead of the first prompt in a labelled block.
   */
  path: 'system' | 'first-message'
  /** The most rule characters Ramu will hand this runtime in one session. */
  limit: number
  /** One sentence for the thread's setup list: how the rules arrive and what that does not guarantee. */
  detail: string
}

/** How each adapter receives Always rules, from what its launch code does today. */
export function ruleDelivery(provider: AgentProvider): RuleDelivery {
  if (provider === 'claude-code')
    return {
      path: 'system',
      limit: RULE_TOTAL_LIMIT,
      detail: "Appended to Claude's system prompt as the user's own instructions, labelled apart from Ramu's guidance.",
    }
  if (provider === 'codex')
    return {
      path: 'system',
      limit: RULE_TOTAL_LIMIT,
      detail: "Sent as Codex developer instructions, labelled as the user's own instructions.",
    }
  return {
    path: 'first-message',
    limit: RULE_TOTAL_LIMIT,
    detail:
      'This runtime has no separate instruction slot, so the rules went ahead of the first message in a labelled block. That is weaker than system instructions, and a restarted session does not receive them again. Changed rules are sent with your next message.',
  }
}

/** Why Always rules of this size cannot be handed to the runtime, or null when they fit. Rules are never trimmed. */
export function ruleDeliveryBlock(provider: AgentProvider, characters: number): string | null {
  const { limit } = ruleDelivery(provider)
  return characters > limit
    ? `Your enabled rules use ${characters} of the ${limit} characters this runtime can receive. Turn one off or shorten it in Settings → Agent setup → Rules; Ramu never trims rules silently.`
    : null
}

type Scoped = Pick<Rule, 'id' | 'name' | 'body' | 'projectId' | 'providers' | 'activation' | 'enabled' | 'paths'>

/** The line a path rule carries in instruction text, so a runtime without path activation still knows its scope. */
export const rulePathsLine = (paths: readonly string[]) =>
  `Applies when you work on files matching: ${paths.map((pattern) => `\`${pattern}\``).join(', ')}.`

/** Characters a rule adds to a thread's delivered rules; what the per-scope budget counts. */
export const ruleCharacters = (rule: Pick<Rule, 'name' | 'body' | 'activation' | 'paths'>) =>
  rule.name.length + rule.body.length + (rule.activation === 'paths' ? rulePathsLine(rule.paths).length + 1 : 0)

/** Whether Claude Code receives this rule as a path-scoped rules file Ramu writes, instead of instruction text. */
export const ruleWritesClaudeFile = (rule: Pick<Rule, 'enabled' | 'activation' | 'providers'>) =>
  rule.enabled && rule.activation === 'paths' && (!rule.providers.length || rule.providers.includes('claude-code'))

/** File patterns as saved: trimmed, a leading `./` dropped, blanks and repeats removed, order kept. */
export function normalizeRulePaths(patterns: readonly string[]): string[] {
  return [...new Set(patterns.map((line) => line.trim().replace(/^(\.\/)+/, '')).filter(Boolean))]
}

/** Why these normalized file patterns cannot be saved, as copy with its values, or null when they are fine. */
export function rulePathsProblem(paths: readonly string[]): { message: string; values: TranslationValues } | null {
  if (!paths.length) return { message: 'Add at least one file pattern, such as src/api/**.', values: {} }
  if (paths.length > RULE_PATH_LIMIT)
    return { message: 'Use up to {0} file patterns.', values: { '0': RULE_PATH_LIMIT } }
  for (const pattern of paths) {
    const values = { '0': pattern }
    if (pattern.length > RULE_PATTERN_LIMIT)
      return { message: 'Keep each file pattern to {0} characters or fewer.', values: { '0': RULE_PATTERN_LIMIT } }
    // eslint-disable-next-line no-control-regex -- control characters would break the rules file frontmatter.
    if (/[\u0000-\u001f\u007f]/.test(pattern)) return { message: '{0} contains a control character.', values }
    if (pattern.includes('\\')) return { message: 'Use / between folders in {0}.', values }
    if (/^(\/|~|[A-Za-z]:)/.test(pattern))
      return { message: '{0} must be relative to the repository, not an absolute path.', values }
    if (pattern.split('/').includes('..')) return { message: '{0} cannot use .. to leave the repository.', values }
  }
  return null
}

/** A rough token estimate for display (about four characters per token); the budget itself is in characters. */
export const estimatedTokens = (characters: number) => Math.ceil(characters / 4)

/** Always rules, and path rules, which runtimes without native path activation receive at session start. */
const delivered = (rule: Scoped) => rule.enabled && rule.activation !== 'manual'

export interface RuleScopeCost {
  /** Null: chats with no project, which receive only host-wide rules. */
  projectId: string | null
  /** Rules a thread in this scope can receive at most (host-wide plus the project's own, across providers). */
  rules: number
  characters: number
  limit: number
}

/**
 * The most rule text a new thread can receive in each scope: host-wide rules alone, then each project with project
 * rules as host-wide plus its own. Provider choices are ignored, so this is an upper bound for any one provider.
 */
export function ruleScopeCosts(rules: readonly Scoped[]): RuleScopeCost[] {
  const active = rules.filter(delivered)
  const host = active.filter((rule) => rule.projectId === null)
  const projects = [...new Set(active.flatMap((rule) => (rule.projectId === null ? [] : [rule.projectId])))].sort()
  const cost = (projectId: string | null, scoped: Scoped[]): RuleScopeCost => ({
    projectId,
    rules: scoped.length,
    characters: scoped.reduce((sum, rule) => sum + ruleCharacters(rule), 0),
    limit: RULE_TOTAL_LIMIT,
  })
  return [
    cost(null, host),
    ...projects.map((id) => cost(id, [...host, ...active.filter((rule) => rule.projectId === id)])),
  ]
}

export interface RuleDuplicate {
  /** `text`: the same instructions after whitespace is normalised. `name`: the same name, ignoring case. */
  kind: 'text' | 'name'
  /** The other rules, by id, in list order. */
  others: string[]
}

const sameText = (body: string) => body.trim().replace(/\s+/g, ' ')
const overlaps = (a: Scoped, b: Scoped) =>
  (a.projectId === null || b.projectId === null || a.projectId === b.projectId) &&
  (!a.providers.length || !b.providers.length || a.providers.some((provider) => b.providers.includes(provider)))

/**
 * Enabled rules that a single thread could receive together and that repeat one another: identical text, or the same
 * name (so one may be meant to replace the other). Rules are additive, so Ramu warns instead of choosing one. Exact text
 * wins over a name match. Disabled rules are not compared.
 */
export function ruleDuplicates(rules: readonly Scoped[]): Map<string, RuleDuplicate> {
  const result = new Map<string, RuleDuplicate>()
  const enabled = rules.filter((rule) => rule.enabled)
  for (const rule of enabled) {
    const peers = enabled.filter((other) => other.id !== rule.id && overlaps(rule, other))
    const text = peers.filter((other) => sameText(other.body) === sameText(rule.body))
    const name = peers.filter((other) => other.name.toLowerCase() === rule.name.toLowerCase())
    if (text.length) result.set(rule.id, { kind: 'text', others: text.map((other) => other.id) })
    else if (name.length) result.set(rule.id, { kind: 'name', others: name.map((other) => other.id) })
  }
  return result
}
