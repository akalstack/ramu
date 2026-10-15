// Hosts announce startup/network recovery to recently connected devices. Addresses come from authenticated sockets,
// never from arbitrary callback URLs. A revoked device has no signing key and receives no announcements.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createSocket } from 'node:dgram'
import { isIP } from 'node:net'
import { presenceMessage } from '@ramu/client-runtime'

interface Recipient { deviceId: string; address: string; port: number; seenAt: number }
const MAX_AGE = 30 * 24 * 60 * 60_000
export class HostPresence {
  private readonly timers = new Set<NodeJS.Timeout>()
  private closed = false
  constructor(private readonly path: string, private readonly keyFor: (id: string) => string | null) {}

  private read(): Recipient[] {
    try {
      if (!existsSync(this.path)) return []
      const file = JSON.parse(readFileSync(this.path, 'utf8'))
      return Array.isArray(file) ? file.filter((r) => typeof r.deviceId === 'string' && isIP(r.address) && Number.isInteger(r.port) && r.port >= 1024 && r.port <= 65535 && Date.now() - r.seenAt < MAX_AGE).slice(-100) : []
    } catch { return [] }
  }

  register(deviceId: string, address: string, port: number) {
    address = address.replace(/^::ffff:/, '')
    if (!isIP(address) || !Number.isInteger(port) || port < 1024 || port > 65535 || !this.keyFor(deviceId)) return
    const recipients = this.read().filter((r) => !(r.deviceId === deviceId && r.address === address))
    // Bound a device's history too, since laptop addresses can change.
    const previous = recipients.filter((r) => r.deviceId === deviceId).slice(-3)
    const next = [...recipients.filter((r) => r.deviceId !== deviceId), ...previous, { deviceId, address, port, seenAt: Date.now() }].slice(-100)
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temp = `${this.path}.${process.pid}.tmp`
    writeFileSync(temp, JSON.stringify(next), { mode: 0o600 }); chmodSync(temp, 0o600); renameSync(temp, this.path)
  }

  announce() {
    if (this.closed) return
    // A small startup burst tolerates UDP loss; there is no periodic presence traffic.
    for (const delay of [0, 500, 1500]) {
      const timer = setTimeout(() => {
        this.timers.delete(timer)
        if (this.closed) return
        for (const recipient of this.read()) {
          const key = this.keyFor(recipient.deviceId)
          if (!key) continue
          const socket = createSocket(isIP(recipient.address) === 6 ? 'udp6' : 'udp4')
          socket.on('error', () => { try { socket.close() } catch {} })
          socket.send(presenceMessage(key), recipient.port, recipient.address, () => { try { socket.close() } catch {} })
          socket.unref()
        }
      }, delay)
      timer.unref(); this.timers.add(timer)
    }
  }

  close() { this.closed = true; for (const timer of this.timers) clearTimeout(timer); this.timers.clear() }
}
