// Exercises the actual phone transport against two isolated servers with simulated providers.
// Run after pnpm --filter @ramu/server build; no paid model calls or personal profiles.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { request, createServer } from 'node:http'
import { HostClient } from '../apps/mobile/src/runtime/transport.ts'
const root = resolve(import.meta.dirname, '..'), directory = mkdtempSync(join(tmpdir(), 'ramu-mobile-'))
const hosts = [], streams = []
const until = async (condition, timeout = 15000) => { const end = Date.now() + timeout; while (!await condition()) { if (Date.now() > end) throw new Error('Timed out waiting for phone fixture'); await new Promise(r => setTimeout(r, 50)) } }
const local = (socketPath, method, ...args) => new Promise((accept, reject) => { const req = request({ socketPath, path: '/invoke', method: 'POST' }, res => { let text = ''; res.on('data', d => text += d); res.on('end', () => { try { const result = JSON.parse(text); result.error ? reject(new Error(result.error)) : accept(result.value) } catch(e) { reject(e) } }) }); req.on('error', reject); req.end(JSON.stringify({ method, args })) })
const availablePort = async () => { const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const port = server.address().port; await new Promise(r => server.close(r)); return port }
async function start(name) {
  const profile = join(directory, name), socket = join(directory, `${name}.sock`), repo = join(profile, 'repo'); mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', repo]); execFileSync('git', ['-C', repo, 'config', 'user.name', 'Phone Test']); execFileSync('git', ['-C', repo, 'config', 'user.email', 'phone@example.test'])
  writeFileSync(join(repo, 'hello.txt'), 'initial\n'); execFileSync('git', ['-C', repo, 'add', '.']); execFileSync('git', ['-C', repo, 'commit', '-qm', 'initial'])
  const port = await availablePort()
  const process = spawn(globalThis.process.execPath, [join(root, 'apps/server/dist/cli.js'), 'serve', '--data-dir', profile, '--listen', String(port)], { env: { ...globalThis.process.env, RAMU_SOCKET: socket, RAMU_WORKTREES: join(profile, 'worktrees'), RAMU_BROWSE_ROOTS: profile, RAMU_FAKE_AGENT: '1' }, stdio: 'ignore' })
  const host = { process, socket, address: `http://127.0.0.1:${port}`, repo }; hosts.push(host)
  await until(() => local(socket, 'background.status').then(() => true, () => false))
  const offer = await local(socket, 'network.pair')
  const response = await fetch(host.address + '/pair', { method: 'POST', body: JSON.stringify({ code: offer.code, name: 'Phone integration' }) })
  const paired = await response.json(); assert.ok(paired.token)
  host.deviceId = paired.deviceId; host.client = new HostClient(host.address, paired.token, fetch); host.events = []
  const controller = new AbortController(); host.controller = controller
  let ready = false
  const stream = host.client.stream((channel, payload) => host.events.push({ channel, payload }), async () => { ready = true }, controller.signal).catch(e => { if (!controller.signal.aborted) host.streamError = e })
  streams.push(stream); await until(() => ready)
  const project = await host.client.invoke('folders.addProject', repo)
  const task = await host.client.invoke('tasks.create', { projectId: project.project.id, title: `${name} phone chat`, mode: 'current' })
  await host.client.invoke('tasks.setup', task.id)
  host.task = task; host.binding = (await host.client.invoke('tasks.bindings', task.id))[0]
  return host
}
try {
  const [one, two] = await Promise.all([start('one'), start('two')])
  assert.notEqual(one.task.id, two.task.id)
  for (const host of [one, two]) assert.equal((await host.client.invoke('tasks.list')).length, 1)
  console.log('ok - two independent paired hosts hydrate over authenticated SSE')
  const session = await one.client.invoke('agent.start', one.task.id, 'Phone fixture [questions wait]', { provider: 'claude-code', model: '', effort: null, access: 'auto', autoFallback: false })
  const event = kind => one.events.findLast(e => e.channel === 'agent:event' && e.payload.sessionId === session.id && e.payload.event.kind === kind)?.payload.event
  await until(() => event('permission-request'))
  await one.client.invoke('agent.replyPermission', session.id, event('permission-request').requestId, true)
  await until(() => event('question'))
  const question = event('question')
  const answers = Object.fromEntries(question.questions.map(q => [q.id ?? q.question, q.options[0].label]))
  await one.client.invoke('agent.replyQuestion', session.id, question.requestId, answers)
  await until(() => event('request-resolved')?.requestId === question.requestId)
  const snapshot = await one.client.invoke('agent.snapshot', session.id)
  assert.ok(snapshot.revision > 0); assert.ok(snapshot.events.every(row => Number.isInteger(row.seq)))
  assert.ok(snapshot.events.some(row => row.event.kind === 'question-state' && Object.keys(row.event.answers ?? {}).length === 2))
  assert.ok(!two.events.some(e => e.channel === 'agent:event' && e.payload.sessionId === session.id))
  console.log('ok - phone answers host permissions and ID-based questions; snapshots have revisions; hosts remain isolated')
  writeFileSync(join(one.repo, 'hello.txt'), 'updated from host\n')
  const { repoId } = one.binding, taskId = one.task.id
  const preview = await one.client.invoke('git.discardPreview', taskId, repoId, ['hello.txt'])
  writeFileSync(join(one.repo, 'hello.txt'), 'concurrent edit\n')
  await assert.rejects(one.client.invoke('git.discard', taskId, repoId, ['hello.txt'], preview.fingerprint), /Files changed/)
  writeFileSync(join(one.repo, 'hello.txt'), 'updated from host\n')
  await one.client.invoke('git.stage', taskId, repoId, ['hello.txt'])
  const diff = await one.client.invoke('git.diff', taskId, repoId, 'hello.txt', true); assert.equal(diff.modified, 'updated from host\n')
  const commit = await one.client.invoke('git.commit', taskId, repoId, 'phone commit')
  assert.equal((await one.client.invoke('git.status', taskId, repoId)).oid, commit)
  await one.client.invoke('git.undoCommit', taskId, repoId, commit)
  console.log('ok - phone rejects stale discard, stages, reads diffs, commits and undoes the expected host HEAD')
  const terminal = await one.client.invoke('term.open', taskId, repoId, 80, 24)
  await one.client.invoke('term.write', terminal.id, "printf '\\nPHONE_TERMINAL_OK\\n'\r")
  await until(async () => (await one.client.invoke('term.snapshot', terminal.id)).output.includes('\r\nPHONE_TERMINAL_OK\r\n'))
  assert.ok((await one.client.invoke('term.list', taskId)).some(t => t.id === terminal.id))
  const output = await one.client.invoke('term.snapshot', terminal.id); assert.ok(output.cursor > 0)
  await one.client.invoke('term.close', terminal.id)
  console.log('ok - real PTY input/output and reattachment snapshot work through the phone protocol')
  await local(one.socket, 'network.revoke', one.deviceId)
  await assert.rejects(one.client.invoke('tasks.list'), error => error.status === 401)
  assert.equal((await two.client.invoke('tasks.list')).length, 1)
  console.log('ok - revoking one phone connection leaves the other host working')
} finally {
  for (const host of hosts) { host.controller?.abort(); host.client?.close(); host.process.kill('SIGTERM') }
  await Promise.allSettled(streams)
  await Promise.all(hosts.map(host => host.process.exitCode != null ? Promise.resolve() : new Promise(r => host.process.once('exit', r))))
  rmSync(directory, { recursive: true, force: true })
}
