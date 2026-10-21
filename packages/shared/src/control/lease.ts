// One controller at a time over a shared target (a browser tab or a computer session): the agent, one human device,
// or nobody. Every change of owner advances a generation, so queued agent work, element references and observations
// from an earlier owner can be told apart from current ones. Pure state; the runtime does the actual input and capture.

export type Controller = { kind: 'none' } | { kind: 'agent'; runId: string } | { kind: 'human'; deviceId: string }

export interface LeaseState {
  controller: Controller
  /** Advances on every ownership change. */
  generation: number
  /** The target's input is paused because the human controller disconnected; nobody drives it until a handoff. */
  paused: boolean
  /** Agent work admitted for the current generation and not yet settled. */
  inFlight: number
  /** Work admitted under an earlier owner that has not settled yet; human input waits for it. */
  draining: number
  /** Whether a fresh observation was made since the agent last gained control. */
  observed: boolean
}

export const initialLease = (): LeaseState => ({
  controller: { kind: 'none' },
  generation: 0,
  paused: false,
  inFlight: 0,
  draining: 0,
  observed: false,
})

export type LeaseRefusal =
  | 'human-controlled'
  | 'agent-controlled'
  | 'not-controller'
  | 'stale-generation'
  | 'needs-observation'
  | 'paused'
  | 'handoff-required'

export type LeaseResult = { ok: true; state: LeaseState } | { ok: false; refused: LeaseRefusal }

const refuse = (refused: LeaseRefusal): LeaseResult => ({ ok: false, refused })
const advance = (state: LeaseState, controller: Controller, patch: Partial<LeaseState> = {}): LeaseState => ({
  ...state,
  controller,
  generation: state.generation + 1,
  paused: false,
  inFlight: 0,
  draining: state.draining + state.inFlight,
  observed: false,
  ...patch,
})

/** The person releases the target to the agent for a run. Requires an explicit release; a fresh observation follows. */
export function giveToAgent(state: LeaseState, deviceId: string, runId: string): LeaseResult {
  if (state.controller.kind === 'human' && state.controller.deviceId !== deviceId) return refuse('handoff-required')
  return { ok: true, state: advance(state, { kind: 'agent', runId }) }
}

/**
 * A human takes control. The agent's queued work is dropped (in-flight count resets for the new generation) and its
 * actions are refused until release. Another human device must be handed over explicitly unless `local` takes over.
 */
export function takeControl(state: LeaseState, deviceId: string, options: { local?: boolean } = {}): LeaseResult {
  const owner = state.controller
  if (owner.kind === 'human' && owner.deviceId !== deviceId && !options.local) return refuse('handoff-required')
  if (owner.kind === 'human' && owner.deviceId === deviceId && !state.paused) return { ok: true, state }
  return { ok: true, state: advance(state, { kind: 'human', deviceId }) }
}

/** The human controller disconnected: input pauses. Control is never handed back to the agent automatically. */
export function controllerDisconnected(state: LeaseState, deviceId: string): LeaseState {
  if (state.controller.kind !== 'human' || state.controller.deviceId !== deviceId) return state
  return {
    ...state,
    paused: true,
    generation: state.generation + 1,
    inFlight: 0,
    draining: state.draining + state.inFlight,
  }
}

/** A run ends or is stopped: its lease and pending operations are revoked. */
export function revokeAgent(state: LeaseState, runId: string): LeaseState {
  if (state.controller.kind !== 'agent' || state.controller.runId !== runId) return state
  return advance(state, { kind: 'none' })
}

/** Agent observations are always allowed within a grant; they also satisfy the post-release observation rule. */
export function observed(state: LeaseState, runId: string): LeaseState {
  return state.controller.kind === 'agent' && state.controller.runId === runId ? { ...state, observed: true } : state
}

/**
 * Admits one agent mutation. It must come from the current run at the current generation, after an observation, and
 * never while a human controls the target or input is paused.
 */
export function admitAgentAction(state: LeaseState, runId: string, generation: number): LeaseResult {
  if (state.paused) return refuse('paused')
  if (state.controller.kind === 'human') return refuse('human-controlled')
  if (state.controller.kind !== 'agent' || state.controller.runId !== runId) return refuse('agent-controlled')
  if (generation !== state.generation) return refuse('stale-generation')
  if (!state.observed) return refuse('needs-observation')
  return { ok: true, state: { ...state, inFlight: state.inFlight + 1 } }
}

/** An admitted action settled. One from an earlier owner drains that backlog instead of touching the current count. */
export function settleAgentAction(state: LeaseState, generation: number): LeaseState {
  if (generation === state.generation) return state.inFlight > 0 ? { ...state, inFlight: state.inFlight - 1 } : state
  return state.draining > 0 ? { ...state, draining: state.draining - 1 } : state
}

/** Human input is accepted only from the controlling device, at the current generation, while not paused. */
export function admitHumanInput(state: LeaseState, deviceId: string, generation: number): LeaseResult {
  if (state.paused) return refuse('paused')
  if (state.controller.kind !== 'human' || state.controller.deviceId !== deviceId) return refuse('not-controller')
  if (generation !== state.generation) return refuse('stale-generation')
  return { ok: true, state }
}

/** Human input can start once the agent's in-flight work for the old generation has settled. */
export const humanInputReady = (state: LeaseState): boolean =>
  state.controller.kind === 'human' && !state.paused && state.inFlight === 0 && state.draining === 0
