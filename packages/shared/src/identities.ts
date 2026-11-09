// Identities: the accounts that belong together (work, personal, a client), picked from a project's folder or remote
// instead of switched by hand. An identity holds only references to accounts already connected on its host; credentials
// never move. Every account is for all identities until it is put in one ("shared unless split"). Pure, so the host,
// both clients and the copy between hosts agree on which identity a project has and which account it may use.
import { z } from 'zod'

export const IDENTITY_LIMIT = 12
export const IDENTITY_COLORS = ['violet', 'blue', 'green', 'amber', 'red', 'pink', 'teal', 'gray'] as const
export type IdentityColor = (typeof IDENTITY_COLORS)[number]

/** A folder rule (`~/work/**`) or a remote rule (`github.com/acme/*`, or a whole host `gitlab.acme.com/*`). */
export type IdentityRule = { kind: 'folder'; pattern: string } | { kind: 'remote'; host: string; owner: string }

export interface Identity {
  /** Stable across hosts: copying settings carries it, so a second copy updates instead of adding another "Work". */
  id: string
  name: string
  color: IdentityColor
  gitAuthor: { name: string; email: string; signingKey?: string }
  rules: IdentityRule[]
  /** The identity for projects no rule matches; exactly one is the default. */
  isDefault: boolean
  createdAt: number
}

/**
 * Which identities each account belongs to, by account key (see `accountKey`). An account that is absent, or listed
 * with no identities, is for every identity.
 */
export type IdentityAccounts = Record<string, string[]>

export interface IdentitySettings {
  identities: Identity[]
  accounts: IdentityAccounts
  /** Projects pinned to an identity from their menu, overriding the rules. */
  pins: Record<string, string>
  /** The project ids that were offered a rule from their remote's owner and answered, so they are not asked again. */
  offered?: string[]
}

export const EMPTY_IDENTITY_SETTINGS: IdentitySettings = { identities: [], accounts: {}, pins: {} }

/** The kinds of account an identity can hold. Each key names one connected account on this host. */
export type IdentityAccountKind = 'provider' | 'forge' | 'hosting' | 'media' | 'mcp' | 'plugin' | 'browser'

export const accountKey = (kind: IdentityAccountKind, ...parts: string[]) => [kind, ...parts].join(':')
/** Every account of one kind shares the key up to its last part: `provider:claude-code` for all Claude logins. */
export const accountKindOf = (key: string) => key.slice(0, key.lastIndexOf(':'))

const text = (max: number) => z.string().trim().min(1).max(max)
const rule = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('folder'), pattern: text(500) }),
  z.object({
    kind: z.literal('remote'),
    host: text(200).transform((value) => value.toLowerCase()),
    owner: text(200),
  }),
])
export const identitySchema = z.object({
  id: z.string().min(1).max(100),
  name: text(60),
  color: z.enum(IDENTITY_COLORS),
  gitAuthor: z.object({
    name: text(120),
    email: z
      .string()
      .trim()
      .max(200)
      .regex(/^[^\s@]+@[^\s@]+$/, 'Use an email address for the Git author.'),
    signingKey: z.string().trim().max(500).optional(),
  }),
  rules: z.array(rule).max(40),
  isDefault: z.boolean(),
  createdAt: z.number().int().nonnegative(),
})
export const identitySettingsSchema = z.object({
  identities: z.array(identitySchema).max(IDENTITY_LIMIT),
  accounts: z.record(z.string().max(400), z.array(z.string().max(100)).max(IDENTITY_LIMIT)),
  pins: z.record(z.string().max(200), z.string().max(100)),
  offered: z.array(z.string().max(200)).max(5000).optional(),
})

/** Checks that one identity is the default and every reference points at an identity that exists. */
export function normalizeIdentities(settings: IdentitySettings): IdentitySettings {
  const ids = new Set(settings.identities.map((identity) => identity.id))
  let identities = settings.identities
  if (identities.length && identities.filter((identity) => identity.isDefault).length !== 1) {
    const first = identities.find((identity) => identity.isDefault) ?? identities[0]!
    identities = identities.map((identity) => ({ ...identity, isDefault: identity.id === first.id }))
  }
  return {
    identities,
    accounts: Object.fromEntries(
      Object.entries(settings.accounts)
        .map(([key, list]) => [key, list.filter((id) => ids.has(id))] as const)
        .filter(([, list]) => list.length),
    ),
    pins: Object.fromEntries(Object.entries(settings.pins).filter(([, id]) => ids.has(id))),
    ...(settings.offered ? { offered: settings.offered } : {}),
  }
}

/** Glob to a regular expression: `**` crosses folders, `*` stays within one, `~` is the home folder. */
function folderPattern(pattern: string, home: string): RegExp {
  const expanded = pattern.replace(/^~(?=\/|$)/, home).replace(/\/+$/, '')
  const body = expanded
    .split('/')
    .map((part) =>
      part === '**'
        ? '.*'
        : part
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '[^/]*')
            .replace(/\?/g, '[^/]'),
    )
    .join('/')
  // A folder rule catches the folder itself and everything below it.
  return new RegExp(`^${body.replace(/\/\.\*$/, '(?:/.*)?')}(?:/.*)?$`)
}

