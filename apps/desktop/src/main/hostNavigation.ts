import type { HostDestination } from '@ramu/shared/hostOverview'

/** Keep the last requested destination until that host's workspace has installed its listener. */
export class HostNavigation {
  private readonly pending = new Map<string, HostDestination>()
  private readonly listening = new Set<string>()
  constructor(private readonly send: (id: string, destination: HostDestination) => void) {}
  request(id: string, destination: HostDestination) {
    this.pending.set(id, destination)
    this.flush(id)
  }
  ready(id: string) {
    this.listening.add(id)
    this.flush(id)
  }
  suspend(id: string) {
    this.listening.delete(id)
  }
  forget(id: string) {
    this.suspend(id)
    this.pending.delete(id)
  }
  private flush(id: string) {
    const destination = this.pending.get(id)
    if (!destination || !this.listening.has(id)) return
    this.pending.delete(id)
    this.send(id, destination)
  }
}
