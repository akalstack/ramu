import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mobileMessageDraft, moveMobileMessageDraft, savedMessagesKey } from '../src/runtime/savedMessageDrafts.ts'

const key = 'host:new:host:p'
const scope = { kind: 'new', id: key, projectId: 'host:p' }
const drafts = () => ({
  [key]: '> quoted context\n\nInvestigate @auth.ts',
  [`${key}:context`]: '[{"repoId":"r","path":"auth.ts","source":"mention","content":"captured text"}]',
  [`${key}:mentions`]: JSON.stringify([
    { file: { repoId: 'r', path: 'auth.ts' }, insertion: '@"repo/auth.ts" ', token: '@auth.ts' },
  ]),
  [`${key}:attachments`]: '[{"id":"a","name":"shot.png","size":4,"mimeType":"image/png","path":"/host/shot.png"}]',
  [`${key}:workspace`]: '{"version":1,"mode":"worktree","workspaceId":"w","name":"Payments"}',
  'other:new:other:p': 'Other host draft',
  'host:chat:other': 'Other thread draft',
})
const save = (current = drafts()) =>
  moveMobileMessageDraft({
    drafts: current,
    knownHosts: ['host', 'other'],
    hostId: 'host',
    key,
    scope,
    expectedRevision: 0,
    expectedActive: mobileMessageDraft(current, key),
    command: { kind: 'save', id: 'saved', at: 1 },
  })

test('moves all legacy sidecars together and restores them without changing unrelated hosts/scopes', () => {
  const before = drafts()
  const next = save(before)
  assert.equal(before[key], '> quoted context\n\nInvestigate @auth.ts')
  assert.equal(next.drafts[key], '')
  assert.deepEqual(JSON.parse(next.drafts[`${key}:attachments`]), [])
  assert.equal(next.drafts['other:new:other:p'], before['other:new:other:p'])
  assert.equal(next.drafts['host:chat:other'], before['host:chat:other'])
  const restarted = JSON.parse(JSON.stringify(next.drafts))
  const restored = moveMobileMessageDraft({
    drafts: restarted,
    knownHosts: ['host'],
    hostId: 'host',
    key,
    scope,
    expectedRevision: 1,
    expectedActive: mobileMessageDraft(restarted, key),
    command: { kind: 'restore', id: 'saved', itemRevision: 1, at: 2 },
  })
  assert.deepEqual(mobileMessageDraft(restored.drafts, key), mobileMessageDraft(before, key))
  assert.equal(JSON.parse(restored.drafts[savedMessagesKey('host')]).items.length, 0)
})

test('rejects stale, unknown-host and colliding-host moves without deleting a saved source', () => {
  const before = drafts()
  const saved = save(before)
  const input = {
    drafts: saved.drafts,
    knownHosts: ['host', 'other'],
    hostId: 'host',
    key,
    scope,
    expectedRevision: 1,
    expectedActive: saved.active,
    command: { kind: 'restore', id: 'saved', itemRevision: 1, at: 2 },
  }
  assert.throws(
    () => moveMobileMessageDraft({ ...input, drafts: { ...saved.drafts, [key]: 'Newer edit' } }),
    /conflict/,
  )
  assert.throws(() => moveMobileMessageDraft({ ...input, knownHosts: [] }), /host/)
  assert.throws(() => moveMobileMessageDraft({ ...input, hostId: 'other' }), /host/)
  assert.throws(() => moveMobileMessageDraft({ ...input, expectedRevision: 0 }), /conflict/)
  assert.equal(JSON.parse(saved.drafts[savedMessagesKey('host')]).items.length, 1)
})

test('preserves broken legacy sidecars for recovery instead of saving an incomplete message', () => {
  const original = drafts()
  original[`${key}:mentions`] = '{broken'
  const raw = JSON.stringify(original)
  assert.throws(() => save(original), /invalid/)
  assert.equal(JSON.stringify(original), raw)
})

