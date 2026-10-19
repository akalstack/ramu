import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  hostHasAutoResume,
  autoResumeMenu,
  limitPlaceholderKey,
  limitTrayModel,
  limitWaitOf,
} from '../src/runtime/limitTray.ts'
import { limitNoteTitle, transcript } from '../src/runtime/transcript.ts'

const NOW = 1_000_000
const future = { retryAt: NOW + 3_600_000, guessed: false }
const guessed = { retryAt: NOW + 300_000, guessed: true }
const past = { retryAt: NOW - 1_000, guessed: false }
const model = (wait, settings, fallback, options = {}) =>
  limitTrayModel(wait, settings, fallback, { now: NOW, ...options })

test('the tray words every row of the plan table', () => {
  assert.deepEqual(
    [
      model(future, {}, { autoResume: true }),
      model(guessed, {}, { autoResume: true }),
      model(future, {}, { autoResume: false }),
      model(guessed, {}, { autoResume: false }),
      model(past, {}, { autoResume: false }),
    ].map((row) => [row.case, row.title, row.detail, row.action, row.primary]),
    [
      ['auto-known', 'limitReached', 'limitAutoKnown', 'try-anyway', false],
      ['auto-unknown', 'limitReached', 'limitAutoUnknown', 'try-again', true],
      ['off-known', 'limitReached', 'limitOffKnownDefault', 'try-anyway', false],
      ['off-unknown', 'limitReached', 'limitOffUnknownDefault', 'try-again', true],
      ['reset-off', 'limitHasReset', 'limitResetOff', 'resume', true],
    ],
  )
})

test('the off text says for this thread when the thread has its own choice and in Settings when it follows the default', () => {
  assert.equal(model(future, { autoResume: false }, { autoResume: true }).detail, 'limitOffKnownThread')
  assert.equal(model(guessed, { autoResume: false }, { autoResume: true }).detail, 'limitOffUnknownThread')
  assert.equal(model(future, {}, { autoResume: false }).detail, 'limitOffKnownDefault')
})

test('a thread override wins over the host default, and a missing default counts as on', () => {
  assert.equal(model(future, { autoResume: true }, { autoResume: false }).autoResume.value, true)
  assert.equal(model(future, {}, undefined).autoResume.value, true)
  assert.equal(model(future, {}, {}).autoResumeLabel, 'On (default)')
  assert.equal(model(future, { autoResume: false }, {}).autoResumeLabel, 'Off')
})

test('after a try that did not get through the title is Still limited and the buttons stay those of the case', () => {
  const row = model(future, {}, { autoResume: true }, { stillLimited: true })
  assert.equal(row.title, 'limitStill')
  assert.equal(row.detail, 'limitStillKnown')
  assert.equal(row.action, 'try-anyway')
  assert.equal(model(guessed, {}, { autoResume: true }, { stillLimited: true }).detail, 'limitStillUnknown')
})

test('the per-thread control lists Use default with the default named, On and Off, and marks the current one', () => {
  assert.deepEqual(
    autoResumeMenu({}, { autoResume: false }).map((item) => [item.label, item.selected]),
    [
      ['Use default (off)', true],
      ['On', false],
      ['Off', false],
    ],
  )
  assert.deepEqual(
    autoResumeMenu({ autoResume: true }, { autoResume: true }).map((item) => [item.label, item.selected]),
    [
      ['Use default (on)', false],
      ['On', true],
      ['Off', false],
    ],
  )
})

test('the composer placeholder follows auto-resume and whether the reset is known', () => {
  assert.equal(limitPlaceholderKey(model(future, {}, { autoResume: true })), 'limitPlaceholderAtReset')
  assert.equal(limitPlaceholderKey(model(guessed, {}, { autoResume: true })), 'limitPlaceholderClears')
  assert.equal(limitPlaceholderKey(model(future, {}, { autoResume: false })), 'limitPlaceholderManual')
  assert.equal(limitPlaceholderKey(model(guessed, {}, { autoResume: false })), 'limitPlaceholderManual')
})

const limited = (extra = {}) => [
  { kind: 'user', text: 'go', at: 1 },
  { kind: 'provider-wait', retryAt: NOW + 3_600_000, updatedAt: 2, ...extra },
]

test('a thread at a limit reads Limit reached, with the reset time only when it is a real one', () => {
  const wait = (events) => transcript(events).find((item) => item.kind === 'note' && item.wait)
  assert.match(wait(limited()).title, /^Limit reached · resumes around /)
  assert.equal(wait(limited({ guessed: true })).title, 'Limit reached · resuming automatically')
  assert.deepEqual(wait(limited({ guessed: true, provider: 'codex' })).limit, {
    retryAt: NOW + 3_600_000,
    guessed: true,
    provider: 'codex',
  })
  assert.equal(limitNoteTitle({ retryAt: NOW, guessed: true }), 'Limit reached · resuming automatically')
})

test('the limit ends when the wait is cleared or the thread moves on', () => {
  const wait = (events) => limitWaitOf(transcript(events))
  assert.ok(wait(limited()))
  assert.equal(wait([...limited(), { kind: 'provider-wait', retryAt: null, updatedAt: 3 }]), null)
  assert.equal(wait([...limited(), { kind: 'text', text: 'back', at: 5 }]), null)
})

test('Limit reached and Paused are separate: a paused goal keeps its own words', () => {
  const goal = (status) => ({ kind: 'goal', goal: { objective: 'ship it', status, turns: 1, retryAt: null }, at: 2 })
  const items = transcript([
    { kind: 'user', text: 'go', at: 1 },
    goal('active'),
    goal('paused'),
    { kind: 'provider-wait', retryAt: NOW + 3_600_000, updatedAt: 3 },
  ])
  const titles = items.filter((item) => item.kind === 'note').map((item) => item.title)
  assert.ok(titles.some((title) => title.startsWith('Limit reached')))
  assert.ok(!titles.some((title) => title.startsWith('Limit reached') && /paused/i.test(title)))
  assert.ok(titles.some((title) => /paused/i.test(title) && !title.startsWith('Limit reached')))
})

test('per-thread auto-resume is offered only by a host that knows the setting', () => {
  assert.equal(hostHasAutoResume({ switchAt: null, autoResume: true }), true)
  assert.equal(hostHasAutoResume({ switchAt: null, autoResume: false }), true)
  // An older host has no such preference, and refuses agent.setAutoResume.
  assert.equal(hostHasAutoResume({ switchAt: null }), false)
  assert.equal(hostHasAutoResume(undefined), false)
})
