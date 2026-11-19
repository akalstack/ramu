// Identities on this host: their settings, and which one each project acts as. A project's identity is looked up when
// an action runs, never stored on a thread, schedule or page, so pinning a project to another identity takes effect
// everywhere at once.
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import {
  EMPTY_IDENTITY_SETTINGS,
  IDENTITY_COLORS,
  IDENTITY_LIMIT,
  accountAllowed,
  accountsFor,
  gitAuthorEnvironment,
  identityFor,
  identityMismatch,
  identitySchema,
  identitySettingsSchema,
  normalizeIdentities,
  suggestedRule,
  type Identity,
  type IdentityRule,
  type IdentitySettings,
  type IdentityMismatch,
  type ProjectIdentity,
  type ProjectPlace,
  forgeChoiceOf,
} from '@ramu/shared/identities'

const KEY = 'identities:v1'

export interface IdentityHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** Each project's folders and origin remotes. Remotes are read from the repositories' Git config. */
  places(): ProjectPlace[]
  changed(): void
  home?: string
  /** Tells the person's devices that the guardrail stopped an action, so the card opens where they are. */
  mismatched?(mismatch: IdentityMismatch): void
  /** `user.name` and `user.email` from the host's global Git config: the fallback email, and a first identity's author. */
  gitUser?(): { name: string | null; email: string | null }
}

export class IdentityService {
  private readonly home: string
  private readonly allowances = new Map<string, number>()
  private readonly mismatches = new Map<string, IdentityMismatch>()
  constructor(private readonly host: IdentityHost) {
    this.home = host.home ?? homedir()
  }

  settings(): IdentitySettings {
    const saved = this.host.getState<unknown>(KEY, null)
    const parsed = identitySettingsSchema.safeParse(saved)
    return parsed.success ? normalizeIdentities(parsed.data) : EMPTY_IDENTITY_SETTINGS
  }

  private save(settings: IdentitySettings) {
    const next = normalizeIdentities(identitySettingsSchema.parse(settings))
    this.host.setState(KEY, next)
    this.host.changed()
    return next
  }

  /** Replaces every identity's fields at once, as the Settings page and a copy from another host do. */
  replace(settings: IdentitySettings) {
    return this.save(settings)
  }

  add(input: {
    name: string
    gitAuthor: Identity['gitAuthor']
    rules?: IdentityRule[]
    color?: Identity['color']
    id?: string
  }) {
    const settings = this.settings()
    if (settings.identities.length >= IDENTITY_LIMIT) throw new Error(`Keep at most ${IDENTITY_LIMIT} identities.`)
    if (settings.identities.some((identity) => identity.name.toLowerCase() === input.name.trim().toLowerCase()))
      throw new Error(`An identity named ${input.name.trim()} already exists.`)
    const identity = identitySchema.parse({
      id: input.id ?? randomUUID(),
      name: input.name,
      color: input.color ?? IDENTITY_COLORS[settings.identities.length % IDENTITY_COLORS.length],
      gitAuthor: input.gitAuthor,
      rules: input.rules ?? [],
      isDefault: settings.identities.length === 0,
      createdAt: Date.now(),
    })
    this.save({ ...settings, identities: [...settings.identities, identity] })
    return identity
  }

  update(id: string, patch: Partial<Pick<Identity, 'name' | 'color' | 'gitAuthor' | 'rules' | 'isDefault'>>) {
    const settings = this.settings()
    if (!settings.identities.some((identity) => identity.id === id))
      throw new Error('That identity is not on this host.')
    const identities = settings.identities.map((identity) =>
      identity.id === id
        ? identitySchema.parse({ ...identity, ...patch })
        : patch.isDefault
          ? { ...identity, isDefault: false }
          : identity,
    )
    return this.save({ ...settings, identities })
  }