test('an offline-created thread keeps its saved source when it receives a host task ID', () => {
  const oldKey = 'host:chat:host:pending-local'
  const newKey = 'host:chat:server-task'
  const before = { [oldKey]: 'Draft composed while creation was queued' }
  const source = { kind: 'thread', id: oldKey, threadId: 'host:pending-local' }
  const saved = moveMobileMessageDraft({
    drafts: before,
    knownHosts: ['host'],
    hostId: 'host',
    key: oldKey,
    scope: source,
    expectedRevision: 0,
    expectedActive: mobileMessageDraft(before, oldKey),
    command: { kind: 'save', id: 'queued-source', at: 1 },
  })
  const restored = moveMobileMessageDraft({
    drafts: saved.drafts,
    knownHosts: ['host'],
    hostId: 'host',
    key: newKey,
    scope: { ...source, id: newKey },
    expectedRevision: 1,
    expectedActive: mobileMessageDraft(saved.drafts, newKey),
    command: { kind: 'restore', id: 'queued-source', itemRevision: 1, at: 2 },
  })
  assert.equal(restored.drafts[newKey], before[oldKey])
  assert.equal(JSON.parse(restored.drafts[savedMessagesKey('host')]).items.length, 0)
})

test('explicit saved drafts retain partial branch edits and their bounded naming intent across restart', () => {
  const before = drafts()
  const branch = {
    title: 'Login',
    intent: { strategy: 'custom', instructions: 'Use team/', prompt: 'Fix login' },
    choice: { name: 'team/', source: 'manual' },
  }
  before[`${key}:workspace`] = JSON.stringify({ version: 1, mode: 'worktree', branch })
  const saved = save(before)
  const restarted = JSON.parse(JSON.stringify(saved.drafts))
  const restored = moveMobileMessageDraft({
    drafts: restarted,
    knownHosts: ['host'],
    hostId: 'host',
    key,
    scope,
    expectedRevision: 1,
    expectedActive: mobileMessageDraft(restarted, key),
    command: { kind: 'restore', id: 'saved', itemRevision: 1, at: 2 },
  })
  assert.deepEqual(mobileMessageDraft(restored.drafts, key).workspace.branch, branch)
  const corrupt = drafts()
  corrupt[`${key}:workspace`] = JSON.stringify({
    version: 1,
    mode: 'worktree',
    branch: { ...branch, intent: { ...branch.intent, prompt: 'x'.repeat(6001) } },
  })
  assert.throws(() => save(corrupt), /invalid/)
})

test('same-host recovery moves missing-scope work atomically and preserves destination settings and unrelated sidecars', () => {
  const saved = save()
  const targetKey = 'host:chat:surviving'
  const targetScope = { kind: 'thread', id: targetKey, threadId: 'surviving' }
  const current = {
    ...saved.drafts,
    [targetKey]: 'Current work',
    [`${targetKey}:workspace`]: '{"version":1,"mode":"current"}',
    [`${targetKey}:agent`]: '{"version":1,"selection":{"provider":"codex","model":"manual","effort":null}}',
  }
  const input = {
    drafts: current,
    knownHosts: ['host', 'other'],
    hostId: 'host',
    key: targetKey,
    scope: targetScope,
    expectedRevision: 1,
    expectedActive: mobileMessageDraft(current, targetKey),
    command: { kind: 'restore-here', id: 'saved', itemRevision: 1, parkId: 'current', at: 2 },
  }
  const next = moveMobileMessageDraft(input)
  assert.equal(next.active.workspace.mode, 'current')
  assert.match(next.active.text, /captured text/)
  assert.deepEqual(next.active.context, [])
  assert.deepEqual(next.active.mentions, [])
  assert.equal(next.drafts[`${targetKey}:restored-attachments`], 'yes')
  assert.equal(next.drafts[`${targetKey}:agent`], current[`${targetKey}:agent`])
  assert.equal(next.drafts['other:new:other:p'], current['other:new:other:p'])
  const library = JSON.parse(next.drafts[savedMessagesKey('host')])
  assert.equal(library.items[0].snapshot.text, 'Current work')
  assert.deepEqual(library.items[0].scope, targetScope)
  assert.throws(() => moveMobileMessageDraft({ ...input, hostId: 'other' }), /host/)
  assert.throws(
    () => moveMobileMessageDraft({ ...input, drafts: { ...current, [targetKey]: 'Newer edit' } }),
    /conflict/,
  )
  assert.equal(JSON.parse(current[savedMessagesKey('host')]).items[0].id, 'saved')
})
