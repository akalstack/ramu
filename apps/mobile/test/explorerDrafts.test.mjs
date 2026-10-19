import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addExplorerFile, newComposerKey, consumeComposerDraft } from '../src/runtime/composerDrafts.ts'

const state = () => ({
  computers: [
    { id: 'a', status: 'online' },
    { id: 'b', status: 'online' },
  ],
  projects: [
    { id: 'a:p', computerId: 'a' },
    { id: 'b:p', computerId: 'b' },
  ],
  chats: [
    { id: 'a:chat', taskId: 'task', computerId: 'a', projectId: 'a:p' },
    { id: 'b:chat', taskId: 'task', computerId: 'b', projectId: 'b:p' },
  ],
  drafts: {
    'a:chat:task': '> Quoted context\n\nPlease inspect',
    'a:chat:task:attachments': '[{"id":"image"}]',
    'a:chat:task:mentions': '[{"token":"@old.ts"}]',
    'a:new:a:p': 'Keep my Home draft',
  },
})
const input = { computerId: 'a', contextId: 'task', repoId: 'r', path: 'src/index.ts' }

test('adds one reference to the correct host thread without changing prose, quotes, attachments or mentions', () => {
  const before = state()
  const next = addExplorerFile(before, input)
  assert.deepEqual(next.destination, { kind: 'chat', chatId: 'a:chat' })
  assert.equal(next.key, 'a:chat:task')
  assert.equal(next.drafts[next.key], before.drafts[next.key])
  assert.equal(next.drafts[`${next.key}:attachments`], before.drafts[`${next.key}:attachments`])
  assert.equal(next.drafts[`${next.key}:mentions`], before.drafts[`${next.key}:mentions`])
  assert.equal(
    before.drafts[`${next.key}:context`],
    undefined,
    'input state stays untouched until persistence succeeds',
  )
  const contexts = JSON.parse(next.drafts[`${next.key}:context`])
  assert.deepEqual(contexts, [{ repoId: 'r', path: 'src/index.ts', source: 'mention', referenceOnly: true }])
  const repeated = addExplorerFile({ ...before, drafts: next.drafts }, input)
  assert.equal(JSON.parse(repeated.drafts[`${next.key}:context`]).length, 1)
  assert.equal(addExplorerFile(before, { ...input, computerId: 'b' }).destination.chatId, 'b:chat')
})

test('Home file starts keep another draft intact and freeze the actual existing checkout', () => {
  const before = state()
  const next = addExplorerFile(before, {
    ...input,
    contextId: 'worktree:w',
    catalog: { host: 'a', rows: [{ id: 'w', projectId: 'p', name: 'Payment', createdAt: 1 }] },
  })
  assert.deepEqual(next.destination, { kind: 'new', projectId: 'a:p', draftContext: 'worktree:w' })
  assert.equal(next.drafts['a:new:a:p'], 'Keep my Home draft')
  assert.deepEqual(JSON.parse(next.drafts[`${next.key}:workspace`]), {
    version: 1,
    mode: 'worktree',
    workspaceId: 'w',
    name: 'Payment',
  })
  const current = addExplorerFile(before, { ...input, contextId: 'project:p' })
  assert.deepEqual(JSON.parse(current.drafts[`${current.key}:workspace`]), { version: 1, mode: 'current' })
  assert.notEqual(current.key, next.key)
  assert.notEqual(newComposerKey('a', 'a:p', 'worktree:w'), newComposerKey('b', 'b:p', 'worktree:w'))
})

test('browsing from New returns to its original draft without replacing workspace intent', () => {
  const before = state()
  before.drafts['a:new:a:p:workspace'] = '{"version":1,"mode":null}'
  const next = addExplorerFile(before, { ...input, contextId: 'project:p', composer: { projectId: 'a:p' } })
  assert.equal(next.key, 'a:new:a:p')
  assert.equal(next.drafts[next.key], 'Keep my Home draft')
  assert.equal(next.drafts[`${next.key}:workspace`], before.drafts[`${next.key}:workspace`])
})

