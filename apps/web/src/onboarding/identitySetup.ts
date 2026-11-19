import { identitySchema, parseRule, type IdentityRule, type IdentitySnapshot } from '@ramu/shared/identities'

/** One identity as the onboarding form holds it; `rule` is the text a person types, such as `~/work/**`. */
export interface IdentityDraft {
  name: string
  author: string
  email: string
  rule: string
}

/** What the person chose to set up: nothing yet (the default), Personal only, or Personal and Work. */
export type IdentityChoice = 'none' | 'personal' | 'both'

export interface IdentityDrafts {
  choice: IdentityChoice
  /** Prefilled from the host's Git user, and used only once the person chooses Personal. */
  personal: IdentityDraft
  /** Made when the person chooses Personal and Work. */
  work: IdentityDraft | null
}

/** Nothing is chosen at first; choosing Personal finds it filled in from the host's global Git user. */
export function identityDrafts(snapshot: Pick<IdentitySnapshot, 'gitUser'>, personal: string): IdentityDrafts {
  return {
    choice: 'none',
    personal: { name: personal, author: snapshot.gitUser.name ?? '', email: snapshot.gitUser.email ?? '', rule: '' },
    work: null,
  }
}

/** A work identity starts with the same author name; only the email and the rule that picks it differ. */
export const workDraft = (personal: IdentityDraft, work: string): IdentityDraft => ({
  name: work,
  author: personal.author,
  email: '',
  rule: '',
})

interface IdentityToAdd {
  name: string
  gitAuthor: { name: string; email: string }
  rules: IdentityRule[]
}

/** Which part of a draft is wrong, so the form can say so beside it. */
export type IdentityProblem = { which: 'personal' | 'work'; field: 'name' | 'author' | 'email' | 'rule' }

/**
 * The identities to create for what the person chose, in order (the first becomes the default), or the first field
 * that needs fixing. Choosing nothing creates nothing.
 */
export function identitiesToAdd(drafts: IdentityDrafts): { add: IdentityToAdd[] } | { problem: IdentityProblem } {
  const add: IdentityToAdd[] = []
  if (drafts.choice === 'none') return { add }
  const entries = [
    ['personal', drafts.personal],
    ['work', drafts.choice === 'both' ? drafts.work : null],
  ] as const
  for (const [which, draft] of entries) {
    if (!draft) continue
    const rule = draft.rule.trim() ? parseRule(draft.rule) : null
    if (draft.rule.trim() && !rule) return { problem: { which, field: 'rule' } }
    const parsed = identitySchema.shape.name.safeParse(draft.name)
    if (!parsed.success) return { problem: { which, field: 'name' } }
    const author = identitySchema.shape.gitAuthor.safeParse({ name: draft.author, email: draft.email })
    if (!author.success)
      return {
        problem: { which, field: author.error.issues.some((issue) => issue.path[0] === 'name') ? 'author' : 'email' },
      }
    if (add.some((entry) => entry.name.toLowerCase() === parsed.data.toLowerCase()))
      return { problem: { which, field: 'name' } }
    add.push({ name: parsed.data, gitAuthor: author.data, rules: rule ? [rule] : [] })
  }
  return { add }
}
