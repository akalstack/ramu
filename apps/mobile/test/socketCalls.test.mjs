import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HostClient, registerSocketProvider } from '../src/runtime/transport.ts'

const ok = async () => new Response(JSON.stringify({ value: 'http' }), { status: 200 })
const client = () => new HostClient('https://host.example', 'token', ok)
const socket = (invoke) => ({ state: 'ready', invoke })

test('a ready socket carries the call', async () => {
  registerSocketProvider(() => socket(async () => 'socket'))
  assert.equal(await client().invoke('projects.list'), 'socket')
})

test('a call that was never sent falls back to HTTP', async () => {
  registerSocketProvider(() => socket(async () => Promise.reject(Object.assign(new Error('x'), { notSent: true }))))
  assert.equal(await client().invoke('projects.list'), 'http')
})

test('a call lost after sending is an unknown outcome, never replayed over HTTP', async () => {
  registerSocketProvider(() =>
    socket(async () => Promise.reject(Object.assign(new Error('lost'), { code: 'ECONNRESET' }))),
  )
  await assert.rejects(client().invoke('projects.list'), (error) => error.ambiguous === true)
})

test('a host answer over the socket is final', async () => {
  registerSocketProvider(() => socket(async () => Promise.reject(new Error('Nope'))))
  await assert.rejects(client().invoke('projects.list'), (error) => error.message === 'Nope' && !error.ambiguous)
})

test('without a provider, HTTP is used', async () => {
  registerSocketProvider(null)
  assert.equal(await client().invoke('projects.list'), 'http')
})

test('closing a suspended socket client releases hydration immediately and never retries a mutation', async () => {
  let sends = 0
  registerSocketProvider(() =>
    socket(async (method) => {
      if (method === 'background.status') return { capabilities: ['operation-keys'] }
      sends++
      return new Promise(() => {})
    }),
  )
  const host = client()
  const pending = host.invoke('agent.submit', 'session', 'Go', 'queue')
  for (let step = 0; step < 10; step++) await Promise.resolve()
  assert.equal(sends, 1)
  host.close()
  await assert.rejects(pending, (error) => error.ambiguous === true)
  assert.equal(sends, 1)
  await assert.rejects(host.invoke('projects.list'), /suspended before sending/)
  registerSocketProvider(null)
})

test('closing a client does not wait for a native HTTP implementation to finish aborting', async () => {
  registerSocketProvider(null)
  let signal
  const host = new HostClient('https://host.example', 'token', async (_url, options) => {
    signal = options.signal
    return new Promise(() => {})
  })
  const pending = host.invoke('projects.list')
  host.close()
  await assert.rejects(pending, /Connection suspended/)
  assert.equal(signal.aborted, true)
})

test('suspension closes only this host socket so resume creates a fresh connection', () => {
  const closed = []
  registerSocketProvider(
    () => null,
    (address, token) => closed.push({ address, token }),
  )
  const host = client()
  host.close()
  host.close()
  assert.deepEqual(closed, [{ address: 'https://host.example', token: 'token' }])
  registerSocketProvider(null)
})
