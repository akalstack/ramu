import { expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { performance } from 'node:perf_hooks'
import { subscribeRuntime } from '../src'

it('holds 100 simultaneous event streams and delivers 10000 events', async () => {
  const count = 100, perStream = 100
  const peers: any[] = []
  const server = createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write(': connected\n\n'); peers.push(res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const stops: (() => void)[] = []
  let connected = 0, received = 0
  const memoryBefore = process.memoryUsage(), start = performance.now()
  try {
    for (let i = 0; i < count; i++) stops.push(subscribeRuntime({ kind: 'http', url, token: `token-${i}` }, (channel, payload) => { if (channel === 'background:connection' && payload.connected) connected++; else if (channel === 'agent:event') received++ }))
    await expect.poll(() => connected).toBe(count)
    const connectMs = performance.now() - start, burst = performance.now()
    const message = `data: ${JSON.stringify({ channel: 'agent:event', payload: { sessionId: 'session', event: { kind: 'state', state: 'running' } } })}\n\n`
    for (const peer of peers) for (let j = 0; j < perStream; j++) peer.write(message)
    await expect.poll(() => received).toBe(count * perStream)
    const memoryAfter = process.memoryUsage()
    console.log(JSON.stringify({ scale: 'transport-loopback', streams: connected, events: received, connectMs: +connectMs.toFixed(1), burstMs: +(performance.now() - burst).toFixed(1), heapDeltaMiB: +((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1048576).toFixed(1), rssDeltaMiB: +((memoryAfter.rss - memoryBefore.rss) / 1048576).toFixed(1) }))
  } finally { for (const stop of stops) stop(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())) }
}, 15000)
