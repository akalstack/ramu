import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renewCredential, renewalDue, RENEW_EVERY_MS } from '../src/runtime/tokenRenewal.ts'

const fresh = 'a'.repeat(64)
const client = () => {
  let token = 'o'.repeat(64)
  return { address: 'https://host', token: () => token, useToken: (next) => (token = next), current: () => token }
}
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status })

test('renews monthly, and when the stored time is missing or in the future', () => {
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
