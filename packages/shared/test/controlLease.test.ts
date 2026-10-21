import { describe, expect, it } from 'vitest'
import {
  admitAgentAction,
  admitHumanInput,
  controllerDisconnected,
  giveToAgent,
  humanInputReady,
  initialLease,
  observed,
  revokeAgent,
  settleAgentAction,
  takeControl,
  type LeaseState,
} from '../src/control/lease'

const ok = (result: ReturnType<typeof giveToAgent>): LeaseState => {
  if (!result.ok) throw new Error(`refused: ${result.refused}`)
  return result.state
}

describe('control lease', () => {
  it('an agent acts only after release, at the current generation, and after a fresh observation', () => {
    const released = ok(giveToAgent(initialLease(), 'phone', 'run-1'))
    expect(admitAgentAction(released, 'run-1', released.generation)).toEqual({
      ok: false,
      refused: 'needs-observation',
    })
    const seen = observed(released, 'run-1')
    const admitted = ok(admitAgentAction(seen, 'run-1', seen.generation))
    expect(admitted.inFlight).toBe(1)
    expect(admitAgentAction(seen, 'run-1', seen.generation - 1)).toEqual({ ok: false, refused: 'stale-generation' })
    expect(admitAgentAction(seen, 'run-2', seen.generation)).toEqual({ ok: false, refused: 'agent-controlled' })
    expect(admitAgentAction(initialLease(), 'run-1', 0)).toEqual({ ok: false, refused: 'agent-controlled' })
  })

  it('human takeover advances the generation, refuses the agent and waits for in-flight work', () => {
    let state = observed(ok(giveToAgent(initialLease(), 'phone', 'run-1')), 'run-1')
    state = ok(admitAgentAction(state, 'run-1', state.generation))
    const before = state.generation
    const taken = ok(takeControl(state, 'phone'))
    expect(taken.generation).toBe(before + 1)
    expect(admitAgentAction(taken, 'run-1', before)).toEqual({ ok: false, refused: 'human-controlled' })
    expect(admitAgentAction(taken, 'run-1', taken.generation)).toEqual({ ok: false, refused: 'human-controlled' })
    // Human input waits for the earlier action to settle, and that settling does not touch the new generation.
    expect(humanInputReady(taken)).toBe(false)
    const settled = settleAgentAction(taken, before)
    expect(settled.inFlight).toBe(0)
    expect(humanInputReady(settled)).toBe(true)
  })

  it('release returns control to the agent, which must observe again before mutating', () => {
    const human = ok(takeControl(initialLease(), 'phone'))
    expect(humanInputReady(human)).toBe(true)
    const released = ok(giveToAgent(human, 'phone', 'run-1'))
    expect(released.generation).toBe(human.generation + 1)
    expect(admitAgentAction(released, 'run-1', released.generation)).toEqual({
      ok: false,
      refused: 'needs-observation',
    })
  })

  it('one human controller at a time: a second device needs a handoff, a local takeover wins', () => {
    const phone = ok(takeControl(initialLease(), 'phone'))
    expect(takeControl(phone, 'desktop-b')).toEqual({ ok: false, refused: 'handoff-required' })
    expect(giveToAgent(phone, 'desktop-b', 'run-1')).toEqual({ ok: false, refused: 'handoff-required' })
    const local = ok(takeControl(phone, 'local', { local: true }))
    expect(local.controller).toEqual({ kind: 'human', deviceId: 'local' })
    expect(admitHumanInput(local, 'phone', local.generation)).toEqual({ ok: false, refused: 'not-controller' })
    expect(admitHumanInput(local, 'local', local.generation).ok).toBe(true)
    expect(admitHumanInput(local, 'local', local.generation - 1)).toEqual({ ok: false, refused: 'stale-generation' })
  })

  it('a disconnected human pauses input and never hands control to the agent', () => {
    const phone = ok(takeControl(initialLease(), 'phone'))
    const paused = controllerDisconnected(phone, 'phone')
    expect(paused.paused).toBe(true)
    expect(paused.controller).toEqual({ kind: 'human', deviceId: 'phone' })
    expect(admitHumanInput(paused, 'phone', paused.generation)).toEqual({ ok: false, refused: 'paused' })
    expect(admitAgentAction(paused, 'run-1', paused.generation)).toEqual({ ok: false, refused: 'paused' })
    expect(humanInputReady(paused)).toBe(false)
    expect(controllerDisconnected(phone, 'someone-else')).toBe(phone)
    // The same device reconnecting takes control again explicitly, advancing the generation.
    const back = ok(takeControl(paused, 'phone'))
    expect(back.paused).toBe(false)
    expect(back.generation).toBeGreaterThan(paused.generation)
  })

  it('stopping a run revokes its lease, and another run cannot revoke it', () => {
    const state = observed(ok(giveToAgent(initialLease(), 'phone', 'run-1')), 'run-1')
    expect(revokeAgent(state, 'run-2')).toBe(state)
    const revoked = revokeAgent(state, 'run-1')
    expect(revoked.controller).toEqual({ kind: 'none' })
    expect(admitAgentAction(revoked, 'run-1', revoked.generation)).toEqual({ ok: false, refused: 'agent-controlled' })
  })

  it('human input is not ready while the agent still has work in flight for the old generation', () => {
    let state = observed(ok(giveToAgent(initialLease(), 'phone', 'run-1')), 'run-1')
    state = ok(admitAgentAction(state, 'run-1', state.generation))
    expect(humanInputReady(state)).toBe(false)
    const generation = state.generation
    const taken = ok(takeControl(state, 'phone'))
    expect(humanInputReady(taken)).toBe(false)
    expect(humanInputReady(settleAgentAction(taken, generation))).toBe(true)
  })
})
