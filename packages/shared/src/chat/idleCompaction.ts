import type { AgentQuestion } from '../types'

/**
 * What Ramu does with a long Claude thread left idle. `onReturn` asks when you come back to it, `beforeCacheExpires`
 * compacts it shortly before its prompt cache expires (and still asks on return when that did not happen), `off`
 * keeps the full history without asking.
 */
export const IDLE_COMPACTION_MODES = ['onReturn', 'beforeCacheExpires', 'off'] as const
export type IdleCompactionMode = (typeof IDLE_COMPACTION_MODES)[number]
export const DEFAULT_IDLE_COMPACTION: IdleCompactionMode = 'onReturn'

/**
 * Context below which an idle compaction is not worth what it loses: re-reading a smaller conversation cold is cheap.
 * Matches Claude Code's own idle-compaction default.
 */
export const IDLE_COMPACTION_MIN_TOKENS = 200_000

/** How long before the cache expires the compaction starts, so its request still reads the warm cache. */
export const IDLE_COMPACTION_LEAD_MS = 2 * 60_000

/**
 * The prompt-cache lifetime one Claude response wrote, from its usage: 1 hour on subscriptions, 5 minutes on API keys.
 * Undefined when the response wrote no cache entry (it was read fully from cache, or caching was off).
 */
export function promptCacheTtlMs(
  cacheCreation:
    { ephemeral_1h_input_tokens?: number | null; ephemeral_5m_input_tokens?: number | null } | null | undefined,
): number | undefined {
  if ((cacheCreation?.ephemeral_1h_input_tokens ?? 0) > 0) return 60 * 60_000
  if ((cacheCreation?.ephemeral_5m_input_tokens ?? 0) > 0) return 5 * 60_000
  return undefined
}

/** Claude's last main-thread request of a turn: when it was made, how long its cache lives and what it re-sends. */
export interface CachedRequest {
  at: number
  ttlMs: number
  contextTokens: number
}

/**
 * When an idle Claude thread should compact, or null when it should not: only in `beforeCacheExpires`, only for a
 * large context, and only while the last request's cache is still warm. A cache read refreshes the cache, so the
 * window always counts from the latest request.
 */
export function idleCompactionWindow(
  mode: IdleCompactionMode,
  request: CachedRequest | undefined,
  now: number,
): { startMs: number; endMs: number } | null {
  if (mode !== 'beforeCacheExpires' || !request) return null
  if (!Number.isFinite(request.contextTokens) || request.contextTokens < IDLE_COMPACTION_MIN_TOKENS) return null
  const endMs = request.at + request.ttlMs
  if (!Number.isFinite(endMs) || now >= endMs) return null
  return { startMs: endMs - IDLE_COMPACTION_LEAD_MS, endMs }
}

/** What a thread is doing that a compaction must not cut into. */
export interface IdleThread {
  idle: boolean
  /** Questions, approvals or input requests still waiting for the person. */
  pendingRequests: boolean
  /** Helpers or background commands that report into the next turn; a compaction would swallow their report. */
  backgroundWork: boolean
  queuedMessages: boolean
  /** A goal Ramu continues on its own, or a usage-limit wait that resumes the thread. */
  continuesOnItsOwn: boolean
  /** The person marked the thread done. */
  done: boolean
  /** The turn that just ended compacted the conversation already (a manual /compact or Claude's own). */
  justCompacted: boolean
}

/** Whether anything holds an idle compaction back. Each of these starts a new turn or ends the thread anyway. */
export function idleCompactionHeld(thread: IdleThread): boolean {
  return (
    !thread.idle ||
    thread.pendingRequests ||
    thread.backgroundWork ||
    thread.queuedMessages ||
    thread.continuesOnItsOwn ||
    thread.done ||
    thread.justCompacted
  )
}

/** Answers to the return question. The server matches these labels; reword them only here. */
export const RESUME_COMPACTION_ANSWERS = {
  compact: 'Compact and continue',
  keep: 'Keep full history',
  never: "Don't ask again",
} as const

const finite = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

/** `45m`, `2h 5m`, `3d 4h`: how long a thread has been idle. */
export function idleAge(minutes: number): string {
  const m = finite(minutes)
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.floor(m / (24 * 60))}d ${Math.floor((m % (24 * 60)) / 60)}h`
}

/**
 * The question Claude's return prompt becomes in the thread. "Don't ask again" is offered only in `onReturn`; in
 * `beforeCacheExpires` it would also turn idle compaction off, which belongs in Settings.
 */
export function resumeCompactionQuestion(
  payload: Record<string, unknown>,
  mode: Exclude<IdleCompactionMode, 'off'>,
): AgentQuestion {
  const tokens = finite(payload.estimatedTokens).toLocaleString('en-US')
  return {
    header: 'Long thread',
    question: `This thread was last active ${idleAge(finite(payload.sessionAgeMinutes))} ago and holds about ${tokens} tokens. Compact it before continuing?`,
    multiSelect: false,
    options: [
      {
        label: RESUME_COMPACTION_ANSWERS.compact,
        description: 'Summarize the earlier conversation first. Later replies read less.',
      },
      {
        label: RESUME_COMPACTION_ANSWERS.keep,
        description: 'Continue with the whole conversation. The next reply re-reads all of it.',
      },
      ...(mode === 'onReturn'
        ? [
            {
              label: RESUME_COMPACTION_ANSWERS.never,
              description: 'Keep full history now and from now on. Change it in Settings → Threads.',
            },
          ]
        : []),
    ],
  }
}

/** What the person chose; anything unrecognized keeps the history, the choice that loses nothing. */
export function resumeCompactionChoice(answer: string | undefined): 'compact' | 'continue' | 'never' {
  const chosen = answer?.trim()
  if (chosen === RESUME_COMPACTION_ANSWERS.compact) return 'compact'
  if (chosen === RESUME_COMPACTION_ANSWERS.never) return 'never'
  return 'continue'
}
