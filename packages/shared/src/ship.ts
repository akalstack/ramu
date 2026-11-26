import type { PullRequestInfo } from './types'
import type { ShipActivity, ShipProjectStatus } from './types/ship'

// Ship carries a thread's change toward a finish line: fixing checks and handling review rounds without the person
// pressing each step, and stopping where the project says. Decisions (approving, merging, production) stay theirs.

/** In the order a change reaches them; a later one includes every earlier one. */
export const FINISH_LINES = ['pull-request', 'review', 'merged', 'preview', 'live'] as const
export type FinishLine = (typeof FINISH_LINES)[number]

/** English copy keys for each finish line, translated where they are shown. */
export const FINISH_LINE_LABEL: Record<FinishLine, string> = {
  'pull-request': 'Pull request',
  review: 'Ready for review',
  merged: 'Merged',
  preview: 'Preview deploy',
  live: 'Live in production',
}

/** The earlier of two finish lines; a missing one sets no limit. */
export function earlierFinishLine(a: FinishLine, b: FinishLine | null | undefined): FinishLine {
  if (!b) return a
  return FINISH_LINES.indexOf(b) < FINISH_LINES.indexOf(a) ? b : a
}

export interface ShipLimits {
  /** Rounds of fixing failing checks the loop runs before asking the person. */
  maxCiFixes: number
  /** Rounds of review comments the loop answers before asking the person. */
  maxReviewRounds: number
}

export const DEFAULT_SHIP_LIMITS: ShipLimits = { maxCiFixes: 3, maxReviewRounds: 5 }

/**
 * What Ship may do for a project without stopping for the person. Each is one step a person would otherwise press,
 * and each is listed afterwards in Inbox's Done.
 */
export interface ShipOptions {
  /** After a review round, post the replies that only report a fix; ones that disagree or ask still wait. */
  sendReplies: boolean
  /** Turn on the Git host's own auto-merge once approved, so its branch protection still decides. */
  autoMerge: boolean
  /** After the project's first production deploy was allowed, later ones in a shipping thread run without asking. */
  autoDeploy: boolean
}
export const SHIP_OPTIONS = ['sendReplies', 'autoMerge', 'autoDeploy'] as const satisfies readonly (keyof ShipOptions)[]

/** A reviewer hears about a fix at once, and a personal project keeps deploying; merging is the one a person opts into. */
export const DEFAULT_SHIP_OPTIONS: ShipOptions = { sendReplies: true, autoMerge: false, autoDeploy: true }

/** English copy keys for each option, translated where they are shown. */
export const SHIP_OPTION_LABEL: Record<keyof ShipOptions, { title: string; help: string }> = {
  sendReplies: {
    title: 'Send replies that report a fix',
    help: 'After a review round, replies saying what was fixed go out at once. Replies that disagree or ask a question wait for you.',
  },
  autoMerge: {
    title: 'Merge when approved',
    help: 'Turns on the Git host’s auto-merge once the pull request is approved, so it merges when its checks pass and branch protection allows.',
  },
  autoDeploy: {
    title: 'Deploy to production without asking again',
    help: 'The first production deploy of this project asks. Later ones from a shipping thread run on their own and check the live address.',
  },
}

/**
 * The options a finish line gives a say in, in the order their steps happen: replies once people review, merging once
 * the line reaches it, production only when it ends there.
 */
export function shipOptionsFor(finishLine: FinishLine): (keyof ShipOptions)[] {
  const at = FINISH_LINES.indexOf(finishLine)
  return SHIP_OPTIONS.filter(
    (option) =>
      at >= FINISH_LINES.indexOf(option === 'sendReplies' ? 'review' : option === 'autoMerge' ? 'merged' : 'live'),
  )
}

/**
 * One option as a project's Ship settings show it: whether it is on, whether the repository keeps it with a person,
 * and the line under its title. The same on every device.
 */
export function shipOptionRow(
  status: Pick<ShipProjectStatus, 'options' | 'forbidden' | 'deployedOnce'>,
  option: keyof ShipOptions,
  t: (key: string, values?: Record<string, string | number>) => string,
): { title: string; help: string; on: boolean; locked: boolean } {
  const locked = status.forbidden.includes(option)
  return {
    title: t(SHIP_OPTION_LABEL[option].title),
    help: locked
      ? t('This repository’s ramu.json keeps this with a person.')
      : option === 'autoDeploy' && status.options.autoDeploy && !status.deployedOnce
        ? `${t(SHIP_OPTION_LABEL[option].help)} ${t('Applies after the first production deploy is allowed.')}`
        : t(SHIP_OPTION_LABEL[option].help),
    on: status.options[option],
    locked,
  }
}

/**
 * The options in force: the person's choices over the defaults, with anything the repository's committed `ramu.json`
 * forbids turned off. A repository can only take a step back to the person, never give one away.
 */
export function shipOptions(
  chosen: Partial<ShipOptions> | undefined,
  forbidden: Partial<Record<keyof ShipOptions, boolean>> = {},
): ShipOptions {
  const merged = { ...DEFAULT_SHIP_OPTIONS, ...chosen }
  return {
    sendReplies: merged.sendReplies && !forbidden.sendReplies,
    autoMerge: merged.autoMerge && !forbidden.autoMerge,
    autoDeploy: merged.autoDeploy && !forbidden.autoDeploy,
  }
}
export const MAX_SHIP_ROUNDS = 20

