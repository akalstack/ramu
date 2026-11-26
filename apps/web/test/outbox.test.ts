import { expect, it } from 'vitest'
import { createOutbox, OUTBOX_LIMIT, type OutboxItem } from '../src/composer/outbox'

function memory() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
}

function setup(
  options: { online?: boolean; fail?: (item: OutboxItem) => boolean; store?: ReturnType<typeof memory> } = {},
) {
  const sent: string[] = []
  let online = options.online ?? false,
    id = 0
  const store = options.store ?? memory()
  const box = createOutbox({
    store,
    connected: () => online,
    uid: () => `m${++id}`,
    submit: async (item) => {
      if (options.fail?.(item)) throw new Error('host said no')
      sent.push(`${item.sessionId}:${item.text}`)
    },
  })
  return {
    box,
    sent,
    store,
    goOnline: async () => {
      online = true
      await box.flush()
    },
    goOffline: () => {
      online = false
    },
  }
}

it('holds messages while offline and sends them oldest first on reconnect', async () => {
  const { box, sent, goOnline } = setup()
  box.add('a', 'first')
  box.add('b', 'other thread')
  box.add('a', 'second')
  await box.flush()
  expect(sent).toEqual([])
  await goOnline()
  expect(sent).toEqual(['a:first', 'b:other thread', 'a:second'])
  expect(box.snapshot()).toEqual([])
})

it('keeps a failed message and everything after it in that thread, without blocking other threads', async () => {
  const { box, sent, goOnline } = setup({ fail: (item) => item.text === 'bad' })
  box.add('a', 'bad')
  box.add('a', 'after')
  box.add('b', 'fine')
  await goOnline()
  expect(sent).toEqual(['b:fine'])
  expect(box.list('a').map((item) => [item.text, item.state])).toEqual([
    ['bad', 'failed'],
    ['after', 'waiting'],
  ])
  expect(box.list('a')[0]!.error).toBe('host said no')
})

it('puts a message back to waiting when the connection drops during the send', async () => {
  let online = true
  const box = createOutbox({
    store: memory(),
    connected: () => online,
    submit: async () => {
      online = false
      throw new Error('disconnected')
    },
  })
  box.add('a', 'hello')
  await box.flush()
  expect(box.list('a')[0]!.state).toBe('waiting')
})

it('retries a failed message on request', async () => {
  let fail = true
  const { box, sent, goOnline } = setup({ fail: () => fail })
  box.add('a', 'hello')
  await goOnline()
  fail = false
  box.retry(box.list('a')[0]!.id)
  await box.flush()
  expect(sent).toEqual(['a:hello'])
})

it('refuses beyond the per-thread limit and returns removed messages for editing', () => {
  const { box } = setup()
  for (let index = 0; index < OUTBOX_LIMIT; index++) expect(box.add('a', `m${index}`)).toBe(true)
  expect(box.add('a', 'one too many')).toBe(false)
  expect(box.add('b', 'another thread')).toBe(true)
  const taken = box.remove(box.list('a')[0]!.id)
  expect(taken?.text).toBe('m0')
  expect(box.list('a')).toHaveLength(OUTBOX_LIMIT - 1)
})

it('survives a restart, and a send cut off by closing needs a decision', () => {
  const store = memory()
  store.setItem(
    'ramu.outbox',
    JSON.stringify([
      { id: 'x', sessionId: 'a', text: 'was sending', attachments: [], context: [], createdAt: 1, state: 'sending' },
      { id: 'y', sessionId: 'a', text: 'still waiting', attachments: [], context: [], createdAt: 2, state: 'waiting' },
      { nonsense: true },
    ]),
  )
  const { box } = setup({ store })
  expect(box.list('a').map((item) => [item.text, item.state])).toEqual([
    ['was sending', 'failed'],
    ['still waiting', 'waiting'],
  ])
})

it('ignores corrupt storage', () => {
  const store = memory()
  store.setItem('ramu.outbox', '{not json')
  expect(setup({ store }).box.snapshot()).toEqual([])
})

it('keeps equal session IDs on separate hosts and reconnects only the host whose queue can send', async () => {
  const { vi } = await import('vitest')
  const { outbox } = await import('../src/composer/outbox')
  const entries = new Map<string, string>()
  const listeners = new Map<string, ((payload: any, host?: string) => void)[]>()
  const invokeOnce = vi.fn(async (..._call: unknown[]) => undefined)
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
    removeItem: (key: string) => entries.delete(key),
    key: (index: number) => [...entries.keys()][index] ?? null,
    get length() {
      return entries.size
    },
  })
  vi.stubGlobal('window', {
    ramu: {
      hostId: 'local',
      invokeOnce,
      invoke: async () => ({
        current: 'local',
        computers: [
          { id: 'studio-queue', status: 'offline' },
          { id: 'laptop-queue', status: 'offline' },
        ],
      }),
      on: (channel: string, receive: (payload: any, host?: string) => void) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), receive])
        return () => {}
      },
    },
  })
  try {
    const studio = outbox('studio-queue'),
      laptop = outbox('laptop-queue')
    await Promise.resolve()
    studio.add('same', 'studio message')
    laptop.add('same', 'laptop message')
    for (const receive of listeners.get('background:connection') ?? []) receive({ connected: true }, 'studio-queue')
    await studio.flush()
    // The message's own id is its operation key, so a send repeated after a lost connection is taken once.
    const [key, ...sent] = invokeOnce.mock.calls[0]!
    expect(key).toMatch(/^[A-Za-z0-9_-]{8,128}$/)
    expect(sent).toEqual(['studio-queue', 'agent.submit', 'same', 'studio message', 'queue', [], []])
    expect(studio.list('same')).toEqual([])
    expect(laptop.list('same')).toHaveLength(1)
    expect([...entries.keys()]).toContain('host:laptop-queue:ramu.outbox')
  } finally {
    vi.unstubAllGlobals()
  }
})
