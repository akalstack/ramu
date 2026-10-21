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