  /** Removes an identity; its pinned projects and accounts move to `moveTo` (or become shared). */
  remove(id: string, moveTo: string | null) {
    const settings = this.settings()
    if (moveTo === id) throw new Error('Choose another identity for its projects.')
    const identities = settings.identities.filter((identity) => identity.id !== id)
    const pins = Object.fromEntries(
      Object.entries(settings.pins).flatMap(([project, identity]) =>
        identity !== id ? [[project, identity]] : moveTo ? [[project, moveTo]] : [],
      ),
    )
    // Projects a rule of the removed identity caught follow it to the chosen one.
    if (moveTo)
      for (const place of this.host.places()) {
        const before = identityFor(place, settings, this.home)
        if (before?.identity.id === id && !pins[place.id]) pins[place.id] = moveTo
      }
    const accounts = Object.fromEntries(
      Object.entries(settings.accounts).map(([key, list]) => [
        key,
        [...new Set(list.map((entry) => (entry === id ? moveTo : entry)).filter((entry): entry is string => !!entry))],
      ]),
    )
    const wasDefault = settings.identities.find((identity) => identity.id === id)?.isDefault
    return this.save({
      ...settings,
      identities: identities.map((identity) => ({
        ...identity,
        isDefault: wasDefault ? identity.id === (moveTo ?? identities[0]?.id) : identity.isDefault,
      })),
      pins,
      accounts,
    })
  }

  /** Pins a project to an identity from its menu, or back to its rules with null. */
  pin(projectId: string, identityId: string | null) {
    const settings = this.settings()
    const { [projectId]: _previous, ...pins } = settings.pins
    if (identityId && !settings.identities.some((identity) => identity.id === identityId))
      throw new Error('That identity is not on this host.')
    return this.save({ ...settings, pins: identityId ? { ...pins, [projectId]: identityId } : pins })
  }

  /** Which identities an account is for; an empty list makes it shared again. */
  assign(accountKey: string, identityIds: string[]) {
    const settings = this.settings()
    const { [accountKey]: _previous, ...accounts } = settings.accounts
    return this.save({
      ...settings,
      accounts: identityIds.length ? { ...accounts, [accountKey]: identityIds } : accounts,
    })
  }

  /** Records that a project was offered a rule from its remote, whatever the answer. */
  offered(projectId: string) {
    const settings = this.settings()
    return this.save({ ...settings, offered: [...new Set([...(settings.offered ?? []), projectId])] })
  }

  private place(projectId: string): ProjectPlace {
    return this.host.places().find((place) => place.id === projectId) ?? { id: projectId, folders: [], remotes: [] }
  }

  /** The project's identity, or null when the host has none (or the thread is in no project). */
  forProject(projectId: string | null): Identity | null {
    if (!projectId) return this.defaultIdentity()
    return identityFor(this.place(projectId), this.settings(), this.home)?.identity ?? null
  }

  defaultIdentity(): Identity | null {
    const { identities } = this.settings()
    return identities.find((identity) => identity.isDefault) ?? null
  }

  /** Every project's identity, for the chips and grouping. */
  projects(): ProjectIdentity[] {
    const settings = this.settings()
    return this.host.places().flatMap((place) => {
      const found = identityFor(place, settings, this.home)
      return found
        ? [
            {
              projectId: place.id,
              identityId: found.identity.id,
              name: found.identity.name,
              color: found.identity.color,
              email: found.identity.gitAuthor.email,
              reason: found.reason,
            },
          ]
        : []
    })
  }

  suggestion(projectId: string): IdentityRule | null {
    const settings = this.settings()
    return settings.identities.length >= 2 ? suggestedRule(this.place(projectId), settings) : null
  }

  /** The Git author environment for processes Ramu starts in a project; empty with no identities. */
  environment(projectId: string | null): Record<string, string> {
    const identity = this.forProject(projectId)
    if (!identity) return {}
    const token = this.settings().identities.length >= 2 && projectId ? this.forgeTokens.get(projectId) : undefined
    return {
      ...gitAuthorEnvironment(identity),
      // The identity's own GitHub account for `gh` and for Git over https, so an agent's own push in a work project
      // goes as the work account: a helper for github.com that answers with this token, after clearing the others.
      ...(token
        ? {
            GH_TOKEN: token,
            GIT_CONFIG_COUNT: '2',
            GIT_CONFIG_KEY_0: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_0: '',
            GIT_CONFIG_KEY_1: 'credential.https://github.com.helper',
            GIT_CONFIG_VALUE_1:
              '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f',
          }
        : {}),
    }
  }

  /** Projects whose identity owns a saved GitHub connection, with its token; kept fresh by the forge side. */
  private forgeTokens = new Map<string, string>()
  setForgeTokens(tokens: Map<string, string>) {
    this.forgeTokens = tokens
  }

