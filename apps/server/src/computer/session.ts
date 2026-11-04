import type { BrowserFieldFocus } from '@ramu/shared/browserBridge'
import { createHash, randomUUID } from 'node:crypto'
import {
  COMPUTER_FRAME_STALE_MS,
  ComputerNotRun,
  MAX_COMPUTER_TEXT,
  type ComputerAction,
  type ComputerBackend,
  type ComputerCapture,
  type ComputerFrameMeta,
  type ComputerGrant,
} from '@ramu/shared/computerBridge'
import {
  admitAgentAction,
  admitHumanInput,
  controllerDisconnected,
  giveToAgent,
  handOff,
  humanInputReady,
  initialLease,
  observed,
  revokeAgent,
  settleAgentAction,
  takeControl,
  type LeaseRefusal,
  type LeaseState,
} from '@ramu/shared/control/lease'
import { claimKey, claimRefusal, type TargetClaims } from './claims'

/** Viewers refresh at most about four times a second however many are watching. */
const VIEW_MIN_INTERVAL_MS = 250
/** The background capture stops this long after the last viewer request. */
const VIEW_IDLE_STOP_MS = 5000
const VIEW_FIRST_FRAME_MS = 90_000

const REFUSALS: Record<LeaseRefusal, string> = {
  'human-controlled': 'The person is controlling this computer. Wait for them to give control back.',
  'agent-controlled': 'Another run controls this computer session.',
  'not-controller': 'This device does not control the computer.',
  'stale-generation': 'Control changed since this action was prepared. Observe the screen again.',
  'needs-observation': 'Observe the screen before acting.',
  paused: 'Computer input is paused until the person explicitly resumes control.',
  'handoff-required': 'Another device controls this computer. Request an explicit handoff.',
}

/** How long a device's request for control stays open for the current controller to answer. */
export const HANDOFF_REQUEST_MS = 120_000
const LOCAL_INPUT_MESSAGE =
  'Someone is using this computer’s mouse or keyboard, so computer use paused. Give control back when they are done.'

export class ComputerRefusal extends Error {}
const refuse = (message: string): never => {
  throw new ComputerRefusal(message)
}

export interface ComputerObservation extends ComputerFrameMeta {
  id: string
  capture: ComputerCapture
}

/**
 * One computer session: a grant for one target, a control lease and a single mutation queue. Agent actions need the
 * latest observation id and consume it; an action with an uncertain outcome is never replayed. Pure policy: capture
 * and input go through the backend.
 */
