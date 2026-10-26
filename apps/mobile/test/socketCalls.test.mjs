import { test } from 'node:test'
import assert from 'node:assert/strict'
import { HostClient, HostError, registerSocketProvider } from '../src/runtime/transport.ts'

const never = async () => {
  throw new Error('HTTP must not carry calls')
}
const client = (fetcher = never) => new HostClient('https://host.example', 'token', fetcher)
/** A scripted host socket: `invoke` answers calls, `emit`/`move` play events and state changes. */
function socket(overrides = {}) {
  const listeners = new Set()
  const value = {
    state: 'ready',
    whenReady: async () => {},
    invoke: async () => 'socket',
    listen: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (channel, payload) => listeners.forEach((l) => l.event(channel, payload)),
    move: (state) => listeners.forEach((l) => l.state?.(state)),
    listeners,
    ...overrides,
  }
  return value
}
const provide = (value) => registerSocketProvider(() => value)
const lost = () => Object.assign(new Error('lost'), { code: 'ECONNRESET' })

test('the socket carries every call, with optional argument positions kept, and HTTP is never used', async () => {
  const seen = []
  provide(socket({ invoke: async (method, args) => (seen.push({ method, args }), true) }))
  assert.equal(await client().invoke('git.commit', 'task', 'repo', 'message', undefined, 'head'), true)
  assert.deepEqual(seen[0].args, ['task', 'repo', 'message', undefined, 'head'])
})

test('a call waits for the socket to be ready before it is sent', async () => {
  let open
  const gate = new Promise((resolve) => (open = resolve))
  const sent = []
  provide(socket({ whenReady: () => gate, invoke: async (method) => (sent.push(method), 'ok') }))
  const pending = client().invoke('projects.list')
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(sent, [])
  open()
  assert.equal(await pending, 'ok')
})

test('a call that was never sent is tried once more, then reported as unreachable', async () => {
  let tries = 0
  provide(
    socket({
      invoke: async () => {
        tries++
        throw Object.assign(new Error('x'), { notSent: true })
      },
    }),
  )
  await assert.rejects(
    client().invoke('projects.list'),
    (error) => error.message === 'Host unreachable' && !error.ambiguous,
  )
  assert.equal(tries, 2)
})

test('a call lost after sending is an unknown outcome, never replayed', async () => {
  let tries = 0
  provide(socket({ invoke: async () => (tries++, Promise.reject(lost())) }))
  await assert.rejects(client().invoke('projects.list'), (error) => error.ambiguous === true)
  assert.equal(tries, 1)
})

test('a host answer over the socket is final', async () => {
  provide(socket({ invoke: async () => Promise.reject(new Error('Nope')) }))
  await assert.rejects(client().invoke('projects.list'), (error) => error.message === 'Nope' && !error.ambiguous)
})

test('a build without sockets says so rather than falling back', async () => {
  registerSocketProvider(null)
  await assert.rejects(client().invoke('projects.list'), /needs a WebSocket/)
})

test('a refused token is reported as revoked, and a host without sockets as needing an update', async () => {
  provide(socket({ whenReady: async () => Promise.reject(Object.assign(new Error('refused'), { status: 401 })) }))
  await assert.rejects(client().invoke('tasks.list'), (error) => error.status === 401 && !error.ambiguous)
  provide(socket({ whenReady: async () => Promise.reject(Object.assign(new Error('old'), { status: 426 })) }))
  await assert.rejects(
    client().invoke('tasks.list'),
    (error) => error.status === 426 && /Update Ramu/.test(error.message),
  )
})

test('a socket that never connects is checked once over HTTP to say why', async () => {
  provide(socket({ whenReady: async () => Promise.reject(Object.assign(new Error('late'), { notSent: true })) }))
  const probes = []
  const revoked = client(
    async (url, options) => (
      probes.push({ url, auth: options.headers.Authorization }),
      new Response('', { status: 401 })
    ),
  )
  await assert.rejects(revoked.invoke('tasks.list'), (error) => error.status === 401)
  assert.deepEqual(probes, [{ url: 'https://host.example/session', auth: 'Bearer token' }])
  const blocked = client(async () => new Response('{"access":"owner"}'))
  await assert.rejects(blocked.invoke('tasks.list'), /blocks WebSockets/)
  const offline = client(async () => Promise.reject(new Error('offline')))
  await assert.rejects(offline.invoke('tasks.list'), (error) => error.message === 'Host unreachable')
})

test('a host with operation keys gets the same key on a retried send after a lost connection', async () => {
  const keys = []
  let drops = 1
  provide(
    socket({
      invoke: async (method, _args, options) => {
        if (method === 'background.status') return { capabilities: ['operation-keys'] }
        keys.push(options.operationKey)
        if (drops-- > 0) throw lost()
        return 'sent'
      },
    }),
  )
  assert.equal(await client().invoke('agent.send', 'session', 'hello'), 'sent')
  assert.equal(keys.length, 2)
  assert.match(keys[0], /^[A-Za-z0-9_-]{8,128}$/)
  assert.equal(keys[0], keys[1])
})

test('unlisted methods carry no operation key, and host answers are not retried', async () => {
  let sends = 0
  provide(
    socket({
      invoke: async (method, _args, options) => {
        if (method === 'background.status') return { capabilities: ['operation-keys'] }
        if (method === 'agent.send') {
          sends++
          throw new Error('Session not found')
        }
        assert.equal(options.operationKey, undefined)
        return []
      },
    }),
  )
  await assert.rejects(client().invoke('agent.send', 'session', 'hello'), /Session not found/)
  assert.equal(sends, 1)
  assert.deepEqual(await client().invoke('tasks.list'), [])
})

test('closing a suspended client releases hydration immediately and never retries a mutation', async () => {
  let sends = 0
  provide(
    socket({
      invoke: async (method) => {
        if (method === 'background.status') return { capabilities: ['operation-keys'] }
        sends++
        return new Promise(() => {})
      },
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
})

test('suspension closes only this host socket so resume creates a fresh connection', () => {
  const closed = []
  registerSocketProvider(socket, (address, token) => closed.push({ address, token }))
  const host = client()
  host.close()
  host.close()
  assert.deepEqual(closed, [{ address: 'https://host.example', token: 'token' }])
})

test('a stream listens before hydration runs, delivers events, and ends when the socket drops', async () => {
  const host = socket()
  provide(host)
  const received = []
  let listening = false
  const running = client().stream(
    (channel) => received.push(channel),
    async () => {
      listening = host.listeners.size === 1
      host.emit('usage:changed', [])
    },
    new AbortController().signal,
  )
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(listening, true)
  assert.deepEqual(received, ['usage:changed'])
  host.move('closed')
  await assert.rejects(running, (error) => error instanceof HostError && /disconnected/.test(error.message))
  assert.equal(host.listeners.size, 0)
})

test('a stream ends cleanly when aborted or when its client closes, and surfaces a failed hydration', async () => {
  const host = socket()
  provide(host)
  const controller = new AbortController()
  const aborted = client().stream(
    () => {},
    async () => {},
    controller.signal,
  )
  controller.abort()
  await aborted
  const owner = client()
  const closing = owner.stream(
    () => {},
    async () => {},
    new AbortController().signal,
  )
  await new Promise((resolve) => setTimeout(resolve, 10))
  owner.close()
  await assert.rejects(closing, /disconnected/)
  await assert.rejects(
    client().stream(
      () => {},
      async () => Promise.reject(new Error('Hydration failed')),
      new AbortController().signal,
    ),
    /Hydration failed/,
  )
  assert.equal(host.listeners.size, 0)
})
