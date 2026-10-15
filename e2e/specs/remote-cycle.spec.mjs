// Two standalone servers paired with each other in both directions (A on B and B on A): a request ends on the host it
// was sent to, nothing bounces back through the other, and revoking one direction leaves the other working. No Electron.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { HostClient } from '../../apps/mobile/src/runtime/transport.ts'
import { startRamu, startServer, until } from '../support/index.mjs'

// A directory and cleanup only; the spec never launches the desktop app.
const ramu = await startRamu('remote-cycle', { launch: false })
const connections = []
const streams = []

/** A client of `to` with an open event stream, authenticated through a fresh pairing code. */
async function connect(from, to) {
  const paired = await to.pair(`Reciprocal ${from.name}`)
  assert.ok(paired.token)
  const client = new HostClient(to.url, paired.token, fetch)
  const controller = new AbortController()
  const connection = { client, controller, events: [], deviceId: paired.deviceId, streamError: undefined }
  let ready = false
  streams.push(
    client
      .stream(
        (channel, payload) => connection.events.push({ channel, payload }),
        async () => {
          ready = true
        },
        controller.signal,
      )
      .catch((error) => {
        if (!controller.signal.aborted) connection.streamError = error
      }),
  )
  connections.push(connection)
  await until(() => ready, `${from.name} on ${to.name}: the event stream never became ready`)
  return connection
}

const [a, b] = await Promise.all([
  startServer({ name: 'a', dir: ramu.dir, listen: true }),
  startServer({ name: 'b', dir: ramu.dir, listen: true }),
])
const [aOnB, bOnA] = await Promise.all([connect(a, b), connect(b, a)])

after(async () => {
  for (const { client, controller } of connections) {
    controller.abort()
    client.close()
  }
  await Promise.allSettled(streams)
})

test('requests end on their direct host; remote computers cannot be crawled or administered through it', async () => {
  assert.equal((await aOnB.client.invoke('background.status')).pid, b.child.pid)
  assert.equal((await bOnA.client.invoke('background.status')).pid, a.child.pid)
  for (const { client } of [aOnB, bOnA]) {
    await assert.rejects(client.invoke('computers.list'), /Unknown method/)
    await assert.rejects(client.invoke('network.pair'), /managed from the computer/)
    await assert.rejects(client.invoke('host.reply', 'forged', null), /only available on this computer/)
  }
})

test('a mutation and its events stay on the host that received them', async () => {
  const task = await bOnA.client.invoke('tasks.create', {
    projectId: 'no-project',
    title: 'Reciprocal isolation',
    mode: 'current',
  })
  const session = await bOnA.client.invoke('agent.start', task.id, 'Reciprocal isolation fixture', {
    provider: 'claude-code',
    model: '',
    effort: null,
    access: 'auto',
    autoFallback: false,
  })
  const eventsFor = (connection) =>
    connection.events.filter((e) => e.channel === 'agent:event' && e.payload.sessionId === session.id)
  await until(() => eventsFor(bOnA).length > 0, 'the host never streamed the session')
  // The run has finished once it is idle; anything B rebroadcast to A would have arrived by then.
  await until(async () => (await bOnA.client.invoke('agent.get', session.id)).state === 'idle', 'run to finish')
  assert.equal(eventsFor(aOnB).length, 0, 'an event was rebroadcast to the other host')
  assert.equal((await bOnA.client.invoke('tasks.list')).filter((t) => t.id === task.id).length, 1)
  assert.equal(
    (await aOnB.client.invoke('tasks.list')).some((t) => t.id === task.id),
    false,
    'the task leaked to the other host',
  )
})

test('revoking one direction leaves the other connected', async () => {
  assert.equal(aOnB.streamError, undefined)
  assert.equal(bOnA.streamError, undefined)
  await b.invoke('network.revoke', aOnB.deviceId)
  await assert.rejects(aOnB.client.invoke('tasks.list'), (error) => error.status === 401)
  assert.equal((await bOnA.client.invoke('background.status')).pid, a.child.pid)
  assert.equal(bOnA.streamError, undefined)
})
