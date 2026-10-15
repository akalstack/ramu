// Two disposable hosts paired in both directions. No model calls or personal data.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { createServer } from 'node:net'
import { HostClient } from '../apps/mobile/src/runtime/transport.ts'

const root = resolve(import.meta.dirname, '..'),
  directory = mkdtempSync(join(tmpdir(), 'ramu-cycle-'))
const hosts = [],
  connections = [],
  streams = []
const until = async (check) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error('Timed out waiting for reciprocal host test')
}
const local = (socketPath, method, ...args) =>
  new Promise((resolve, reject) => {
    const req = request({ socketPath, path: '/invoke', method: 'POST' }, (res) => {
      let text = ''
      res.on('data', (d) => (text += d))
      res.on('end', () => {
        try {
          const body = JSON.parse(text)
          body.error ? reject(new Error(body.error)) : resolve(body.value)
        } catch (error) {
          reject(error)
        }
      })
    })
    req.on('error', reject)
    req.end(JSON.stringify({ method, args }))
  })
async function start(name) {
  const listener = createServer()
  await new Promise((r) => listener.listen(0, '127.0.0.1', r))
  const port = listener.address().port
  await new Promise((r) => listener.close(r))
  const profile = join(directory, name),
    socket = join(directory, `${name}.sock`)
  const child = spawn(
    process.execPath,
    [join(root, 'apps/server/dist/cli.js'), 'serve', '--data-dir', profile, '--listen', String(port)],
    {
      env: { ...process.env, RAMU_SOCKET: socket, RAMU_WORKTREES: join(profile, 'worktrees'), RAMU_FAKE_AGENT: '1' },
      stdio: 'ignore',
    },
  )
  const host = { child, socket, url: `http://127.0.0.1:${port}` }
  hosts.push(host)
  await until(() =>
    local(socket, 'background.status').then(
      () => true,
      () => false,
    ),
  )
  return host
}
async function connect(from, to) {
  const offer = await local(to.socket, 'network.pair')
  const paired = await fetch(to.url + '/pair', {
    method: 'POST',
    body: JSON.stringify({ code: offer.code, name: `Reciprocal ${from.url}` }),
  }).then((r) => r.json())
  assert.ok(paired.token)
  const client = new HostClient(to.url, paired.token, fetch),
    controller = new AbortController(),
    events = []
  let ready = false
  streams.push(
    client
      .stream(
        (channel, payload) => events.push({ channel, payload }),
        async () => {
          ready = true
        },
        controller.signal,
      )
      .catch((error) => {
        if (!controller.signal.aborted) connection.streamError = error
      }),
  )
  const connection = { client, controller, events, deviceId: paired.deviceId }
  connections.push(connection)
  await until(() => ready)
  return connection
}
try {
  const [a, b] = await Promise.all([start('a'), start('b')])
  const [aOnB, bOnA] = await Promise.all([connect(a, b), connect(b, a)])
  assert.equal((await aOnB.client.invoke('background.status')).pid, b.child.pid)
  assert.equal((await bOnA.client.invoke('background.status')).pid, a.child.pid)
  for (const connection of [aOnB, bOnA]) {
    await assert.rejects(connection.client.invoke('computers.list'), /Unknown method/)
    await assert.rejects(connection.client.invoke('network.pair'), /managed from the computer/)
    await assert.rejects(connection.client.invoke('host.reply', 'forged', null), /only available on this computer/)
  }
  console.log(
    'ok - A↔B requests terminate on their direct host; no remote computer crawling or native-admin forwarding',
  )
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
  const eventsForSession = (connection) =>
    connection.events.filter((e) => e.channel === 'agent:event' && e.payload.sessionId === session.id)
  await until(() => eventsForSession(bOnA).length > 0)
  await new Promise((r) => setTimeout(r, 300))
  assert.equal(eventsForSession(aOnB).length, 0, 'A event must not be rebroadcast by B')
  assert.equal((await bOnA.client.invoke('tasks.list')).filter((t) => t.id === task.id).length, 1)
  assert.equal(
    (await aOnB.client.invoke('tasks.list')).some((t) => t.id === task.id),
    false,
  )
  await bOnA.client.invoke('agent.stop', session.id)
  console.log('ok - mutation and event stay on A without bouncing back through B')
  assert.equal(aOnB.streamError, undefined)
  assert.equal(bOnA.streamError, undefined)
  await local(b.socket, 'network.revoke', aOnB.deviceId)
  await assert.rejects(aOnB.client.invoke('tasks.list'), (error) => error.status === 401)
  assert.equal((await bOnA.client.invoke('background.status')).pid, a.child.pid)
  assert.equal(bOnA.streamError, undefined)
  console.log('ok - revoking A on B does not revoke or disconnect B on A')
} finally {
  for (const connection of connections) {
    connection.controller.abort()
    connection.client.close()
  }
  for (const host of hosts) host.child.kill('SIGTERM')
  await Promise.allSettled(streams)
  await Promise.all(
    hosts.map((host) =>
      host.child.exitCode != null ? Promise.resolve() : new Promise((r) => host.child.once('exit', r)),
    ),
  )
  rmSync(directory, { recursive: true, force: true })
}
