import type { AgentEvent, AgentProvider, HandoffCause, HandoffInfo } from '@ramu/shared/types'
import { buildHandoff, handoffBudgetBytes, DEFAULT_CONTEXT_TOKENS, type BuiltHandoff } from './handoff'
import type { Db } from '../db'

/** A provider session a thread used before, and the last event of the thread it saw. */
export interface SavedProviderSession {
  providerSessionId: string
  /** The thread's event count when the thread left this provider; everything after it is news to the provider. */
  lastSeq: number
  /** The context window the provider reported, in tokens, when known. */
  contextMax: number | null
  model?: string | null
  contextUsed?: number | null
}

/** Native sessions per provider login for a thread, so returning to a provider resumes it and sends only what it missed. */
export class ProviderSessions {
  constructor(private readonly db: Db) {}

  save(
    id: string,
    provider: AgentProvider,
    accountId: string | undefined,
    providerSessionId: string,
    lastSeq: number,
    contextMax: number | null,
    model?: string,
    contextUsed?: number | null,
  ): void {
    this.db
      .prepare(
        `INSERT INTO session_provider_sessions (session_id, provider, account_id, provider_session_id, last_seq, context_max, updated_at, model, context_used)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, provider, account_id) DO UPDATE SET provider_session_id = excluded.provider_session_id,
           last_seq = excluded.last_seq, context_max = excluded.context_max, updated_at = excluded.updated_at,
           model = excluded.model, context_used = excluded.context_used`,
      )
      .run(
        id,
        provider,
        accountId ?? 'default',
        providerSessionId,
        lastSeq,
        contextMax,
        Date.now(),
        model ?? null,
        contextUsed ?? null,
      )
  }

  get(id: string, provider: AgentProvider, accountId: string | undefined): SavedProviderSession | null {
    const row = this.db
      .prepare(
        'SELECT provider_session_id, last_seq, context_max, model, context_used FROM session_provider_sessions WHERE session_id = ? AND provider = ? AND account_id = ?',
      )
      .get(id, provider, accountId ?? 'default') as
      | {
          provider_session_id: string
          last_seq: number
          context_max: number | null
          model: string | null
          context_used: number | null
        }
      | undefined
    return row
      ? {
          providerSessionId: row.provider_session_id,
          lastSeq: row.last_seq,
          contextMax: row.context_max,
          model: row.model,
          contextUsed: row.context_used,
        }
      : null
  }

  /** Forgets one login's saved session, when its provider could not resume it. */
  forget(id: string, provider: AgentProvider, accountId: string | undefined): void {
    this.db
      .prepare('DELETE FROM session_provider_sessions WHERE session_id = ? AND provider = ? AND account_id = ?')
      .run(id, provider, accountId ?? 'default')
  }

  /** Forgets every saved session of the thread: rewinding removes events those sessions still remember. */
  clear(id: string): void {
    this.db.prepare('DELETE FROM session_provider_sessions WHERE session_id = ?').run(id)
  }
}

/**
 * Providers whose runner turns a session it cannot resume into a fallback to a full handoff, so a stale saved session cannot
 * strand the thread. Claude Code is left out until that path is verified against the SDK: it always gets a full handoff.
 */
export const DELTA_RESUME_PROVIDERS: ReadonlySet<AgentProvider> = new Set([
  'codex',
  'opencode',
  'cursor',
  'antigravity',
])

export interface HandoffPlan {
  /** The native session to resume (a returning provider), or null to start a fresh one with a full handoff. */
  resume: string | null
  built: BuiltHandoff
}

/**
 * How a conversation reaches a provider session that has not seen all of it. A provider the thread used before resumes its
 * own session and gets only what happened since (a delta); otherwise, or when the delta alone does not fit, it gets a full
 * handoff. `built.overBudget` means even that does not fit the target: the caller must not send it.
 */
export function planHandoff(
  events: AgentEvent[],
  input: {
    cause: HandoffCause
    from?: AgentProvider
    to: AgentProvider
    saved: SavedProviderSession | null
    checkpoint?: { seq: number; summary: string } | null
    goal?: string | null
    queued?: { text: string }[]
    /** Destination model's capacity. Takes precedence over the old native session's window. */
    contextTokens?: number | null
    /** Selected target model; a saved session from another model must be checked against this target. */
    model?: string
  },
): HandoffPlan {
  const sameModel = input.model === undefined || input.saved?.model === input.model
  const targetWindow = input.contextTokens ?? (sameModel ? input.saved?.contextMax : null)
  const saved =
    DELTA_RESUME_PROVIDERS.has(input.to) && (sameModel || (targetWindow && input.saved?.contextUsed != null))
      ? input.saved
      : null
  const budgetBytes = handoffBudgetBytes(targetWindow)
  const shared = {
    cause: input.cause,
    ...(input.from ? { from: input.from } : {}),
    to: input.to,
    goal: input.goal,
    queued: input.queued,
    budgetBytes,
    ...(targetWindow ? { contextWindow: targetWindow } : {}),
  }
  if (saved && saved.lastSeq <= events.length) {
    const delta = buildHandoff(events, { ...shared, mode: 'delta', fromSeq: saved.lastSeq + 1 })
    const shrinking = targetWindow != null && saved.contextMax != null && targetWindow < saved.contextMax
    const occupied = saved.contextUsed ?? (sameModel && !shrinking ? 0 : Infinity)
    const fitsNative =
      occupied + Buffer.byteLength(delta.prompt, 'utf8') <= (targetWindow ?? DEFAULT_CONTEXT_TOKENS) * 0.75
    if (!delta.overBudget && fitsNative) return { resume: saved.providerSessionId, built: delta }
  }
  return { resume: null, built: buildHandoff(events, { ...shared, mode: 'full', checkpoint: input.checkpoint }) }
}

/** What to write on a `settings` event when the switch is made: the cause now, the coverage once the prompt is built. */
export function pendingHandoff(plan: HandoffPlan, cause: HandoffCause, from?: AgentProvider): HandoffInfo {
  return {
    cause,
    mode: plan.resume ? 'delta' : 'full',
    ...(from ? { from } : {}),
    fromSeq: plan.built.info.fromSeq ?? 1,
    ...(plan.built.info.contextWindow ? { contextWindow: plan.built.info.contextWindow } : {}),
  }
}
