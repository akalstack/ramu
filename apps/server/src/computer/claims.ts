import type { ComputerTarget } from '@ramu/shared/computerBridge'

/** How long a thread's last action keeps the target its own before another thread may take it over. */
export const CLAIM_IDLE_MS = 45_000

/**
 * Which thread is acting on each target right now. The main display has one pointer and one keyboard, so two threads
 * acting on it at once would click into each other's work; one app is the same. Different apps run in the background
 * side by side, and watching a screen never needs a claim.
 */
export class TargetClaims {
  private held = new Map<string, { owner: object; at: number }>()
  constructor(private readonly now: () => number = Date.now) {}

  /** Takes or refreshes the target for `owner`; false while another owner acted on it within the idle window. */
  claim(key: string, owner: object): boolean {
    const held = this.held.get(key)
    if (held && held.owner !== owner && this.now() - held.at < CLAIM_IDLE_MS) return false
    this.held.set(key, { owner, at: this.now() })
    return true
  }

  /** A person's own input outranks any thread's agent: it takes the target whoever held it. */
  take(key: string, owner: object) {
    this.held.set(key, { owner, at: this.now() })
  }

  /** Gives back whatever `owner` holds, when its run ends or its grant goes. */
  release(owner: object) {
    for (const [key, held] of this.held) if (held.owner === owner) this.held.delete(key)
  }
}

/** One key per physical thing to act on: the runtime's display, or one app on that runtime. */
export const claimKey = (runtimeId: string, target: ComputerTarget) =>
  target.kind === 'display' ? `${runtimeId}:display` : `${runtimeId}:app:${target.id || target.name}`

/** What a refused thread is told: who has it is not shared across threads, only what to do next. */
export const claimRefusal = (target: ComputerTarget) =>
  target.kind === 'display'
    ? 'Another thread is controlling the main display right now. Wait about a minute for it to finish, observe again and retry; if it stays busy, tell the person, or ask for one app instead of the whole display.'
    : `Another thread is using ${target.name} right now. Wait about a minute for it to finish, observe again and retry; if it stays busy, tell the person.`