export class ComputerSession {
  private lease: LeaseState = initialLease()
  private latest: { id: string; width: number; height: number; capturedAt: number } | null = null
  private sequence = 0
  private queue: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    private grant: ComputerGrant,
    private readonly backend: ComputerBackend,
    private readonly now: () => number = Date.now,
    /** The computer whose screen this is: `local` is the execution host itself. */
    readonly runtime: { id: string; name: string } = { id: 'local', name: 'This computer' },
    /** Shared by every thread's session, so two threads never act on the same target at once. */
    private readonly claims?: TargetClaims,
  ) {}

  /** Acting needs the target to itself; another thread acting on it just now refuses this one. */
  private claimTarget() {
    if (this.claims && !this.claims.claim(claimKey(this.runtime.id, this.grant.target), this))
      refuse(claimRefusal(this.grant.target))
  }

  get target() {
    return this.grant.target
  }

  private interrupted: { generation: number } | null = null
  private handoff: { deviceId: string; generation: number; at: number } | null = null

  /** Control was taken by local mouse or keyboard use at the current generation. Cleared by the next change of owner. */
  get interruption(): 'local-input' | null {
    return this.interrupted && this.interrupted.generation === this.lease.generation ? 'local-input' : null
  }

  /** The device asking the current human controller for control, while that request is still valid. */
  get handoffRequest(): string | null {
    const request = this.handoff
    if (!request || request.generation !== this.lease.generation) return null
    if (this.now() - request.at > HANDOFF_REQUEST_MS) return null
    if (this.lease.controller.kind !== 'human' || this.lease.controller.deviceId === request.deviceId) return null
    return request.deviceId
  }

  /** Whether this session can notice the person using the real mouse and keyboard without being told. */
  get detectsLocalInput(): boolean {
    return this.grant.target.kind === 'app' || !!this.backend.localInputActive
  }

  /** The person's own mouse or keyboard use wins: the agent or remote controller is paused and local control begins. */
  private async yieldToLocalInput(deviceId: string | null): Promise<void> {
    if (this.grant.target.kind !== 'display' || deviceId === 'local' || !this.backend.localInputActive) return
    let active: boolean
    try {
      active = await this.backend.localInputActive(this.grant.target)
    } catch {
      return
    }
    if (!active || this.closed) return
    const result = takeControl(this.lease, 'local')
    if (!result.ok) return
    this.lease = result.state
    this.latest = null
    this.backend.releaseInput(this.grant.target)
    this.interrupted = { generation: this.lease.generation }
    refuse(LOCAL_INPUT_MESSAGE)
  }

  /** Another device asks the human controller for control. It becomes the controller only if they approve. */
  requestHandoff(deviceId: string) {
    this.alive()
    const owner = this.lease.controller
    if (owner.kind !== 'human') refuse('Nobody else is controlling this computer. Take control directly.')
    else if (owner.deviceId === deviceId) refuse('This device already controls the computer.')
    this.handoff = { deviceId, generation: this.lease.generation, at: this.now() }
  }

  /** The controller approves the pending request: the requester controls from a new generation. */
  approveHandoff(deviceId: string) {
    this.alive()
    const requester = this.handoffRequest
    if (!requester) refuse('No device is asking for control.')
    const result = handOff(this.lease, deviceId, requester!)
    if (!result.ok) refuse(REFUSALS[result.refused])
    else {
      this.lease = result.state
      this.latest = null
      this.handoff = null
      this.backend.releaseInput(this.grant.target)
    }
  }

  declineHandoff(deviceId: string) {
    const owner = this.lease.controller
    if (owner.kind === 'human' && owner.deviceId === deviceId) this.handoff = null
  }
  get state(): Readonly<LeaseState> {
    return this.lease
  }

  /** The agent run takes the session. Refused while a human holds it; nothing is inherited implicitly. */
  open(runId: string) {
    this.alive()
    if (this.lease.controller.kind === 'agent' && this.lease.controller.runId === runId) return
    const result = giveToAgent(this.lease, '', runId)
    if (!result.ok) refuse(REFUSALS[result.refused])
    else {
      this.lease = result.state
      this.latest = null
    }
  }

  async observe(runId: string): Promise<ComputerObservation> {
    this.alive()
    if (!this.grant.observe) refuse('Screen observation is not granted for this computer.')
    const owner = this.lease.controller
    if (owner.kind === 'agent' && owner.runId !== runId) refuse(REFUSALS['agent-controlled'])
    if (owner.kind === 'none') refuse('Open the computer session first.')
    return this.frame(runId)
  }

  /**
   * A viewer's frame. Requires the observe grant; never touches the agent's observation or the lease. While anyone is
   * watching the host keeps capturing in the background, so a request returns as soon as a newer frame exists instead
   * of waiting for a capture of its own. `since` is the hash of the frame the viewer already shows.
   */
  async view(since?: string, waitMs = 0): Promise<ComputerObservation & { hash: string }> {
    this.alive()
    if (!this.grant.observe) refuse('Screen observation is not granted for this computer.')
    this.watchedAt = this.now()
    this.startPump()
    const deadline = this.now() + waitMs
    for (;;) {
      this.alive()
      const current = this.shared
      if (current && current.generation === this.lease.generation && (since === undefined || current.hash !== since))
        return { ...current.frame, hash: current.hash }
      if (this.pumpError) {
        const error = this.pumpError
        this.pumpError = null
        throw error
      }
      const remaining = deadline - this.now()
      if (current && waitMs > 0 && remaining <= 0 && current.generation === this.lease.generation)
        return { ...current.frame, hash: current.hash }
      if (waitMs <= 0 && !current) await this.waitForFrame(VIEW_FIRST_FRAME_MS)
      else await this.waitForFrame(Math.max(20, Math.min(remaining, 100)))
      if (!this.shared && this.now() > deadline + VIEW_FIRST_FRAME_MS) refuse('The screen could not be captured.')
    }
  }

  private shared: { frame: ComputerObservation; generation: number; hash: string } | null = null
  private watchedAt = 0
  private pumping = false
  private pumpError: Error | null = null
  private frameWaiters = new Set<() => void>()

  private waitForFrame(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        this.frameWaiters.delete(done)
        resolve()
      }
      const timer = setTimeout(done, ms)
      this.frameWaiters.add(done)
    })
  }

  private startPump() {
    if (this.pumping) return
    this.pumping = true
    void (async () => {
      try {
        // Stops a few seconds after the last viewer request, and when the grant is revoked.
        while (!this.closed && this.now() - this.watchedAt < VIEW_IDLE_STOP_MS) {
          const started = this.now()
          try {
            const generation = this.lease.generation
            const frame = await this.frame()
            const hash = createHash('sha256').update(frame.capture.data).digest('hex').slice(0, 32)
            if (generation === this.lease.generation) this.shared = { frame, generation, hash }
            this.pumpError = null
          } catch (error) {
            this.pumpError = error instanceof Error ? error : new Error(String(error))
            for (const wake of [...this.frameWaiters]) wake()
            break
          }
          for (const wake of [...this.frameWaiters]) wake()
          const spent = this.now() - started
          const every = this.backend.frameInterval?.(this.grant.target) ?? VIEW_MIN_INTERVAL_MS
          if (spent < every) await new Promise((r) => setTimeout(r, every - spent))
        }
      } finally {
        this.pumping = false
      }
    })()
  }

  private async frame(runId?: string): Promise<ComputerObservation> {
    const generation = this.lease.generation
    // Without a run the picture is for people watching; an agent's observation keeps everything it reads.
    const capture = await this.backend.capture(this.grant.target, runId ? undefined : { forViewer: true })
    if (generation !== this.lease.generation || this.closed) refuse('Control changed during capture. Observe again.')
    return this.observation(capture, generation, runId)
  }

  private observation(capture: ComputerCapture, generation: number, runId?: string): ComputerObservation {
    const meta = {
      id: randomUUID(),
      targetId: this.grant.target.id,
      sequence: ++this.sequence,
      capturedAt: this.now(),
      width: capture.width,
      height: capture.height,
      scale: capture.scale,
      generation,
    }
    if (runId) {
      this.latest = { id: meta.id, width: capture.width, height: capture.height, capturedAt: meta.capturedAt }
      this.lease = observed(this.lease, runId)
    }
    return { ...meta, capture }
  }

  /** A picture that came back with an action goes straight to anyone watching, ahead of the next capture. */
  private publish(capture: ComputerCapture | void, generation: number) {
    if (!capture || this.closed || generation !== this.lease.generation) return
    const frame = this.observation(capture, generation)
    const hash = createHash('sha256').update(capture.data).digest('hex').slice(0, 32)
    this.shared = { frame, generation, hash }
    for (const wake of [...this.frameWaiters]) wake()
  }

  /** Queued per session; the generation is fixed when the call is made, so a takeover cancels everything waiting. */
  async act(runId: string, observationId: string, action: ComputerAction): Promise<void> {
    this.alive()
    if (!this.grant.input) refuse('Input is not granted for this computer.')
    const generation = this.lease.generation
    const run = async () => {
      this.alive()
      const latest = this.latest
      if (!latest || latest.id !== observationId) refuse('That observation is out of date. Observe the screen again.')
      validateAction(action, latest!.width, latest!.height)
      await this.yieldToLocalInput(null)
      const admitted = admitAgentAction(this.lease, runId, generation)
      if (!admitted.ok) return refuse(REFUSALS[admitted.refused])
      this.claimTarget()
      this.lease = admitted.state
      this.latest = null // every action consumes the observation, even if it fails
      try {
        this.publish(await this.backend.perform(this.grant.target, action), generation)
      } catch (error) {
        if (error instanceof ComputerNotRun) throw new ComputerRefusal(error.message)
        throw new ComputerRefusal(
          `The action may or may not have run (${error instanceof Error ? error.message : 'failed'}). Observe the screen before deciding what to do.`,
        )
      } finally {
        this.lease = settleAgentAction(this.lease, generation)
      }
    }
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  /** A human takes control. Queued agent work is dropped and held input is released. */
  takeControl(deviceId: string) {
    this.alive()
    const result = takeControl(this.lease, deviceId)
    if (!result.ok) refuse(REFUSALS[result.refused])
    else {
      this.lease = result.state
      this.latest = null
      this.backend.releaseInput(this.grant.target)
    }
  }

  /** The person gives control back. The agent still has to observe before it can act. */
  giveToAgent(deviceId: string, runId: string) {
    this.alive()
    const result = giveToAgent(this.lease, deviceId, runId)
    if (!result.ok) refuse(REFUSALS[result.refused])
    else {
      this.lease = result.state
      this.latest = null
      this.backend.releaseInput(this.grant.target)
    }
  }

  /** Human input waits for the agent's in-flight work, then needs a fresh frame; it never replays after reconnect. */
  async humanInput(deviceId: string, generation: number, frame: { capturedAt: number }, action: ComputerAction) {
    this.alive()
    if (!this.grant.input) refuse('Input is not granted for this computer.')
    const admitted = admitHumanInput(this.lease, deviceId, generation)
    if (!admitted.ok) return refuse(REFUSALS[admitted.refused])
    if (!humanInputReady(this.lease)) refuse('The agent is finishing its last action. Try again in a moment.')
    if (this.now() - frame.capturedAt > COMPUTER_FRAME_STALE_MS) refuse('The screen is stale. Wait for a fresh frame.')
    validateAction(action, Infinity, Infinity)
    // The person at the computer outranks a remote controller.
    await this.yieldToLocalInput(deviceId)
    this.claims?.take(claimKey(this.runtime.id, this.grant.target), this)
    try {
      this.publish(await this.backend.perform(this.grant.target, action), this.lease.generation)
    } catch (error) {
      if (error instanceof ComputerNotRun) throw new ComputerRefusal(error.message)
      throw new ComputerRefusal(
        `The input may or may not have run (${error instanceof Error ? error.message : 'failed'}).`,
      )
    }
  }

  /** Only the device in control learns whether a text field has focus, and only its kind. */
  async focusedField(deviceId: string): Promise<BrowserFieldFocus> {
    this.alive()
    const controller = this.lease.controller
    if (controller.kind !== 'human' || controller.deviceId !== deviceId || this.lease.paused) return { editable: false }
    return (await this.backend.focusedField?.(this.grant.target)) ?? { editable: false }
  }

  /** The human controller's viewer went away: input pauses and control is not handed back. */
  controllerDisconnected(deviceId: string) {
    const before = this.lease
    this.lease = controllerDisconnected(this.lease, deviceId)
    if (this.lease !== before) this.backend.releaseInput(this.grant.target)
  }

  /** A run ended or Stop was pressed: its lease and queued work are revoked. */
  stop(runId: string) {
    const before = this.lease
    this.lease = revokeAgent(this.lease, runId)
    this.latest = null
    if (this.lease !== before) {
      this.backend.releaseInput(this.grant.target)
      this.claims?.release(this)
    }
  }

  /** The grant was revoked or the session closed. Nothing continues. */
  revoke() {
    this.closed = true
    this.latest = null
    this.claims?.release(this)
    this.backend.releaseInput(this.grant.target)
  }

  private alive() {
    if (this.closed) refuse('This computer session was closed.')
  }
}

function validateAction(action: ComputerAction, width: number, height: number) {
  const inside = (x: number, y: number) =>
    Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0 && x < width && y < height
  if (action.kind === 'type' && (!action.text || action.text.length > MAX_COMPUTER_TEXT))
    refuse(`Text must be 1–${MAX_COMPUTER_TEXT} characters.`)
  if (action.kind === 'key' && !action.key) refuse('A key is required.')
  if ((action.kind === 'click' || action.kind === 'scroll') && !inside(action.x, action.y))
    refuse('That point is outside the observed screen.')
  if (action.kind === 'drag' && !(inside(action.fromX, action.fromY) && inside(action.toX, action.toY)))
    refuse('That drag leaves the observed screen.')
}