/** A remote URL as host and owner: `git@github.com:acme/api.git` and `https://github.com/acme/api` both give acme. */
export function remoteOwner(remote: string): { host: string; owner: string } | null {
  const scp = /^[\w.-]+@([\w.-]+):([^/]+)\/.+$/.exec(remote)
  if (scp) return { host: scp[1]!.toLowerCase(), owner: scp[2]! }
  try {
    const url = new URL(remote)
    const parts = url.pathname.split('/').filter(Boolean)
    return parts.length >= 2 ? { host: url.hostname.toLowerCase(), owner: parts[0]! } : null
  } catch {
    return null
  }
}

export interface ProjectPlace {
  id: string
  /** Absolute folders of the project and its repositories. */
  folders: string[]
  /** Origin remote URLs of its repositories. */
  remotes: string[]
}

/**
 * How specific a rule's match is: a remote owner beats a whole remote host, which beats any folder; a deeper folder
 * beats a shallower one. Null when the rule does not match.
 */
function ruleScore(rule: IdentityRule, project: ProjectPlace, home: string): number | null {
  if (rule.kind === 'remote') {
    const host = rule.host.toLowerCase()
    for (const remote of project.remotes) {
      const parsed = remoteOwner(remote)
      if (!parsed || parsed.host !== host) continue
      if (rule.owner === '*') return 2000
      if (parsed.owner.toLowerCase() === rule.owner.toLowerCase()) return 3000
    }
    return null
  }
  const pattern = folderPattern(rule.pattern, home)
  if (!project.folders.some((folder) => pattern.test(folder.replace(/\/+$/, '')))) return null
  return rule.pattern
    .replace(/\/\*\*$/, '')
    .split('/')
    .filter(Boolean).length
}

/** The identity a project acts as, and why: pinned from its menu, caught by a rule, or the default. */
export function identityFor(
  project: ProjectPlace,
  settings: IdentitySettings,
  home: string,
): { identity: Identity; reason: 'pinned' | 'rule' | 'default'; rule?: IdentityRule } | null {
  const { identities } = settings
  if (!identities.length) return null
  const pinned = settings.pins[project.id] && identities.find((identity) => identity.id === settings.pins[project.id])
  if (pinned) return { identity: pinned, reason: 'pinned' }
  let best: { identity: Identity; rule: IdentityRule; score: number } | null = null
  for (const identity of identities)
    for (const candidate of identity.rules) {
      const score = ruleScore(candidate, project, home)
      if (score !== null && (!best || score > best.score)) best = { identity, rule: candidate, score }
    }
  if (best) return { identity: best.identity, reason: 'rule', rule: best.rule }
  const fallback = identities.find((identity) => identity.isDefault) ?? identities[0]!
  return { identity: fallback, reason: 'default' }
}

/** Whether an account may be used under an identity: its own, or one for every identity. Never another's. */
export function accountAllowed(key: string, identityId: string | null, accounts: IdentityAccounts): boolean {
  const owners = accounts[key]
  if (!owners?.length || identityId === null) return true
  return owners.includes(identityId)
}

/**
 * The accounts of one kind an identity may use, best first: its own accounts, then those for every identity. An
 * identity with its own account of a kind never falls back to a shared one of that kind ("split").
 */
export function accountsFor<T>(
  candidates: readonly T[],
  keyOf: (candidate: T) => string,
  identityId: string | null,
  accounts: IdentityAccounts,
): T[] {
  if (identityId === null) return [...candidates]
  const own = candidates.filter((candidate) => accounts[keyOf(candidate)]?.includes(identityId))
  if (own.length) return own
  return candidates.filter((candidate) => !accounts[keyOf(candidate)]?.length)
}

/** The environment that makes Git calls in a project commit as its identity. */
export function gitAuthorEnvironment(identity: Pick<Identity, 'gitAuthor'>): Record<string, string> {
  const { name, email } = identity.gitAuthor
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email }
}

/** A rule to offer when a project's remote owner matches nothing yet: "Projects from github.com/acme use Work?" */
export function suggestedRule(project: ProjectPlace, settings: IdentitySettings): IdentityRule | null {
  if (settings.offered?.includes(project.id) || settings.pins[project.id]) return null
  for (const remote of project.remotes) {
    const parsed = remoteOwner(remote)
    if (!parsed) continue
    const caught = settings.identities.some((identity) =>
      identity.rules.some(
        (entry) =>
          entry.kind === 'remote' &&
          entry.host === parsed.host &&
          entry.owner.toLowerCase() === parsed.owner.toLowerCase(),
      ),
    )
    if (!caught) return { kind: 'remote', host: parsed.host, owner: parsed.owner }
  }
  return null
}

