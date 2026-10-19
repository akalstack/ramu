import type { AgentEvent, AgentProvider, AgentSettings, FallbackPreferences, HandoffInfo } from '../types'

/** Present while every provider is at its usage limit: Ramu keeps the chat, queues new messages and retries on its own. */
export function providerWaitOf(events: readonly AgentEvent[]): { retryAt: number } | null {
  const last = events.findLast((event) => event.kind === 'provider-wait')
  return last?.kind === 'provider-wait' && last.retryAt !== null ? { retryAt: last.retryAt } : null
}

/** What a thread at a usage limit shows: when it is expected to continue and how sure that time is. */
export interface ProviderWaitState {
  retryAt: number
  /** True when `retryAt` is a backoff guess rather than a reset time the provider reported. */
  guessed: boolean
  provider?: AgentProvider
  accountId?: string
  /** The user was already told the limit reset while auto-resume is off. */
  resetNotified: boolean
  /** Extra cause shown next to the limit, such as a handoff that did not fit another model. */
  reason?: string
}

/** The open limit wait with everything the tray, sidebar and composer need, or null when the thread is not at a limit. */
export function providerWaitState(events: readonly AgentEvent[]): ProviderWaitState | null {
  const last = events.findLast((event) => event.kind === 'provider-wait')
  if (last?.kind !== 'provider-wait' || last.retryAt === null) return null
  return {
    retryAt: last.retryAt,
    guessed: last.guessed === true,
    ...(last.provider ? { provider: last.provider } : {}),
    ...(last.accountId ? { accountId: last.accountId } : {}),
    resetNotified: last.resetNotifiedAt !== undefined,
    ...(last.reason ? { reason: last.reason } : {}),
  }
}

/**
 * Whether a thread at a usage limit continues by itself: the thread's own choice, else the global default (true when
 * unset). `source` says where the answer came from, for "On (default)" and "Off" labels. A sub-agent or advisor passes
 * its parent's settings as `inherit`, since it follows its parent's effective value.
 */
export function effectiveAutoResume(
  settings: Pick<AgentSettings, 'autoResume'>,
  fallback: Partial<Pick<FallbackPreferences, 'autoResume'>> | undefined,
  inherit?: Pick<AgentSettings, 'autoResume'>,
): { value: boolean; source: 'thread' | 'default' } {
  if (settings.autoResume !== undefined) return { value: settings.autoResume, source: 'thread' }
  if (inherit?.autoResume !== undefined) return { value: inherit.autoResume, source: 'thread' }
  return { value: fallback?.autoResume !== false, source: 'default' }
}

/** The rows of the limit tray, so every client words a thread at a limit the same way. */
export type LimitTrayCase =
  /** Auto-resume on, reset known and ahead: continues by itself. A quiet "Try anyway". */
  | 'auto-known'
  /** Auto-resume on, reset unknown or guessed: checking every few minutes. "Try again" is primary. */
  | 'auto-unknown'
  /** Auto-resume off, reset known and ahead. A quiet "Try anyway". */
  | 'off-known'
  /** Auto-resume off, reset unknown or guessed. "Try again" is primary. */
  | 'off-unknown'
  /** The limit has reset and nothing ran on its own. "Resume" is primary. */
  | 'reset-off'

/**
 * Which tray row applies. With auto-resume on, a reset that is already behind us is about to be picked up by the timer,
 * so it still reads as automatic; only auto-resume off turns it into the "nothing ran on its own" row.
 */
export function limitTrayCase(
  wait: Pick<ProviderWaitState, 'retryAt' | 'guessed'>,
  autoResume: boolean,
  now = Date.now(),
): LimitTrayCase {
  const known = !wait.guessed && wait.retryAt > now
  if (autoResume) return known ? 'auto-known' : 'auto-unknown'
  if (!wait.guessed && wait.retryAt <= now) return 'reset-off'
  return known ? 'off-known' : 'off-unknown'
}

/** What `agent.retryLimitNow` returns. */
export interface LimitRetryResult {
  /** The continuation was sent: capacity was shown, or the provider has no usage reading. */
  resumed: boolean
  /** When the limit is now expected to lift, if the thread is still limited. */
  retryAt: number | null
  guessed: boolean
}

/** The parts of a handoff the transcript line shows, so every client words "Carried events 1–412 from Claude" the same way. */
export function handoffSummary(info: HandoffInfo | undefined): {
  mode: 'full' | 'delta'
  cause: HandoffInfo['cause']
  from?: AgentProvider
  range: [number, number] | null
  shortened: number
  omitted: number
  chars: number
} | null {
  if (!info) return null
  const delivered = info.toSeq !== undefined && info.toSeq > 0
  return {
    mode: info.mode,
    cause: info.cause,
    ...(info.from ? { from: info.from } : {}),
    range: delivered ? [info.fromSeq ?? 1, info.toSeq!] : null,
    shortened: info.shortened ?? 0,
    omitted: info.omitted ?? 0,
    chars: info.chars ?? 0,
  }
}

/** What a row of the limit tray says and offers. Clients put this in their own words and layout. */
export interface LimitTrayView {
  case: LimitTrayCase
  /** True when "Try again" (or "Resume") is the main button; otherwise the quiet "Try anyway". */
  primary: boolean
  /** Which button label: `resume` only after a limit that reset with nothing run on its own. */
  action: 'try-again' | 'try-anyway' | 'resume'
  /** A time to show: the reset when it is known, else absent. */
  resetAt?: number
}

/** The tray row, button and prominence for a wait. */
export function limitTrayView(
  wait: Pick<ProviderWaitState, 'retryAt' | 'guessed'>,
  autoResume: boolean,
  now = Date.now(),
): LimitTrayView {
  const kind = limitTrayCase(wait, autoResume, now)
  const known = kind === 'auto-known' || kind === 'off-known'
  return {
    case: kind,
    primary: !known,
    action: kind === 'reset-off' ? 'resume' : known ? 'try-anyway' : 'try-again',
    ...(known ? { resetAt: wait.retryAt } : {}),
  }
}
