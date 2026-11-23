import type { PushEvents } from '@ramu/shared/api'

type Connection = PushEvents['background:connection']

/**
 * What windows hear about this computer's service while the app restarts it on purpose. From the moment the restart
 * starts until the new run answers, the service reads as restarting, never offline: a disconnect is relabelled, and the
 * old run reconnecting while it drains is held back. The new run's first answer ends it at once.
 */
export class ServiceRestart {
  private active = false
  private connected = true
  private told = false

  constructor(private readonly emit: (payload: Connection) => void) {}

  begin() {
    this.active = true
    this.tellRestarting()
  }

  /** A connection event from the service's own stream. */
  observe(payload: Connection) {
    this.connected = payload.connected
    if (!this.active) return this.emit(payload)
    if (!payload.connected) return this.tellRestarting()
    if (!payload.restarted) return
    this.finish()
    this.emit({ connected: true })
    this.emit(payload)
  }

  /** The restart finished or failed; a service that never came back reads as offline from here on. */
  end() {
    if (!this.active) return
    this.finish()
    this.emit(this.connected ? { connected: true } : { connected: false, waiting: 'computer' })
  }

  private finish() {
    this.active = false
    this.told = false
  }

  private tellRestarting() {
    if (this.told) return
    this.told = true
    this.emit({ connected: false, restarting: true })
  }
}
