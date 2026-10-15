import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventParser, HostClient, HostError, normalizeAddress, needsHttpConsent } from '../src/runtime/transport.ts'
import { transcript } from '../src/runtime/transcript.ts'
import { decodePairQr, encodePairQr } from '@ramu/contracts'

test('addresses default to HTTPS and require explicit trusted HTTP, rejecting dropped paths and credentials', () => {
  assert.equal(normalizeAddress('my-host.local:7421'), 'https://my-host.local:7421')
  assert.throws(() => normalizeAddress('http://host:7421'), /Allow HTTP/)
  assert.equal(normalizeAddress('http://host:7421', true), 'http://host:7421')
  for (const url of ['https://user:secret@host', 'https://host/proxy', 'https://host/?token=x', 'ftp://host'])
    assert.throws(() => normalizeAddress(url, true))
})
test('SSE decodes comments, CRLF and every possible chunk boundary without duplicate events', () => {
  const wire =
    ': connected\r\n\r\ndata: {"channel":"agent:event",\r\ndata: "payload":{"sessionId":"one","event":{"kind":"text","text":"你好 🌙"}}}\r\n\r\n'
  for (let split = 1; split < wire.length; split++) {
    const values = []
    const parser = new EventParser((channel, payload) => values.push({ channel, payload }))
    parser.push(wire.slice(0, split))
    parser.push(wire.slice(split))
    assert.equal(values.length, 1)
    assert.equal(values[0].payload.event.text, '你好 🌙')
  }
})
test('invoke preserves optional argument positions, bearer token stays in headers', async () => {
  let request
  const client = new HostClient('https://host', 'device-secret', async (url, options) => {
    request = { url, options }
    return new Response('{"value":true}')
  })
  assert.equal(await client.invoke('git.commit', 'task', 'repo', 'message', undefined, 'head'), true)
  assert.equal(request.url, 'https://host/invoke')
  assert.equal(request.options.headers.Authorization, 'Bearer device-secret')
  assert.match(request.options.body, /\$ramuUndefined/)
  assert.ok(!request.options.body.includes('device-secret'))
})
test('authentication errors and ambiguous submissions are distinct; neither retries a mutation', async () => {
  let calls = 0
  const client = new HostClient('https://host', 'token', async () => {
    calls++
    throw new Error('offline')
  })
  await assert.rejects(
    client.invoke('agent.send', 'session', 'hello'),
    (error) => error instanceof HostError && error.ambiguous,
  )
  assert.equal(calls, 1)
  const revoked = new HostClient('https://host', 'token', async () => new Response('', { status: 401 }))
  await assert.rejects(revoked.invoke('tasks.list'), (error) => error.status === 401 && !error.ambiguous)
})
test('stream reads while hydration is pending and aborts cleanly', async () => {
  let finish
  let read = false
  const hydration = new Promise((resolve) => {
    finish = resolve
  })
  const controller = new AbortController()
  const client = new HostClient(
    'https://host',
    'token',
    async () =>
      new Response(
        new ReadableStream({
          start(stream) {
            stream.enqueue(new TextEncoder().encode('data: {"channel":"usage:changed","payload":[]}\n\n'))
            stream.close()
          },
        }),
      ),
  )
  const running = client.stream(
    () => {
      read = true
      controller.abort()
      finish()
    },
    () => hydration,
    controller.signal,
  )
  await running
  assert.equal(read, true)
})
test('QR offers contain expiring one-time codes, reject tokens, unknown schemes and expired offers', () => {
  const offer = { url: 'https://host:7421', code: 'ABCDE-FGHJK', expiresAt: 2000 }
  assert.equal(decodePairQr(encodePairQr(offer), 1000).url, offer.url)
  assert.throws(() => decodePairQr(encodePairQr(offer), 3000), /expired/)
  assert.throws(() => decodePairQr(encodePairQr({ ...offer, url: 'https://host/proxy' }), 1000))
  assert.throws(() => decodePairQr('{"token":"secret"}', 1000))
})
test('transcript restores tool outcomes, resolved questions and permissions without asking twice', () => {
  const items = transcript([
    { kind: 'user', text: 'hello' },
    { kind: 'text', text: 'working' },
    { kind: 'tool-use', toolUseId: 'tool', name: 'Read', summary: 'a.ts', toolKind: 'read' },
    { kind: 'tool-result', toolUseId: 'tool', isError: false, summary: 'done' },
    { kind: 'question', requestId: 'question', questions: [] },
    { kind: 'question-state', requestId: 'question', answers: { choice: 'yes' } },
    { kind: 'request-resolved', requestId: 'question', outcome: 'answered' },
    { kind: 'permission-request', requestId: 'permission', title: 'Run?', detail: 'command', toolName: 'Bash' },
    { kind: 'request-resolved', requestId: 'permission', outcome: 'allowed' },
  ])
  assert.equal(items.find((i) => i.kind === 'tool').status, 'completed')
  assert.deepEqual(items.find((i) => i.kind === 'question').answers, { choice: 'yes' })
  assert.equal(items.find((i) => i.kind === 'permission').decision, 'allow')
})

test('loopback HTTP addresses do not require a warning or consent, private LAN HTTP still does', () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
    assert.equal(needsHttpConsent(`http://${host}:7421`), false)
    assert.ok(normalizeAddress(`http://${host}:7421`).startsWith('http:'))
  }
  assert.equal(needsHttpConsent('http://192.168.1.10:7421'), true)
  assert.equal(needsHttpConsent('https://host.example'), false)
})
