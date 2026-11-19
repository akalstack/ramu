import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canEditVerify, outcomeKey, verifyDraft, verifyView, VERIFY_LIMIT } from '../src/runtime/goalVerify.ts'

const goal = (extra = {}) => ({ objective: 'Ship it', status: 'active', reason: '', turns: 1, ...extra })

test('blank and "off" remove the command; anything else is trimmed', () => {
  assert.deepEqual(verifyDraft('  pnpm test  ', undefined), { command: 'pnpm test', changed: true, tooLong: false })
  assert.equal(verifyDraft('', 'pnpm test').command, null)
  assert.equal(verifyDraft('  OFF ', 'pnpm test').command, null)
  assert.equal(verifyDraft('off', 'pnpm test').changed, true)
})
test('an unchanged value saves nothing, including clearing a command that is not set', () => {
  assert.equal(verifyDraft('pnpm test', 'pnpm test').changed, false)
  assert.equal(verifyDraft(' pnpm test ', 'pnpm test').changed, false)
  assert.equal(verifyDraft('', undefined).changed, false)
  assert.equal(verifyDraft('off', undefined).changed, false)
})
test('the host limit is 2000 characters of the trimmed text', () => {
  assert.equal(verifyDraft('x'.repeat(VERIFY_LIMIT), undefined).tooLong, false)
  assert.equal(verifyDraft('x'.repeat(VERIFY_LIMIT + 1), undefined).tooLong, true)
  assert.equal(verifyDraft(` ${'x'.repeat(VERIFY_LIMIT)} `, undefined).tooLong, false)
})
test('only an unfinished goal can be edited', () => {
  assert.equal(canEditVerify(null), false)
  assert.equal(canEditVerify(goal()), true)
  assert.equal(canEditVerify(goal({ status: 'paused' })), true)
  assert.equal(canEditVerify(goal({ status: 'blocked' })), true)
  assert.equal(canEditVerify(goal({ status: 'completed' })), false)
})
test('the view carries the command and the last check, with output only for a failure', () => {
  assert.deepEqual(verifyView(goal()), {})
  assert.equal(verifyView(goal({ verify: 'pnpm test' })).command, 'pnpm test')
  const passed = verifyView(
    goal({
      verify: 'pnpm test',
      check: { ok: true, command: 'pnpm test', code: 0, timedOut: false, output: 'all good', at: 1 },
    }),
  )
  assert.equal(passed.check.ok, true)
  assert.equal(passed.check.tail, '')
  assert.deepEqual(passed.check.outcome, { kind: 'passed' })
  const failed = verifyView(
    goal({
      check: {
        ok: false,
        command: 'pnpm test',
        code: 1,
        timedOut: false,
        output: 'Command exited with code 1.\none\ntwo',
        at: 1,
      },
    }),
  )
  assert.deepEqual(failed.check.outcome, { kind: 'exit', code: 1 })
  assert.equal(failed.check.tail, 'one\ntwo')
})
test('each way a run can end has its own copy key', () => {
  assert.deepEqual(outcomeKey({ kind: 'passed' }), { key: 'verifyPassed' })
  assert.deepEqual(outcomeKey({ kind: 'timed-out' }), { key: 'verifyTimedOut' })
  assert.deepEqual(outcomeKey({ kind: 'unrunnable' }), { key: 'verifyUnrunnable' })
  assert.deepEqual(outcomeKey({ kind: 'exit', code: 2 }), { key: 'verifyExit', code: 2 })
  assert.deepEqual(outcomeKey({ kind: 'failed' }), { key: 'verifyFailedPlain' })
})
