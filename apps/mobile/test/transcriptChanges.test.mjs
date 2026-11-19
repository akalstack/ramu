import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mergeTranscript, transcriptRows, updateThreadMetadata } from '../src/runtime/transcriptChanges.ts'

const text = (value) => ({ kind: 'text', text: value })

test('a reset replaces everything held, including rows that no longer exist', () => {
  const held = new Map([
    [1, text('a')],
    [2, text('b')],
  ])
  const next = mergeTranscript(held, { reset: true, cursor: 3, events: [{ seq: 1, event: text('a2') }] })
  assert.deepEqual([...next.keys()], [1])
  assert.equal(next.get(1).text, 'a2')
})

test('changes add new rows and replace edited ones without touching the rest or the held map', () => {
  const held = new Map([
    [1, text('a')],
    [2, text('draft')],
  ])
  const next = mergeTranscript(held, {
    reset: false,
    cursor: 5,
    events: [
      { seq: 2, event: text('final') },
      { seq: 3, event: text('c') },
    ],
  })
  assert.deepEqual(
    transcriptRows(next).map((row) => [row.seq, row.event.text]),
    [
      [1, 'a'],
      [2, 'final'],
      [3, 'c'],
    ],
  )
  assert.equal(held.get(2).text, 'draft', 'the held rows are not mutated')
})

test('changes with nothing held start from the rows given, and an empty change keeps what is held', () => {
  assert.equal(mergeTranscript(undefined, { reset: false, cursor: 1, events: [{ seq: 1, event: text('a') }] }).size, 1)
  const held = new Map([[1, text('a')]])
  assert.equal(mergeTranscript(held, { reset: false, cursor: 1, events: [] }).size, 1)
})

test('rows come out in sequence order whatever order they arrived in', () => {
  const rows = mergeTranscript(undefined, {
    reset: true,
    cursor: 1,
    events: [
      { seq: 3, event: text('c') },
      { seq: 1, event: text('a') },
    ],
  })
  assert.deepEqual(
    transcriptRows(rows).map((row) => row.seq),
    [1, 3],
  )
})

test('streamed content keeps thread metadata stable while control events update immediately', () => {
  const chat = { status: 'running', preview: 'Previous', queue: [], queuePaused: false }
  for (let token = 0; token < 100; token++) assert.equal(updateThreadMetadata(chat, text('Reply ' + token)), chat)
  assert.equal(chat.preview, 'Previous')
  const waiting = updateThreadMetadata(chat, { kind: 'state', state: 'needs-input' })
  assert.equal(waiting.status, 'needs-input')
  assert.equal(waiting.executionState, 'needs-input')
  const finished = updateThreadMetadata(chat, { kind: 'state', state: 'done' })
  assert.equal(finished.status, 'ready-for-review')
  const queued = updateThreadMetadata(chat, { kind: 'queue', messages: [{ id: 'next' }], paused: true })
  assert.equal(queued.queue[0].id, 'next')
  assert.equal(queued.queuePaused, true)
})

test('startup and work labels follow execution changes immediately without publishing each token', () => {
  const chat = { status: 'idle', activityLabel: null }
  const starting = updateThreadMetadata(chat, { kind: 'state', state: 'starting' })
  assert.equal(starting.activityLabel, 'Starting…')
  const working = updateThreadMetadata(starting, { kind: 'state', state: 'running' })
  assert.equal(working.activityLabel, 'Working')
  const writing = { ...working, activityLabel: 'Writing…' }
  assert.equal(updateThreadMetadata(writing, text('More words')), writing)
  assert.equal(updateThreadMetadata(writing, { kind: 'state', state: 'done' }).activityLabel, null)
})

test('pausing between the transcript read and companion reads cannot advance the resume cursor', async () => {
  const { readTranscriptBundle } = await import('../src/runtime/transcriptChanges.ts')
  let connected = true
  let finish
  const bindings = new Promise((resolve) => {
    finish = resolve
  })
  const cache = { cursor: 1, rows: new Map([[1, text('Earlier')]]) }
  const read = readTranscriptBundle(
    [
      Promise.resolve({ cursor: 2, events: [{ seq: 1, event: text('Completed while away') }] }),
      bindings,
      Promise.resolve(null),
    ],
    () => connected,
    (snapshot) => {
      cache.rows = new Map(snapshot.events.map(({ seq, event }) => [seq, event]))
      cache.cursor = snapshot.cursor
    },
  )
  await Promise.resolve()
  assert.equal(cache.cursor, 1)
  connected = false
  finish([])
  assert.equal(await read, null)
  assert.equal(cache.cursor, 1)
  assert.equal(cache.rows.get(1).text, 'Earlier')
  connected = true
  await readTranscriptBundle(
    [
      Promise.resolve({ cursor: 2, events: [{ seq: 1, event: text('Completed while away') }] }),
      Promise.resolve([]),
      Promise.resolve(null),
    ],
    () => connected,
    (snapshot) => {
      cache.rows = new Map(snapshot.events.map(({ seq, event }) => [seq, event]))
      cache.cursor = snapshot.cursor
    },
  )
  assert.equal(cache.cursor, 2)
  assert.equal(cache.rows.get(1).text, 'Completed while away')
})

test('a failed companion read leaves both the transcript and resume cursor uncommitted', async () => {
  const { readTranscriptBundle } = await import('../src/runtime/transcriptChanges.ts')
  let committed = false
  await assert.rejects(
    readTranscriptBundle(
      [Promise.resolve({ cursor: 20, events: [] }), Promise.reject(new Error('Paused')), Promise.resolve(null)],
      () => true,
      () => {
        committed = true
      },
    ),
    /Paused/,
  )
  assert.equal(committed, false)
})