  /** The GitHub account choice a repository's project identity owns, for `ForgeAccountStore.identityChoice`. */
  forgeChoice(origin: string, owner: string, repo: string): string | null {
    if (this.settings().identities.length < 2) return null
    const wanted = `${origin}/${owner}/${repo}`.toLowerCase()
    const place = this.host.places().find((entry) =>
      entry.remotes.some((remote) => {
        const parsed = /^(?:[\w.-]+@)?([\w.-]+)[:/](.+?)(?:\.git)?\/?$/.exec(remote.replace(/^\w+:\/\//, ''))
        return parsed ? `${parsed[1]}/${parsed[2]}`.toLowerCase() === wanted : false
      }),
    )
    if (!place) return null
    const own = this.ownAccount(place.id, 'forge:github:any')
    return own ? forgeChoiceOf(own) : null
  }

  /**
   * The Git author email a thread commits as here, for comparing hosts: its identity's, or with no identities the
   * host's own Git config, so even a host that never set up identities can be compared.
   */
  email(place: string | null | ProjectPlace): string | null {
    const identity =
      place !== null && typeof place === 'object'
        ? identityFor(place, this.settings(), this.home)?.identity
        : this.forProject(place)
    return identity?.gitAuthor.email ?? this.gitUser().email
  }

  /** The host's global Git user, so setup can offer it as the first identity's author. */
  gitUser(): { name: string | null; email: string | null } {
    return this.host.gitUser?.() ?? { name: null, email: null }
  }

  allowed(projectId: string | null, accountKey: string): boolean {
    return accountAllowed(accountKey, this.forProject(projectId)?.id ?? null, this.settings().accounts)
  }

  /** Candidates of one kind the project's identity may use, its own first; see `accountsFor`. */
  choose<T>(projectId: string | null, candidates: readonly T[], keyOf: (candidate: T) => string): T[] {
    return accountsFor(candidates, keyOf, this.forProject(projectId)?.id ?? null, this.settings().accounts)
  }

  /** The last action the guardrail stopped in a project, for its card. */
  mismatch(projectId: string | null): IdentityMismatch | null {
    const found = this.mismatches.get(projectId ?? '')
    return found && Date.now() - found.at < 10 * 60_000 ? found : null
  }

  /** **Continue as ‹other›**: the stopped action may run once, within ten minutes. */
  continueAs(projectId: string | null) {
    const found = this.mismatch(projectId)
    if (!found) throw new Error('Nothing is waiting for that choice. Try the action again.')
    this.allowances.set(`${projectId ?? ''}:${found.accountKey}`, Date.now() + 10 * 60_000)
    this.mismatches.delete(projectId ?? '')
    return found
  }

  /** The project's identity's own account of the same kind as `accountKey`, for **Use ‹identity›**. */
  ownAccount(projectId: string | null, accountKey: string): string | null {
    const identity = this.forProject(projectId)
    if (!identity) return null
    const kind = accountKey.slice(0, accountKey.lastIndexOf(':'))
    return (
      Object.entries(this.settings().accounts).find(
        ([key, owners]) => key.slice(0, key.lastIndexOf(':')) === kind && owners.includes(identity.id),
      )?.[0] ?? null
    )
  }

  /** Throws the guardrail's refusal when the account belongs to another identity than the project's. */
  guard(projectId: string | null, accountKey: string, action: string) {
    const mismatch = identityMismatch(accountKey, this.forProject(projectId), this.settings())
    const allowance = `${projectId ?? ''}:${accountKey}`
    if (mismatch && (this.allowances.get(allowance) ?? 0) > Date.now()) {
      this.allowances.delete(allowance)
      return
    }
    if (mismatch) {
      const person = (identity: Identity) => ({ id: identity.id, name: identity.name, email: identity.gitAuthor.email })
      const stopped: IdentityMismatch = {
        projectId,
        action,
        accountKey,
        expected: person(mismatch.expected),
        actual: person(mismatch.actual),
        at: Date.now(),
      }
      this.mismatches.set(projectId ?? '', stopped)
      this.host.mismatched?.(stopped)
    }
    if (mismatch)
      throw new IdentityMismatchError(
        `${action} would act as ${mismatch.actual.name}, but this project is ${mismatch.expected.name}. Use ${mismatch.expected.name}, or continue as ${mismatch.actual.name} from the card.`,
        mismatch.expected,
        mismatch.actual,
      )
  }
}

export class IdentityMismatchError extends Error {
  constructor(
    message: string,
    readonly expected: Identity,
    readonly actual: Identity,
  ) {
    super(message)
  }
}