test('same-named paths in different repositories remain independent and existing captured selections survive', () => {
  const before = state()
  const existing = {
    repoId: 'other',
    path: input.path,
    source: 'mention',
    selection: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 },
    content: 'Captured quote',
  }
  before.drafts['a:chat:task:context'] = JSON.stringify([existing])
  const next = addExplorerFile(before, input)
  assert.deepEqual(JSON.parse(next.drafts['a:chat:task:context']), [
    existing,
    { repoId: 'r', path: input.path, source: 'mention', referenceOnly: true },
  ])
})

test('refuses removed, offline and mismatched scopes without redirecting or replacing a draft', () => {
  const before = state()
  const reject = (source, data, code) =>
    assert.throws(
      () => addExplorerFile(source, data),
      (error) => error.code === code,
    )
  reject({ ...before, computers: [] }, input, 'host')
  reject({ ...before, computers: [{ id: 'a', status: 'offline' }] }, input, 'host')
  reject({ ...before, projects: [] }, input, 'scope')
  reject(before, { ...input, composer: { projectId: 'b:p' } }, 'scope')
  reject(before, { ...input, contextId: 'gone' }, 'scope')
  reject(
    before,
    { ...input, contextId: 'worktree:w', catalog: { host: 'b', rows: [{ id: 'w', projectId: 'p' }] } },
    'scope',
  )
  for (const path of ['../file', '/etc/passwd', 'C:/file', 'a\\b', 'a//b', 'a/./b', 'a\0b'])
    reject(before, { ...input, path }, 'file')
  assert.equal(before.drafts['a:new:a:p'], 'Keep my Home draft')
})

test('preserves malformed/full drafts and requires review if a file-started draft changed checkouts', () => {
  const before = state()
  before.drafts['a:chat:task:context'] = '{broken'
  assert.throws(
    () => addExplorerFile(before, input),
    (error) => error.code === 'corrupt',
  )
  before.drafts['a:chat:task:context'] = JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({ repoId: 'r', path: `${i}.ts` })),
  )
  assert.throws(
    () => addExplorerFile(before, input),
    (error) => error.code === 'full',
  )
  assert.equal(JSON.parse(addExplorerFile(before, { ...input, path: '0.ts' }).drafts['a:chat:task:context']).length, 30)
  const key = newComposerKey('a', 'a:p', 'project:p')
  before.drafts[`${key}:workspace`] = '{"version":1,"mode":"worktree","workspaceId":"different"}'
  assert.throws(
    () => addExplorerFile(before, { ...input, contextId: 'project:p' }),
    (error) => error.code === 'scope',
  )
})

test('a send acknowledgement consumes only its unchanged complete composer snapshot', () => {
  const before = state()
  const key = 'a:chat:task'
  const expected = {
    text: before.drafts[key],
    attachments: before.drafts[`${key}:attachments`],
    context: '[]',
    mentions: before.drafts[`${key}:mentions`],
  }
  const cleared = consumeComposerDraft(before.drafts, key, expected)
  assert.equal(cleared[key], '')
  assert.equal(cleared[`${key}:attachments`], '[]')
  const added = addExplorerFile(before, input)
  assert.equal(
    consumeComposerDraft(added.drafts, key, expected),
    null,
    'a later file must not disappear after Send resolves',
  )
  assert.equal(consumeComposerDraft({ ...before.drafts, [key]: 'Newer message' }, key, expected), null)
  assert.equal(
    consumeComposerDraft({ ...before.drafts, [`${key}:attachments`]: '[{"id":"new"}]' }, key, expected),
    null,
  )
  assert.equal(before.drafts[key], '> Quoted context\n\nPlease inspect')
})

test('preserves staged/unstaged/all-diff context and stores image references without image bytes', () => {
  const before = state()
  const key = 'a:chat:task:context'
  for (const diff of [false, true, 'all']) {
    before.drafts = addExplorerFile(before, { ...input, diff }).drafts
  }
  assert.deepEqual(
    JSON.parse(before.drafts[key]).map((file) => file.diff.staged),
    [false, true, 'all'],
  )
  const image = addExplorerFile(before, { ...input, path: 'image.png', asReference: true })
  assert.deepEqual(JSON.parse(image.drafts[key]).at(-1), {
    repoId: 'r',
    path: 'image.png',
    source: 'tab',
    referenceOnly: true,
  })
})
