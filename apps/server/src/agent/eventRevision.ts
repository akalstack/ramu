// Every write to an agent event row bumps a per-session change counter (`rev`), so a client can ask for just the
// rows that changed since it last read, including rows edited in place such as streamed text and tool results.

/** Replaces a row's event and gives it the session's next revision. Bind: event, sessionId, sessionId, seq. */
export const UPDATE_EVENT_SQL =
  'UPDATE agent_events SET event = ?, rev = (SELECT COALESCE(MAX(rev), 0) + 1 FROM agent_events WHERE session_id = ?) WHERE session_id = ? AND seq = ?'

/** Appends an event with the next sequence and revision. Bind: sessionId, sessionId, sessionId, event. */
export const INSERT_EVENT_SQL = `INSERT INTO agent_events (session_id, seq, rev, event)
  VALUES (?, (SELECT COALESCE(MAX(seq), 0) + 1 FROM agent_events WHERE session_id = ?),
          (SELECT COALESCE(MAX(rev), 0) + 1 FROM agent_events WHERE session_id = ?), ?)`
