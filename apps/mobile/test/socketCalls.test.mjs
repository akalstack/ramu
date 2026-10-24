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