/** What Ramu can tell about a repository without asking the person. */
interface ShipRepository {
  /** The repository is on a Git host that has pull requests. */
  onGitHost: boolean
  /** It belongs to the signed-in account rather than an organization or someone else. */
  personal: boolean
  /** The project has a live address to check after a production deploy. */
  liveAddress: boolean
}

/**
 * The finish line a project starts with: a team's repository stops where people review, a personal one goes as far as
 * Ramu can check it. Without a Git host there is no pull request to stop at, so the loop ends with its commits.
 */
export function defaultFinishLine(repository: ShipRepository): FinishLine {
  if (!repository.onGitHost) return 'pull-request'
  if (!repository.personal) return 'review'
  return repository.liveAddress ? 'live' : 'merged'
}

/**
 * Where a shipping pull request is: still being worked on by the agent or its checks, waiting on reviewers with
 * nothing left for the agent to do, at its finish line, or waiting for the next step only the person decides (merging)
 * or the agent starts (deploying after the merge).
 */
export type ShipStep = 'working' | 'waiting' | 'reached' | 'merge' | 'deploy' | 'closed'

export function shipStep(
  pr: Pick<PullRequestInfo, 'state' | 'draft' | 'reviewDecision' | 'checks'>,
  finishLine: FinishLine,
): ShipStep {
  if (pr.state === 'closed') return 'closed'
  const at = FINISH_LINES.indexOf(finishLine)
  if (pr.state === 'merged') return at <= FINISH_LINES.indexOf('merged') ? 'reached' : 'deploy'
  const green = pr.checks.every((check) => check.state !== 'failure' && check.state !== 'pending')
  if (pr.draft || !green) return 'working'
  if (finishLine === 'pull-request') return 'reached'
  // Requested changes are the agent's to answer; anything else short of approval is a reviewer's turn.
  if (pr.reviewDecision === 'changes-requested') return 'working'
  if (pr.reviewDecision !== 'approved') return 'waiting'
  return finishLine === 'review' ? 'reached' : 'merge'
}

/** The finish lines a project may choose: those up to the repository's committed limit. */
export const reachableFinishLines = (status: Pick<ShipProjectStatus, 'repositoryLimit'>): FinishLine[] =>
  FINISH_LINES.filter(
    (line) => !status.repositoryLimit || FINISH_LINES.indexOf(line) <= FINISH_LINES.indexOf(status.repositoryLimit),
  )

/** What shipping does for this project, in the person's language, worded the same on every device. */
export function shipExplanation(
  status: ShipProjectStatus,
  t: (key: string, values?: Record<string, string | number>) => string,
): string[] {
  return [
    t(
      'Ask an agent to ship and it fixes failing checks and handles review rounds on its own, up to {0} and {1} rounds, then stops at {2}. Approving always asks you; merging and production deploys ask unless turned on below.',
      {
        0: status.limits.maxCiFixes,
        1: status.limits.maxReviewRounds,
        2: t(FINISH_LINE_LABEL[status.finishLine]),
      },
    ),
    ...(status.repositoryLimit
      ? [t('This repository’s ramu.json stops shipping at {0}.', { 0: t(FINISH_LINE_LABEL[status.repositoryLimit]) })]
      : []),
  ]
}

/** What undoing one thing Ship did asks first, the same on every device. */
export function shipUndoText(
  entry: Pick<ShipActivity, 'number' | 'url' | 'from' | 'to'> & Partial<Pick<ShipActivity, 'kind' | 'replies'>>,
  t: (key: string, values?: Record<string, string | number>) => string,
): { title: string; body: string; confirm: string } {
  const where = entry.number === null ? entry.url : `#${entry.number}`
  if (entry.kind === 'replies-sent')
    return {
      title: t('Delete these replies?'),
      body: t('Ramu deletes the replies it posted on {0}. The fixes stay pushed.', { 0: where }),
      confirm: t('Delete replies'),
    }
  return {
    title: t('Undo this fix?'),
    body: t('Ramu adds a commit that reverts {0} on {1} and pushes it, then tells the thread not to push it again.', {
      0: `${(entry.from ?? '').slice(0, 7)}..${(entry.to ?? '').slice(0, 7)}`,
      1: where,
    }),
    confirm: t('Undo fix'),
  }
}

/** How one thing Ship did unasked reads in Inbox's Done, the same on every device. */
export function shipActivityText(
  entry: Pick<ShipActivity, 'number' | 'from' | 'to' | 'undoneAt'> & Partial<Pick<ShipActivity, 'kind' | 'replies'>>,
  t: (key: string, values?: Record<string, string | number>) => string,
): { title: string; detail: string } {
  if (entry.kind === 'replies-sent')
    return {
      title: entry.number === null ? t('Replied to reviewers') : t('Replied to reviewers on #{0}', { 0: entry.number }),
      detail: entry.undoneAt
        ? t('Replies deleted')
        : entry.replies === 1
          ? t('1 reply reporting a fix')
          : t('{0} replies reporting fixes', { 0: entry.replies ?? 0 }),
    }
  return {
    title: entry.number === null ? t('Fixed failing checks') : t('Fixed failing checks on #{0}', { 0: entry.number }),
    detail: entry.undoneAt
      ? t('Undone with a revert')
      : t('Pushed {0}..{1}', { 0: (entry.from ?? '').slice(0, 7), 1: (entry.to ?? '').slice(0, 7) }),
  }
}
