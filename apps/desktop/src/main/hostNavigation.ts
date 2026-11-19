import type { HostDestination } from '@ramu/shared/hostOverview'

/** Holds the latest shell selection until its listener is installed, including after a reload. */
export class HostNavigation {
  private pending: { host: string; destination: HostDestination } | null = null
  private listening = false
  constructor(private readonly send: (host: string, destination: HostDestination) => void) {}
  request(host: string, destination: HostDestination) {
    this.pending = { host, destination }
    this.flush()
  }
  ready() {
    this.listening = true
    this.flush()
  }
  suspend() {
    this.listening = false
  }
  forget(host: string) {
    if (this.pending?.host === host) this.pending = null
  }
  private flush() {
    if (!this.listening || !this.pending) return
    const { host, destination } = this.pending
    this.pending = null
    this.send(host, destination)
  }
}
