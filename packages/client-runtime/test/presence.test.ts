import { afterEach, expect, it, vi } from 'vitest'
import { createSocket } from 'node:dgram'
import { PresenceListener, presenceKey, presenceMessage } from '../src/presence'

const listeners: PresenceListener[] = []
afterEach(() => { for (const listener of listeners) listener.close(); listeners.length = 0 })
function setup() { const listener = new PresenceListener(); listeners.push(listener); const wake = vi.fn(); const off = listener.watch('device-token', wake); return { listener, wake, off } }

it('accepts a signed announcement only once and never exposes the pairing token', () => {
  const { listener, wake } = setup()
  const packet = presenceMessage(presenceKey('device-token'))
  expect(packet.toString()).not.toContain('device-token')
  listener.accept(packet); listener.accept(packet)
  expect(wake).toHaveBeenCalledTimes(1)
})

it('ignores forged, expired, oversized, malformed and unknown-device announcements', () => {
  const { listener, wake } = setup()
  const key = presenceKey('device-token'), valid = JSON.parse(presenceMessage(key).toString())
  listener.accept(Buffer.from(JSON.stringify({ ...valid, mac: '0'.repeat(64) })))
  listener.accept(presenceMessage(key, Date.now() - 120001))
  listener.accept(presenceMessage(presenceKey('other-token')))
  listener.accept(Buffer.alloc(513)); listener.accept(Buffer.from('not json'))
  expect(wake).not.toHaveBeenCalled()
})

it('a paused or forgotten connection stops receiving wake-ups', () => {
  const { listener, wake, off } = setup()
  off()
  listener.accept(presenceMessage(presenceKey('device-token')))
  expect(wake).not.toHaveBeenCalled()
})

it('receives an authenticated host packet over a real UDP socket', async () => {
  const { listener, wake } = setup()
  await listener.start()
  expect(listener.port).toBeGreaterThan(0)
  const socket = createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) => socket.send(presenceMessage(presenceKey('device-token')), listener.port, '127.0.0.1', (error) => error ? reject(error) : resolve()))
    await expect.poll(() => wake.mock.calls.length).toBe(1)
  } finally { socket.close() }
})