export const ruleText = (entry: IdentityRule) =>
  entry.kind === 'folder' ? entry.pattern : `${entry.host}/${entry.owner === '*' ? '*' : entry.owner}`

/** Parses a rule as a person types it: a path is a folder rule, `host/owner` a remote rule. */
export function parseRule(input: string): IdentityRule | null {
  const value = input.trim()
  if (!value) return null
  if (/^(~|\/)/.test(value)) return { kind: 'folder', pattern: value }
  const remote = /^(?:https?:\/\/)?([\w.-]+\.[a-z]{2,})\/([\w.-]+|\*)\/?\*?$/i.exec(value)
  return remote ? { kind: 'remote', host: remote[1]!.toLowerCase(), owner: remote[2]! } : null
}

/** Which knowledge level a note belongs to: this project, every project of an identity, or everywhere. */
export type KnowledgeLevel =
  { kind: 'project'; projectId: string } | { kind: 'identity'; identityId: string } | { kind: 'everywhere' }

/** Whether a note at `level` is recalled in a project with `identityId`. */
export function levelApplies(
  level: KnowledgeLevel,
  project: { projectId: string | null; identityId: string | null },
): boolean {
  if (level.kind === 'everywhere') return true
  if (level.kind === 'identity') return project.identityId === level.identityId
  return project.projectId === level.projectId
}

/**
 * The mismatch the guardrail names before a commit, push, pull request, merge, deploy or release: the account about to
 * be used belongs to another identity than the project's. Null when it may act.
 */
export function identityMismatch(
  key: string,
  project: Identity | null,
  settings: Pick<IdentitySettings, 'accounts' | 'identities'>,
): { expected: Identity; actual: Identity } | null {
  if (!project) return null
  const owners = settings.accounts[key]
  if (!owners?.length || owners.includes(project.id)) return null
  const actual = settings.identities.find((identity) => identity.id === owners[0])
  return actual ? { expected: project, actual } : null
}

/** The sentence the Continue sheet and an agent's refusal use when two hosts commit as different people. */
export function crossHostWarning(from: string, to: string, host: string): string | null {
  if (from.trim().toLowerCase() === to.trim().toLowerCase()) return null
  return `This thread is ${from}. On ${host} it would run as ${to}.`
}

/** A project's identity as a chip shows it. */
export interface ProjectIdentity {
  projectId: string
  identityId: string
  name: string
  color: IdentityColor
  email: string
  reason: 'pinned' | 'rule' | 'default'
}

/** One connected account an identity can hold. Names only; never a credential. */
export interface IdentityAccountOption {
  key: string
  kind: IdentityAccountKind
  label: string
  /** The sign-in email when the account names one, for matching accounts across hosts. */
  email: string | null
}

export interface IdentitySnapshot {
  settings: IdentitySettings
  projects: ProjectIdentity[]
  accounts: IdentityAccountOption[]
  /** Projects whose remote owner no rule catches yet: "Projects from github.com/acme use Work?" */
  suggestions?: { projectId: string; rule: IdentityRule }[]
  /** The host's global Git `user.name` and `user.email`, offered as the first identity's author. */
  gitUser: { name: string | null; email: string | null }
}

/** Identities show up once a second account of any kind exists, or once there are identities already. */
export function identitiesOffered(snapshot: Pick<IdentitySnapshot, 'settings' | 'accounts'>): boolean {
  if (snapshot.settings.identities.length) return true
  const kinds = new Map<string, number>()
  for (const account of snapshot.accounts)
    if (account.kind !== 'browser' && account.kind !== 'mcp' && account.kind !== 'plugin')
      kinds.set(accountKindOf(account.key), (kinds.get(accountKindOf(account.key)) ?? 0) + 1)
  return [...kinds.values()].some((count) => count >= 2)
}

/** The account key of a GitHub account choice: a saved connection, or a `gh` sign-in by login. */
export function forgeAccountKey(choice: string | null): string | null {
  if (!choice || choice === 'cli') return null
  return choice.startsWith('cli:')
    ? accountKey('forge', 'github', `cli-${choice.slice(4)}`)
    : accountKey('forge', 'github', choice)
}

/** The choice `forge.setRepositoryAccount` takes for an account key, the reverse of `forgeAccountKey`. */
export function forgeChoiceOf(key: string): string | null {
  if (!key.startsWith('forge:github:')) return null
  const id = key.slice('forge:github:'.length)
  return id.startsWith('cli-') ? `cli:${id.slice(4)}` : id
}

/** What the guardrail stopped, so the card can offer Use ‹project identity› or Continue as ‹the other›. */
export interface IdentityMismatch {
  projectId: string | null
  action: string
  accountKey: string
  expected: { id: string; name: string; email: string }
  actual: { id: string; name: string; email: string }
  at: number
}
