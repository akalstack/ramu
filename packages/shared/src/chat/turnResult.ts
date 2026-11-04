import type { AgentEvent } from '../types'

type Result = Extract<AgentEvent, { kind: 'result' }>

// Most providers put a status word in a result's text, but Claude puts its whole final answer there, so only an exact
// status counts; an answer that mentions "abort" or "interrupt" is not a stopped turn.
const STOPPED_STATUS = /^(?:interrupted|aborted|cancell?ed|\[request interrupted by user[^\]]*\])$/i

/** Whether the provider reported the turn as stopped before it finished. */
export const reportedStop = (result: Result): boolean => STOPPED_STATUS.test(result.text.trim())

/** Whether a turn's result says it was cut short: a failure, or a stop the provider reported. */
export const resultStopped = (result: Result): boolean => result.isError || reportedStop(result)
