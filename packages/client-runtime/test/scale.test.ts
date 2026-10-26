import { afterEach, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { closeHostSockets, subscribeRuntime } from '../src'
import { socketHost } from './support/socketHost'

afterEach(() => closeHostSockets())

it('holds 100 simultaneous host sockets and delivers 10000 events', async () => {
  const count = 100,
    perStream = 100
  const running = await socketHost({ token: '*' })
  const stops: (() => void)[] = []
  let connected = 0,
    received = 0
  const memoryBefore = process.memoryUsage(),
    start = performance.now()
  try {
    for (let i = 0; i < count; i++)
      stops.push(
        subscribeRuntime({ ...running.endpoint, token: `token-${i}` }, (channel, payload) => {
          if (channel === 'background:connection' && payload.connected) connected++
          else if (channel === 'agent:event') received++
        }),
      )
    await expect.poll(() => connected, { timeout: 10_000 }).toBe(count)
    const connectMs = performance.now() - start,
      burst = performance.now()
    for (let j = 0; j < perStream; j++)
      running.push('agent:event', { sessionId: 'session', event: { kind: 'state', state: 'running' } })
    await expect.poll(() => received, { timeout: 10_000 }).toBe(count * perStream)
    const memoryAfter = process.memoryUsage()
    console.log(
      JSON.stringify({
        scale: 'transport-loopback-websocket',
        sockets: connected,
        events: received,
        connectMs: +connectMs.toFixed(1),
        burstMs: +(performance.now() - burst).toFixed(1),
        heapDeltaMiB: +((memoryAfter.heapUsed - memoryBefore.heapUsed) / 1048576).toFixed(1),
        rssDeltaMiB: +((memoryAfter.rss - memoryBefore.rss) / 1048576).toFixed(1),
      }),
    )
  } finally {
    for (const stop of stops) stop()
    await running.close()
  }
}, 30000)
