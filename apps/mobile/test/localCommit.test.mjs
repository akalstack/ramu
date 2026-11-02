import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readLocalCommit, writeLocalCommit } from '../src/storage/localCommit.ts'

const memory = () => {
  const slots = [null, null]
  return {
    slots,
    read: (slot) => slots[slot],
    write: (slot, value) => {
      slots[slot] = value
    },
  }
}
test('commits the saved library and active draft together, preserving a previous complete profile', () => {
  const storage = memory()
  assert.equal(readLocalCommit(storage), null)
  const active = { drafts: { text: 'work', saved: [] }, outbox: [] }
  const saved = { drafts: { text: '', saved: [{ text: 'work' }] }, outbox: [] }
  writeLocalCommit(storage, active)
  writeLocalCommit(storage, saved)
  assert.deepEqual(readLocalCommit(storage), saved)
  assert.deepEqual(JSON.parse(storage.slots[0]).data, active)
  assert.deepEqual(JSON.parse(storage.slots[1]).data, saved)
})
test('recovers the latest complete slot after an interrupted write without discarding saved work', () => {
  const storage = memory()
  writeLocalCommit(storage, { drafts: { saved: ['important work'] } })
  const broken = {
    ...storage,
    write: (slot, value) => {
      storage.slots[slot] = value.slice(0, -5)
    },
  }
  assert.throws(() => writeLocalCommit(broken, { drafts: { saved: [] } }), /finish saving/)
  assert.deepEqual(readLocalCommit(storage), { drafts: { saved: ['important work'] } })
  writeLocalCommit(storage, { drafts: { saved: ['important work'], active: 'urgent' } })
  assert.equal(readLocalCommit(storage).drafts.active, 'urgent')
})
test('storage denial keeps the last committed source and lets the caller keep its current composer', () => {
  const storage = memory()
  writeLocalCommit(storage, { drafts: { active: 'original' } })
  assert.throws(
    () =>
      writeLocalCommit(
        {
          ...storage,
          write: () => {
            throw new Error('quota')
          },
        },
        { drafts: {} },
      ),
    /quota/,
  )
  assert.deepEqual(readLocalCommit(storage), { drafts: { active: 'original' } })
})
test('unknown versions or irrecoverably corrupt data block writes rather than resetting the library', () => {
  const storage = memory()
  storage.slots[0] = '{broken'
  assert.throws(() => readLocalCommit(storage), /kept for recovery/)
  assert.throws(() => writeLocalCommit(storage, {}), /kept for recovery/)
  assert.equal(storage.slots[0], '{broken')
  storage.slots[0] = JSON.stringify({ version: 2, revision: 10, data: { saved: 'future' } })
  assert.throws(() => writeLocalCommit(storage, {}), /newer Ramu/)
  assert.equal(JSON.parse(storage.slots[0]).version, 2)
})

test('an interrupted first migration can retry while the original legacy profile remains intact', () => {
  const storage = memory()
  storage.slots[0] = '{interrupted first write'
  const legacy = { drafts: { active: 'Legacy text and sidecars' } }
  writeLocalCommit(storage, legacy, true)
  assert.deepEqual(readLocalCommit(storage), legacy)
  storage.slots[1] = JSON.stringify({ version: 2, revision: 5, data: {} })
  assert.throws(() => writeLocalCommit(storage, legacy, true), /newer Ramu/)
})

test('async commits wait for the native write before verification and preserve the recovery slot on failure', async () => {
  const { writeLocalCommitAsync } = await import('../src/storage/localCommit.ts')
  const storage = memory()
  writeLocalCommit(storage, { drafts: { active: 'original' } })
  let complete
  const asyncStorage = {
    read: async (slot) => storage.read(slot),
    write: (slot, value) =>
      new Promise((resolve) => {
        complete = () => {
          storage.write(slot, value)
          resolve()
        }
      }),
  }
  const pending = writeLocalCommitAsync(asyncStorage, { drafts: { active: 'new' } })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(readLocalCommit(storage).drafts.active, 'original')
  complete()
  await pending
  assert.equal(readLocalCommit(storage).drafts.active, 'new')
  await assert.rejects(
    writeLocalCommitAsync(
      {
        ...asyncStorage,
        write: async () => {
          throw Error('disk full')
        },
      },
      { drafts: {} },
    ),
    /disk full/,
  )
  assert.equal(readLocalCommit(storage).drafts.active, 'new')
})
