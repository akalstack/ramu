import { afterEach, expect, it, vi } from 'vitest'
import { DesktopBrowserBroker } from '../src/browser/desktopBroker'
import type { BrowserBridgeRequest } from '@ramu/shared/browserBridge'

afterEach(() => vi.useRealTimers())
const setup = () => {
  const messages: BrowserBridgeRequest[] = []
  const broker = new DesktopBrowserBroker((_client, message) => {
    messages.push(message)
    return true
  }, 1000)
  const { token } = broker.attach('desktop')
  broker.ready('desktop', token)
  return { broker, messages, token }
}

it('requires registration and its acknowledgement, and never sends work to an unrelated desktop', async () => {
  const broker = new DesktopBrowserBroker(() => {
    throw new Error('must not send')
  })
  await expect(broker.request('thread', 'run', { kind: 'list' })).rejects.toThrow('Open Ramu')
  const { token } = broker.attach('one')
  expect(broker.status().available).toBe(false)
  await expect(broker.request('thread', 'run', { kind: 'list' })).rejects.toThrow('Open Ramu')
  expect(() => broker.ready('one', 'wrong')).toThrow('no longer active')
  expect(() => broker.attach('two')).toThrow('already owns')
  broker.ready('one', token)
  expect(broker.status().available).toBe(true)
  broker.detach('two')
  expect(broker.status().available).toBe(true)
  broker.detach('one')
})

it('binds results to the registered connection and carries server-derived thread/run identity', async () => {
  const { broker, messages, token } = setup()
  const waiting = broker.request('thread', 'run', { kind: 'click', tabId: 'tab', snapshot: 3, ref: 1 })
  const request = messages[0]!
  expect(request).toMatchObject({ clientId: 'desktop', threadId: 'thread', runId: 'run' })
  expect(JSON.stringify(request)).not.toContain(token)
  expect(() => broker.reply('desktop', 'wrong', request.requestId, {})).toThrow('no longer active')
  broker.reply('desktop', token, request.requestId, { ok: true })
  await expect(waiting).resolves.toEqual({ ok: true })
  broker.detach('desktop')
})

it('fails disconnected and expired work without replay and ignores late results', async () => {
  vi.useFakeTimers()
  const { broker, messages, token } = setup()
  const timedOut = broker.request('thread', 'run', { kind: 'open', url: 'https://a.test' })
  const failure = expect(timedOut).rejects.toThrow('may have run')
  await vi.advanceTimersByTimeAsync(1001)
  await failure
  broker.reply('desktop', token, messages[0]!.requestId, { ok: true })
  expect(messages).toHaveLength(1)
  const pending = broker.request('thread', 'run', { kind: 'list' })
  const disconnected = expect(pending).rejects.toThrow('disconnected')
  broker.detach('desktop')
  await disconnected
  broker.attach('desktop')
  expect(messages).toHaveLength(2)
})

it('cancels only the ended run and tells the desktop to revoke its leases', async () => {
  const { broker, messages, token } = setup()
  const first = broker.request('thread', 'run', { kind: 'list' })
  const other = broker.request('other', 'run', { kind: 'list' })
  const ended = expect(first).rejects.toThrow('run stopped')
  broker.endRun('thread', 'run')
  await ended
  expect(messages.at(-1)).toMatchObject({ threadId: 'thread', runId: 'run', command: { kind: 'end' } })
  broker.reply('desktop', token, messages[1]!.requestId, [])
  await expect(other).resolves.toEqual([])
  broker.detach('desktop')
})

it('bounds pending operations and refuses oversized or unserializable replies', async () => {
  const { broker, messages, token } = setup()
  const pending = Array.from({ length: 8 }, () => broker.request('thread', 'run', { kind: 'list' }))
  const settled = Promise.allSettled(pending)
  await expect(broker.request('thread', 'run', { kind: 'list' })).rejects.toThrow('busy')
  broker.reply('desktop', token, messages[0]!.requestId, 'x'.repeat(200001))
  const cycle: { self?: unknown } = {}
  cycle.self = cycle
  broker.reply('desktop', token, messages[1]!.requestId, cycle)
  broker.detach('desktop')
  const outcomes = await settled
  expect(outcomes.every((outcome) => outcome.status === 'rejected')).toBe(true)
})

it('reports its owner so a new desktop can replace one that is gone', () => {
  const { broker } = setup()
  expect(broker.owner()).toBe('desktop')
  broker.detach('desktop')
  expect(broker.owner()).toBeNull()
  const { token } = broker.attach('replacement')
  broker.ready('replacement', token)
  expect(broker.status().available).toBe(true)
})

it('sends a paired device’s view to the desktop as a viewer, never as an agent run, and caps it apart from agents', async () => {
  const { broker, messages, token } = setup()
  const operation = { kind: 'viewer' as const, device: 'phone', operation: { op: 'list' as const } }
  const views = [1, 2, 3].map(() => broker.view('thread', operation))
  expect(messages).toHaveLength(3)
  expect(messages[0]).toMatchObject({ threadId: 'thread', runId: 'viewer', command: operation })
  await expect(broker.view('thread', operation)).rejects.toThrow('busy')
  const agent = broker.request('thread', 'run', { kind: 'list' })
  expect(messages).toHaveLength(4)
  for (const message of messages) broker.reply('desktop', token, message.requestId, [])
  await Promise.all([...views, agent])
  broker.detach('desktop')
})

it('keeps waiting live frames out of the input and agent operation budgets', async () => {
  const { broker, messages, token } = setup()
  const frames = Array.from({ length: 8 }, (_, i) =>
    broker.view('thread', {
      kind: 'viewer',
      device: `phone-${i}`,
      operation: { op: 'nextFrame', tabId: 'tab', after: 0 },
    }),
  )
  await expect(
    broker.view('thread', { kind: 'viewer', device: 'extra', operation: { op: 'nextFrame', tabId: 'tab', after: 0 } }),
  ).rejects.toThrow('busy')
  const input = broker.view('thread', {
    kind: 'viewer',
    device: 'phone-0',
    operation: { op: 'input', tabId: 'tab', generation: 1, input: { kind: 'scroll', x: 0, y: 100 } },
  })
  const agent = broker.request('thread', 'run', { kind: 'snapshot', tabId: 'tab' })
  expect(messages).toHaveLength(10)
  for (const message of messages) broker.reply('desktop', token, message.requestId, null)
  await Promise.all([...frames, input, agent])
  broker.detach('desktop')
})

it('reports when the desktop browser becomes available or leaves', () => {
  const changed = vi.fn()
  const broker = new DesktopBrowserBroker(() => true, 1000, undefined, changed)
  const { token } = broker.attach('desktop')
  expect(changed).not.toHaveBeenCalled()
  broker.ready('desktop', token)
  expect(changed).toHaveBeenCalledTimes(1)
  broker.detach('desktop')
  expect(changed).toHaveBeenCalledTimes(2)
})
