import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAddress, needsHttpConsent } from '../src/runtime/transport.ts'
import { transcript } from '../src/runtime/transcript.ts'

test('addresses default to HTTPS and require explicit trusted HTTP, rejecting dropped paths and credentials', () => {
  assert.equal(normalizeAddress('my-host.local:7421'), 'https://my-host.local:7421')
  assert.throws(() => normalizeAddress('http://host:7421'), /Allow HTTP/)
  assert.equal(normalizeAddress('http://host:7421', true), 'http://host:7421')
  for (const url of ['https://user:secret@host', 'https://host/proxy', 'https://host/?token=x', 'ftp://host'])
    assert.throws(() => normalizeAddress(url, true))
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

test('a theme an agent drafts becomes a transcript item the phone can preview', () => {
  const theme = { schema: 1, id: 'dusk', name: 'Dusk', light: {}, dark: {} }
  const items = transcript([
    { kind: 'user', text: 'make it calmer' },
    { kind: 'theme', theme },
  ])
  const found = items.find((item) => item.kind === 'theme')
  assert.equal(found.theme.name, 'Dusk')
})

test('loopback HTTP addresses do not require a warning or consent, private LAN HTTP still does', () => {
  for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]']) {
    assert.equal(needsHttpConsent(`http://${host}:7421`), false)
    assert.ok(normalizeAddress(`http://${host}:7421`).startsWith('http:'))
  }
  assert.equal(needsHttpConsent('http://192.168.1.10:7421'), true)
  assert.equal(needsHttpConsent('https://host.example'), false)
})

test('mobile question history merges independent replies and keeps original options and typed answers', () => {
  const questions = [
    {
      id: 'target',
      question: 'Where?',
      options: [
        { label: 'Story', description: 'Use a story' },
        { label: 'Epic', description: 'Use an epic' },
      ],
    },
    { id: 'details', question: 'Details?', options: [] },
  ]
  const events = [
    { kind: 'question', requestId: 'q', questions, grouping: 'independent', responseMode: 'message' },
    { kind: 'question-state', requestId: 'q', answers: { target: 'Story' } },
    { kind: 'question-state', requestId: 'q', answers: { details: 'My own answer' } },
    { kind: 'request-resolved', requestId: 'q', outcome: 'answered' },
  ]
  const question = transcript(events).find((item) => item.kind === 'question')
  assert.deepEqual(question.answers, { target: 'Story', details: 'My own answer' })
  assert.deepEqual(question.questions, questions)
  assert.equal(question.outcome, 'answered')
})

test('mobile closed questions display a close reason without treating it as an answer', () => {
  const question = transcript([
    { kind: 'question', requestId: 'q', questions: [{ question: 'Where?', options: [] }] },
    { kind: 'question-state', requestId: 'q', reason: 'Work no longer needs it.' },
    { kind: 'request-resolved', requestId: 'q', outcome: 'obsolete' },
  ])[0]
  assert.deepEqual(question.answers, {})
  assert.equal(question.reason, 'Work no longer needs it.')
  assert.equal(question.outcome, 'obsolete')
})

test('mobile keeps a tool call input distinct from its output, including while output is pending', () => {
  const call = {
    kind: 'tool-use',
    toolUseId: 'cmd',
    name: 'Bash',
    summary: 'test',
    input: 'pnpm test',
    toolKind: 'execute',
  }
  const pending = transcript([call])[0]
  assert.equal(pending.input, 'pnpm test')
  assert.equal(pending.detail, undefined)
  const complete = transcript([
    call,
    { kind: 'tool-result', toolUseId: 'cmd', summary: 'Tests passed', isError: false },
  ])[0]
  assert.equal(complete.input, 'pnpm test')
  assert.equal(complete.detail, 'Tests passed')
})

test('a human background stop remains visible without becoming a message or completion', () => {
  const items = transcript([{ kind: 'background-terminal-stop', terminalId: 'command-1', command: 'pnpm dev', seq: 3 }])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'note')
  assert.equal(items[0].title, 'You requested a stop for pnpm dev')
  assert.deepEqual(items[0].titleCopy, { text: 'You requested a stop for {0}', values: { 0: 'pnpm dev' } })
})

test('a call with no result stops reading as running once the agent has written after it or the turn ended', () => {
  const call = { kind: 'tool-use', toolUseId: 'c1', name: 'Bash', summary: 'pnpm test' }
  const status = (events) => transcript(events).find((item) => item.kind === 'tool').status
  // Still the newest thing the agent did: running.
  assert.equal(status([call]), 'in_progress')
  // Steering arrives while it runs.
  assert.equal(status([call, { kind: 'user', text: 'also check the lint' }]), 'in_progress')
  // The agent wrote on, or the turn ended: no result is coming.
  assert.equal(status([call, { kind: 'text', text: 'Tests pass.' }]), 'completed')
  assert.equal(status([call, { kind: 'result', text: '', isError: false }]), 'completed')
  // A result that says it is still running keeps the row running, whatever follows.
  const live = { kind: 'tool-result', toolUseId: 'c1', summary: '', isError: false, running: true }
  assert.equal(status([call, live, { kind: 'text', text: 'Started in the background.' }]), 'in_progress')
})
