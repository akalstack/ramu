// The phone transport (apps/mobile HostClient) against two standalone servers with simulated providers: pairing,
// authenticated event streams, host isolation, agent requests, git, terminals and revocation. No Electron.
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { HostClient } from '../../apps/mobile/src/runtime/transport.ts'
import { createRepo, startServer, until } from '../support/index.mjs'

const dir = mkdtempSync(join(tmpdir(), 'ramu-e2e-mobile-'))
const clients = []
const streams = []

/** Starts a server with a repository, pairs a phone client with an open event stream, and creates a task on it. */
async function startHost(name) {
  const repo = createRepo(join(dir, name, 'repo'), { 'hello.txt': 'initial\n' })
  const server = await startServer({ name, dir, listen: true, env: { RAMU_BROWSE_ROOTS: join(dir, name) } })
  const paired = await server.pair('Phone integration')
  assert.ok(paired.token)
  const phone = new HostClient(server.url, paired.token, fetch)
  const controller = new AbortController()
  const events = []
  let ready = false
  clients.push({ phone, controller })
  streams.push(
    phone
      .stream(
        (channel, payload) => events.push({ channel, payload }),
        async () => {
          ready = true
        },
        controller.signal,
      )
      .catch((error) => {
        if (!controller.signal.aborted) server.streamError = error
      }),
  )
  await until(() => ready, `${name} event stream never became ready`)
  const { project } = await phone.invoke('folders.addProject', repo)
  const task = await phone.invoke('tasks.create', {
    projectId: project.id,
    title: `${name} phone chat`,
    mode: 'current',
  })
  await phone.invoke('tasks.setup', task.id)
  const [binding] = await phone.invoke('tasks.bindings', task.id)
  return { server, phone, events, repo, deviceId: paired.deviceId, task, binding }
}

// Top level, not a `before` hook: `startServer` registers its cleanup on the file, which a hook would end too early.
const [one, two] = await Promise.all([startHost('one'), startHost('two')])

after(async () => {
  for (const { phone, controller } of clients) {
    controller.abort()
    phone.close()
  }
  await Promise.allSettled(streams)
  rmSync(dir, { recursive: true, force: true })
})

test('two independent paired hosts hydrate over authenticated SSE', async () => {
  assert.notEqual(one.task.id, two.task.id)
  for (const host of [one, two]) assert.equal((await host.phone.invoke('tasks.list')).length, 1)
  assert.equal((await one.phone.invoke('background.status')).pid, one.server.child.pid)
  assert.equal((await two.phone.invoke('background.status')).pid, two.server.child.pid)
})

test('a phone cannot reach host-only methods or crawl other computers', async () => {
  for (const { phone } of [one, two]) {
    await assert.rejects(phone.invoke('computers.list'), /Unknown method/)
    await assert.rejects(phone.invoke('network.pair'), /managed from the computer/)
    await assert.rejects(phone.invoke('host.reply', 'forged', null), /only available on this computer/)
  }
})

test('the phone answers permissions and ID-based questions, with revisioned snapshots and isolated hosts', async () => {
  const session = await one.phone.invoke('agent.start', one.task.id, 'Phone fixture [questions wait]', {
    provider: 'claude-code',
    model: '',
    effort: null,
    access: 'edits',
    autoFallback: false,
  })
  const event = (kind) =>
    one.events.findLast(
      (e) => e.channel === 'agent:event' && e.payload.sessionId === session.id && e.payload.event.kind === kind,
    )?.payload.event
  await until(() => event('permission-request'), 'permission request never arrived')
  await one.phone.invoke('agent.replyPermission', session.id, event('permission-request').requestId, true)
  await until(() => event('question'), 'question never arrived')
  const question = event('question')
  const answers = Object.fromEntries(question.questions.map((q) => [q.id ?? q.question, q.options[0].label]))
  await one.phone.invoke('agent.replyQuestion', session.id, question.requestId, answers)
  await until(() => event('request-resolved')?.requestId === question.requestId, 'question never resolved')
  const snapshot = await one.phone.invoke('agent.snapshot', session.id)
  assert.ok(snapshot.revision > 0)
  assert.ok(snapshot.events.every((row) => Number.isInteger(row.seq)))
  assert.ok(
    snapshot.events.some(
      (row) => row.event.kind === 'question-state' && Object.keys(row.event.answers ?? {}).length === 2,
    ),
  )
  assert.ok(!two.events.some((e) => e.channel === 'agent:event' && e.payload.sessionId === session.id))
  assert.equal(
    (await two.phone.invoke('tasks.list')).some((t) => t.id === one.task.id),
    false,
    'a task stays on the host that created it',
  )
  await one.phone.invoke('agent.stop', session.id)
})

test('git: stale discard is rejected; stage, diff, commit and undo use the expected host HEAD', async () => {
  const { phone, repo, binding, task } = one
  const file = join(repo, 'hello.txt')
  writeFileSync(file, 'updated from host\n')
  const preview = await phone.invoke('git.discardPreview', task.id, binding.repoId, ['hello.txt'])
  writeFileSync(file, 'concurrent edit\n')
  await assert.rejects(
    phone.invoke('git.discard', task.id, binding.repoId, ['hello.txt'], preview.fingerprint),
    /Files changed/,
  )
  writeFileSync(file, 'updated from host\n')
  await phone.invoke('git.stage', task.id, binding.repoId, ['hello.txt'])
  const diff = await phone.invoke('git.diff', task.id, binding.repoId, 'hello.txt', true)
  assert.equal(diff.modified, 'updated from host\n')
  const commit = await phone.invoke('git.commit', task.id, binding.repoId, 'phone commit')
  assert.equal((await phone.invoke('git.status', task.id, binding.repoId)).oid, commit)
  await phone.invoke('git.undoCommit', task.id, binding.repoId, commit)
})

test('a real PTY takes input and replays a reattachment snapshot', async () => {
  const { phone, binding, task } = one
  const terminal = await phone.invoke('term.open', task.id, binding.repoId, 80, 24)
  await phone.invoke('term.write', terminal.id, "printf '\\nPHONE_TERMINAL_OK\\n'\r")
  await until(
    async () => (await phone.invoke('term.snapshot', terminal.id)).output.includes('\r\nPHONE_TERMINAL_OK\r\n'),
    'terminal output never arrived',
    { attempts: 300 },
  )
  assert.ok((await phone.invoke('term.list', task.id)).some((t) => t.id === terminal.id))
  assert.ok((await phone.invoke('term.snapshot', terminal.id)).cursor > 0)
  await phone.invoke('term.close', terminal.id)
})

test('revoking one phone connection leaves the other host working', async () => {
  assert.equal(one.server.streamError, undefined)
  assert.equal(two.server.streamError, undefined)
  await one.server.invoke('network.revoke', one.deviceId)
  await assert.rejects(one.phone.invoke('tasks.list'), (error) => error.status === 401)
  assert.equal((await two.phone.invoke('tasks.list')).length, 1)
  assert.equal(two.server.streamError, undefined)
})
