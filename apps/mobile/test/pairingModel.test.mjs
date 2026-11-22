import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodePairLink, encodePairQr, encodePairWebLink } from '../../../packages/contracts/src/index.ts'
import { pairProblem, pairedName, readScan, showWelcome } from '../src/runtime/pairingModel.ts'

const http = (url) => url.startsWith('http:')
const soon = () => Date.now() + 60_000

test('a scanned code with an encrypted address pairs at once, whichever QR format the computer showed', () => {
  const offer = { url: 'https://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: soon() }
  for (const data of [encodePairWebLink(offer), encodePairLink(offer), encodePairQr(offer)])
    assert.deepEqual(readScan(data, http), { kind: 'pair', offer })
})

test('plain HTTP or a missing code goes to review, and an old or foreign code says why', () => {
  assert.equal(
    readScan(encodePairWebLink({ url: 'http://192.168.1.4:7788', code: 'ABCDE-FGHJK' }), http).kind,
    'review',
  )
  assert.equal(readScan('https://studio.local:7788', http).kind, 'review')
  const old = encodePairWebLink({ url: 'https://studio.local:7788', code: 'ABCDE-FGHJK', expiresAt: Date.now() - 1 })
  assert.deepEqual(readScan(old, http), { kind: 'expired' })
  assert.deepEqual(readScan('WIFI:S:home;T:WPA;P:secret;;', http), { kind: 'invalid' })
})

test('pairing failures read as what to do next, never as a bare status', () => {
  assert.deepEqual(pairProblem(new Error('That pairing code is wrong, already used or expired')), { kind: 'expired' })
  assert.deepEqual(pairProblem(new Error('Too many pairing attempts. Wait a minute.')), { kind: 'too-many' })
  assert.deepEqual(pairProblem(new TypeError('Network request failed')), { kind: 'unreachable' })
  assert.deepEqual(pairProblem(Object.assign(new Error('aborted'), { name: 'AbortError' })), { kind: 'unreachable' })
  assert.deepEqual(pairProblem(new Error('Pairing failed (403)')), { kind: 'other' })
  assert.deepEqual(pairProblem(new Error('Could not save the credential')), {
    kind: 'other',
    detail: 'Could not save the credential',
  })
})

test('the welcome screen shows only on a phone with no host that opened on the home list', () => {
  assert.equal(showWelcome({ hosts: 0, dismissed: false, path: '/' }), true)
  assert.equal(showWelcome({ hosts: 1, dismissed: false, path: '/' }), false)
  assert.equal(showWelcome({ hosts: 0, dismissed: true, path: '/' }), false)
  assert.equal(showWelcome({ hosts: 0, dismissed: false, path: '/pair' }), false)
})

test('a new host is named by its link, or by its address until it reports its own name', () => {
  assert.equal(pairedName({ url: 'https://studio.local:7788', name: 'Studio' }), 'Studio')
  assert.equal(pairedName({ url: 'https://studio.local:7788' }), 'studio.local')
})
