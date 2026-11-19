import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  diffMethod,
  filesMethod,
  readRevision,
  revisionFiles,
  revisionLetter,
  revisionParams,
  stashTitle,
} from '../src/runtime/gitRevision.ts'

const oid = 'b'.repeat(40)

test('commits and stashes use their own host methods', () => {
  assert.equal(filesMethod({ oid, stash: false }), 'git.commitFiles')
  assert.equal(diffMethod({ oid, stash: false }), 'git.commitFileDiff')
  assert.equal(filesMethod({ oid, stash: true }), 'git.stashFiles')
  assert.equal(diffMethod({ oid, stash: true }), 'git.stashFileDiff')
})

test('a revision survives the route params and rejects anything that is not an object id', () => {
  assert.deepEqual(readRevision(oid, undefined), { oid, stash: false })
  assert.deepEqual(readRevision(oid, '1'), { oid, stash: true })
  assert.deepEqual(readRevision(revisionParams({ oid, stash: true }).oid, revisionParams({ oid, stash: true }).stash), {
    oid,
    stash: true,
  })
  assert.equal(readRevision('HEAD', undefined), undefined)
  assert.equal(readRevision(undefined, '1'), undefined)
})

test('status letters get a tone, with modified as the default', () => {
  assert.deepEqual(revisionLetter('A'), { letter: 'A', tone: 'ok' })
  assert.deepEqual(revisionLetter('D'), { letter: 'D', tone: 'bad' })
  assert.deepEqual(revisionLetter('R100'), { letter: 'R', tone: 'warn' })
  assert.deepEqual(revisionLetter(''), { letter: 'M', tone: 'warn' })
})

test('files list by folder then name with the folder split off', () => {
  const rows = revisionFiles([
    { path: 'src/b.ts', status: 'M' },
    { path: 'README.md', status: 'M' },
    { path: 'src/a.ts', status: 'A' },
    { path: 'src/new.ts', origPath: 'src/old.ts', status: 'R' },
  ])
  assert.deepEqual(
    rows.map((row) => [row.dir, row.name]),
    [
      ['', 'README.md'],
      ['src/', 'a.ts'],
      ['src/', 'b.ts'],
      ['src/', 'new.ts'],
    ],
  )
  assert.equal(rows[3].origPath, 'src/old.ts')
})

test('a stash title drops the branch git prefixes it with', () => {
  assert.equal(stashTitle('On main: save progress'), 'save progress')
  assert.equal(stashTitle('WIP on feature/x: abc123 message'), 'abc123 message')
  assert.equal(stashTitle('custom'), 'custom')
})
