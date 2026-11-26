import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renewCredential, renewalDue, RENEW_EVERY_MS } from '../src/runtime/tokenRenewal.ts'

const fresh = 'a'.repeat(64)
const client = () => {
  let token = 'o'.repeat(64)
  return { address: 'https://host', token: () => token, useToken: (next) => (token = next), current: () => token }
}
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('renews weekly, and when the stored time is missing or in the future', () => {
  assert.equal(renewalDue(1000, null), true)
  assert.equal(renewalDue(1000 + RENEW_EVERY_MS - 1, 1000), false)
  assert.equal(renewalDue(1000 + RENEW_EVERY_MS, 1000), true)
  assert.equal(renewalDue(1000, 5000), true)
})

test('saves the new token before it is used, then switches to it', async () => {
  const c = client()
  const order = []
  const ok = await renewCredential(
    c,
    reply(200, { token: fresh, expiresAt: 1 }),
    async (token) => {
      assert.equal(c.current(), 'o'.repeat(64))
      order.push(`save:${token === fresh}`)
    },
    async () => order.push('mark'),
  )
  assert.equal(ok, true)
  assert.deepEqual(order, ['save:true', 'mark'])
  assert.equal(c.current(), fresh)
})

test('keeps the current token when the host refuses, is old, is offline or returns junk', async () => {
  for (const fetcher of [
    reply(401, {}),
    reply(404, {}),
    reply(200, { token: 'short' }),
    reply(200, 'not-an-object'),
    async () => {
      throw new Error('offline')
    },
  ]) {
    const c = client()
    assert.equal(
      await renewCredential(
        c,
        fetcher,
        async () => assert.fail('saved'),
        async () => assert.fail('marked'),
      ),
      false,
    )
    assert.equal(c.current(), 'o'.repeat(64))
  }
})

test('a failed save leaves the old token in use', async () => {
  const c = client()
  await assert.rejects(
    renewCredential(
      c,
      reply(200, { token: fresh }),
      async () => Promise.reject(new Error('disk')),
      async () => {},
    ),
  )
  assert.equal(c.current(), 'o'.repeat(64))
})

test('renews within a day, not a week, while a host has not bound this phone’s key', () => {
  const day = 24 * 60 * 60_000
  assert.equal(renewalDue(1000 + day - 1, 1000, true), false)
  assert.equal(renewalDue(1000 + day, 1000, true), true)
  assert.equal(renewalDue(1000 + day, 1000, false), false)
})

test('names its key and proves it when renewing, and records whether the host bound the token', async () => {
  const c = client()
  let sent
  const marks = []
  const prover = { publicKey: 'k'.repeat(64), header: (token, purpose) => `proof:${purpose}:${token.slice(0, 2)}` }
  const ok = await renewCredential(
    c,
    async (url, init) => {
      sent = { url, init }
      return new Response(JSON.stringify({ token: fresh, expiresAt: 1, bound: true }), { status: 200 })
    },
    async () => {},
    async (at, bound) => marks.push([at, bound]),
    5000,
    prover,
  )
  assert.equal(ok, true)
  assert.equal(sent.url, 'https://host/renew')
  assert.equal(sent.init.headers['x-ramu-proof'], 'proof:renew:oo')
  assert.deepEqual(JSON.parse(sent.init.body), { key: 'k'.repeat(64) })
  assert.deepEqual(marks, [[5000, true]])
})

test('an older host that binds nothing is recorded as unbound', async () => {
  const marks = []
  await renewCredential(
    client(),
    reply(200, { token: fresh, expiresAt: 1 }),
    async () => {},
    async (at, bound) => marks.push(bound),
    5000,
    { publicKey: 'k'.repeat(64), header: () => 'proof' },
  )
  assert.deepEqual(marks, [false])
})
