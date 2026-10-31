import { clipText } from '@ramu/shared/text'
import { goalContinues } from '@ramu/shared/chat/goalHold'
import type { Db } from '../db'
import type { AgentService } from '../agent'

export type ThreadOutcome = 'running' | 'needs-input' | 'completed' | 'failed' | 'interrupted' | 'cancelled'

/** The latest thing that went wrong in a thread: a failed result, or (only when the thread failed) an error event. */
function lastError(db: Db, sessionId: string, failed: boolean): string | null {
  const row = db
    .prepare(
      `SELECT event FROM agent_events WHERE session_id=? AND json_extract(event,'$.kind') IN (${failed ? "'result','error'" : "'result'"}) ORDER BY seq DESC LIMIT 1`,
    )
    .get(sessionId) as { event: string } | undefined
  if (!row) return null
  const event = JSON.parse(row.event) as { kind: string; isError?: boolean; text?: string; message?: string }
  const text = event.kind === 'error' ? event.message : event.isError ? event.text : null
  return text?.trim() ? clipText(text.replace(/\s+/g, ' ').trim(), 300) : null
}

/**
 * What a thread's run has come to, from its final state and its last error, not from idleness alone. A thread that is
 * idle between goal continuations, or because it waits for a usage limit to reset, is still running.
 */
export function threadOutcome(
  db: Db,
  agents: AgentService,
  sessionId: string,
): { status: ThreadOutcome; error: string | null } {
  const session = agents.get(sessionId)
  if (agents.isRecoveryPending(session.id)) return { status: 'running', error: null }
  if (session.state === 'needs-input') return { status: 'needs-input', error: null }
  // A run held at a usage limit is not done: it continues after the reset, or, with auto-resume off, stops there.
  // The limit's own error result must not read as a failure, so this comes before any error check.
  if (agents.providerWait?.(session.id)) {
    return agents.autoResumeOf(session.id)
      ? { status: 'running', error: null }
      : { status: 'interrupted', error: 'Usage limit reached. Auto-resume is off; open the thread to resume.' }
  }
  if (session.state === 'stopped') return { status: 'cancelled', error: null }
  if (session.state === 'restored') return { status: 'interrupted', error: null }
  if (session.state === 'failed')
    return { status: 'failed', error: lastError(db, session.id, true) ?? 'The agent failed.' }
  if (session.state !== 'idle') return { status: 'running', error: null }
  const goal = agents.getGoal(session.id)
  if (goalContinues(goal)) return { status: 'running', error: null }
  if (agents.queued(session.id).length) return { status: 'running', error: null }
  // The agent stopped on purpose and needs a person: a blocked goal, or one that used up its continuation turns.
  if (goal && ['blocked', 'turn-limit'].includes(goal.status))
    return { status: 'needs-input', error: goal.reason ? clipText(goal.reason, 300) : null }
  const error = lastError(db, session.id, false)
  return error ? { status: 'failed', error } : { status: 'completed', error: null }
}
