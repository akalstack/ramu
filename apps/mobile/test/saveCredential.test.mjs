import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CREDENTIAL_NOT_SAVED, saveIssuedCredential } from '../src/runtime/saveCredential.ts'

test('retries a busy keychain and stores the credential without bothering the person', async () => {
  let calls = 0
  const waits = []
  await saveIssuedCredential(
    async () => {
      if (++calls < 3) throw new Error('keychain busy')
    },
    async (ms) => void waits.push(ms),
  )
  assert.equal(calls, 3)
  assert.deepEqual(waits, [300, 600])
})

test('says what was left on the host when the credential cannot be stored at all', async () => {
  let calls = 0
  await assert.rejects(
    saveIssuedCredential(
      async () => {
        calls++
        throw new Error('locked')
      },
      async () => {},
    ),
    { message: CREDENTIAL_NOT_SAVED },
  )
  assert.equal(calls, 3)
  assert.match(CREDENTIAL_NOT_SAVED, /remove this phone under Devices/)
})
