import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  HostClient,
  HostError,
  registerRequestProof,
  registerSocketProvider,
  checkHostConnection,
  readConnectionStatus,
} from '../src/runtime/transport.ts'

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
  await assert.rejects(client().invoke('projects.list'), /cannot connect to a host/)
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
  await assert.rejects(blocked.invoke('tasks.list'), /blocks live connections/)
  const offline = client(async () => Promise.reject(new Error('offline')))
  await assert.rejects(offline.invoke('tasks.list'), (error) => error.message === 'Host unreachable')
})

test('a refused proof is not a revoked pairing: the clock is read once and the check repeated', async () => {
  provide(socket({ whenReady: async () => Promise.reject(Object.assign(new Error('late'), { notSent: true })) }))
  const refuse = (error) => new Response(JSON.stringify({ error }), { status: 401 })
  let offset = 0
  const synced = []
  registerRequestProof({
    sign: () => `proof@${offset}`,
    sync: async (address) => {
      synced.push(address)
      offset = 7200
    },
  })
  try {
    // A clock two hours off: stale at first, accepted once the host's clock is used.
    const proofs = []
    const skewed = client(async (_url, options) => {
      proofs.push(options.headers['x-ramu-proof'])
      return proofs.length === 1 ? refuse('proof-stale') : new Response('{"access":"owner"}')
    })
    await assert.rejects(skewed.invoke('tasks.list'), /blocks live connections/)
    assert.deepEqual(proofs, ['proof@0', 'proof@7200'])
    assert.deepEqual(synced, ['https://host.example'])
    // A key that cannot be read just now: the pairing stands, so this is an ordinary failed connection.
    const locked = client(async () => refuse('proof-missing'))
    await assert.rejects(locked.invoke('tasks.list'), (error) => error.status !== 401)
    // No proof problem named: the token itself was refused.
    const revoked = client(async () => new Response('', { status: 401 }))
    await assert.rejects(revoked.invoke('tasks.list'), (error) => error.status === 401)
  } finally {
    registerRequestProof(null)
  }
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

test('discovery readiness uses an isolated probe without opening or closing the conversation socket', async () => {
  let probes = 0
  registerSocketProvider(
    () => assert.fail('must not borrow a live conversation socket'),
    () => assert.fail('must not close a live conversation socket'),
    async (address, token, signal) => {
      assert.equal(address, 'http://host:7788')
      assert.equal(token, 'saved-token')
      assert.equal(signal.aborted, false)
      probes++
      return true
    },
  )
  assert.equal(await checkHostConnection('http://host:7788', 'saved-token', never, new AbortController().signal), true)
  assert.equal(probes, 1)
  const controller = new AbortController()
  controller.abort()
  assert.equal(await checkHostConnection('http://host:7788', 'saved-token', never, controller.signal), false)
  assert.equal(probes, 1)
  registerSocketProvider(null)
})

test(
  'disconnect and suspension settle immediately even when history hydration never completes',
  { timeout: 1000 },
  async () => {
    const host = socket()
    provide(host)
    let rejectHistory
    const running = client().stream(
      () => {},
      () =>
        new Promise((_resolve, reject) => {
          rejectHistory = reject
        }),
      new AbortController().signal,
    )
    await new Promise((resolve) => setImmediate(resolve))
    host.move('closed')
    await assert.rejects(running, /disconnected/)
    rejectHistory(new Error('old history finished late'))
    await new Promise((resolve) => setImmediate(resolve))
    const controller = new AbortController()
    const suspended = client().stream(
      () => {},
      () => new Promise(() => {}),
      controller.signal,
    )
    await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await suspended
    assert.equal(host.listeners.size, 0)
  },
)

test('the initial status read times out and closes a half-open connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  provide(socket({ invoke: () => new Promise(() => {}) }))
  const owner = client()
  const pending = readConnectionStatus(owner, new AbortController().signal)
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(8000)
  await assert.rejects(pending, /finish connecting/)
  await assert.rejects(owner.invoke('tasks.list'), /suspended/)
})

test('failed-connection diagnosis still finishes when native fetch ignores its abort signal', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  provide(
    socket({
      whenReady: async () => {
        throw Object.assign(new Error('late'), { notSent: true })
      },
    }),
  )
  const pending = client(() => new Promise(() => {})).invoke('tasks.list')
  await new Promise((resolve) => setImmediate(resolve))
  t.mock.timers.tick(8000)
  await assert.rejects(pending, /Host unreachable/)
})
