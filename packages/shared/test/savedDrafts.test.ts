import { expect, it } from 'vitest'
import {
  emptyMessageDraft,
  emptySavedDrafts,
  moveMessageDraft,
  readSavedDrafts,
  savedDraftAttachments,
  SAVED_DRAFT_LIMITS,
  type MessageDraftSnapshot,
  type SavedDraftLibrary,
  type SavedDraftCommand,
} from '../src/chat/savedDrafts'

const scope = { kind: 'new' as const, id: 'new:p', projectId: 'p' }
const snapshot = (): MessageDraftSnapshot => ({
  text: '> Quoted decision\n\nReview @"repo/auth.ts" and $security ',
  attachments: [{ id: 'image', name: 'shot.png', size: 4, mimeType: 'image/png', path: '/host/attachments/image.png' }],
  context: [
    {
      repoId: 'r',
      path: 'src/auth.ts',
      content: 'unsaved excerpt',
      source: 'tab',
      diff: { staged: 'all', oid: 'abcdef' },
      selection: { startLine: 2, startColumn: 1, endLine: 3, endColumn: 4, side: 'original' },
    },
  ],
  mentions: [{ file: { repoId: 'r', path: 'auth.ts' }, insertion: '@"repo/auth.ts" ', token: '@auth.ts' }],
  workspace: { mode: 'worktree', workspaceId: 'w', name: 'Payments' },
})
const move = (library: SavedDraftLibrary, active: MessageDraftSnapshot, command: SavedDraftCommand) =>
  moveMessageDraft({
    library,
    hostId: library.hostId,
    expectedRevision: library.revision,
    scope,
    active,
    expectedActive: structuredClone(active),
    command,
  })
const save = (library = emptySavedDrafts('host'), active = snapshot(), id = 'draft') =>
  move(library, active, { kind: 'save', id, at: 1 })

it('puts a complete message aside, allows urgent work, and restores it without changing the eventual message', () => {
  const active = snapshot()
  const saved = save(emptySavedDrafts('host'), active)
  expect(saved.active).toEqual({ ...emptyMessageDraft(), workspace: active.workspace })
  expect(saved.library.items[0]?.snapshot).toEqual(active)
  const urgent = { ...saved.active, text: 'Urgent question' }
  const swapped = move(saved.library, urgent, {
    kind: 'restore',
    id: 'draft',
    itemRevision: 1,
    parkId: 'urgent',
    at: 2,
  })
  expect(swapped.active).toEqual(active)
  expect(swapped.library.items.map((item) => item.id)).toEqual(['urgent'])
  expect(swapped.library.items[0]?.snapshot.text).toBe('Urgent question')
  expect(savedDraftAttachments(swapped.active)).toEqual([{ file: active.attachments[0], availability: 'unverified' }])
  active.text = 'late edit'
  active.context[0]!.content = 'later buffer'
  expect(saved.library.items[0]?.snapshot.text).not.toBe('late edit')
  expect(swapped.active.context[0]?.content).toBe('unsaved excerpt')
})

it('preserves explicit saved work through restart and age, and isolates colliding host/scope identities', () => {
  const saved = save()
  const raw = JSON.stringify(saved.library)
  expect(readSavedDrafts(raw, 'host')).toEqual(saved.library)
  expect(() => readSavedDrafts(raw, 'other')).toThrow('host')
  expect(() =>
    moveMessageDraft({
      library: saved.library,
      hostId: 'host',
      expectedRevision: 1,
      scope: { ...scope, kind: 'thread' },
      active: emptyMessageDraft(),
      expectedActive: emptyMessageDraft(),
      command: { kind: 'restore', id: 'draft', itemRevision: 1, at: Date.now() },
    }),
  ).toThrow('scope')
  expect(
    move(saved.library, emptyMessageDraft(), { kind: 'restore', id: 'draft', itemRevision: 1, at: Date.now() }).active,
  ).toEqual(snapshot())
})

it('rejects stale moves, repeated activation, occupied restore without consent and unfinished uploads', () => {
  const first = save()
  const restore = { kind: 'restore' as const, id: 'draft', itemRevision: 1, at: 2 }
  expect(() => move(first.library, snapshot(), restore)).toThrow('conflict')
  expect(() => move(first.library, emptyMessageDraft(), { ...restore, itemRevision: 2 })).toThrow('conflict')
  expect(() =>
    moveMessageDraft({
      library: first.library,
      hostId: 'host',
      expectedRevision: 0,
      scope,
      active: emptyMessageDraft(),
      expectedActive: emptyMessageDraft(),
      command: restore,
    }),
  ).toThrow('conflict')
  expect(() =>
    moveMessageDraft({
      library: first.library,
      hostId: 'host',
      expectedRevision: 1,
      scope,
      active: { ...emptyMessageDraft(), text: 'newer edit' },
      expectedActive: emptyMessageDraft(),
      command: restore,
    }),
  ).toThrow('conflict')
  const restored = move(first.library, emptyMessageDraft(), restore)
  expect(() => move(restored.library, emptyMessageDraft(), restore)).toThrow('conflict')
  expect(() => move(first.library, snapshot(), { kind: 'save', id: 'second', at: 2, uploadsPending: true })).toThrow(
    'uploading',
  )
  expect(() => save(first.library, snapshot(), 'draft')).toThrow('conflict')
  expect(first.library.items).toHaveLength(1)
})

it('supports context-only and attachment-only drafts, rejects empty saves, and preserves default provenance', () => {
  expect(() => save(emptySavedDrafts('host'), emptyMessageDraft())).toThrow('empty')
  const fileOnly = { ...emptyMessageDraft(), context: snapshot().context }
  expect(save(emptySavedDrafts('host'), fileOnly).library.items[0]?.snapshot).toEqual(fileOnly)
  const attached = { ...emptyMessageDraft(), attachments: snapshot().attachments, workspace: { mode: null } }
  const saved = save(emptySavedDrafts('host'), attached)
  expect(saved.library.items[0]?.snapshot.workspace).toEqual({ mode: null })
})

it('deletes with an undo receipt, without deleting referenced attachment bytes or replacing later saves', () => {
  const saved = save()
  const deleted = move(saved.library, saved.active, { kind: 'delete', id: 'draft', itemRevision: 1 })
  expect(deleted.library.items).toEqual([])
  expect(deleted.active).toEqual(saved.active)
  expect(deleted.deleted).toEqual(saved.library.items[0])
  const undone = move(deleted.library, deleted.active, { kind: 'undo-delete', item: deleted.deleted! })
  expect(undone.library.items).toEqual(saved.library.items)
  expect(() => move(undone.library, undone.active, { kind: 'undo-delete', item: deleted.deleted! })).toThrow('conflict')
  const other = emptySavedDrafts('other')
  expect(() => move(other, emptyMessageDraft(), { kind: 'undo-delete', item: deleted.deleted! })).toThrow('host')
})

it('refuses unknown versions, corrupt records and embedded payloads without changing the source', () => {
  const original = save().library
  const bad = [
    '{broken',
    JSON.stringify({ ...original, version: 2 }),
    JSON.stringify({ ...original, items: [...original.items, ...original.items] }),
    JSON.stringify({ ...original, items: [{ ...original.items[0], hostId: 'other' }] }),
    JSON.stringify({ ...original, items: [{ ...original.items[0], snapshot: { ...snapshot(), provider: 'codex' } }] }),
    JSON.stringify({
      ...original,
      items: [
        {
          ...original.items[0],
          snapshot: { ...snapshot(), attachments: [{ ...snapshot().attachments[0], base64: 'payload' }] },
        },
      ],
    }),
  ]
  for (const raw of bad) expect(() => readSavedDrafts(raw, 'host')).toThrow()
  expect(original.items).toHaveLength(1)
  expect(readSavedDrafts(null, 'host')).toEqual(emptySavedDrafts('host'))
})

it('validates captured paths, selections and workspace intent instead of silently dropping context', () => {
  for (const path of ['/etc/passwd', '../outside', 'src/../../outside', 'src\\outside']) {
    const active = snapshot()
    active.context[0]!.path = path
    expect(() => save(emptySavedDrafts('host'), active)).toThrow('invalid')
  }
  const invalid = snapshot()
  invalid.context[0]!.selection!.endLine = 1
  expect(() => save(emptySavedDrafts('host'), invalid)).toThrow('invalid')
  invalid.context[0]!.selection = undefined
  invalid.workspace!.mode = 'current'
  expect(() => save(emptySavedDrafts('host'), invalid)).toThrow('invalid')
})

it('rejects capacity and size overflow without truncation or eviction; a swap still works at capacity', () => {
  let library = emptySavedDrafts('host')
  for (let index = 0; index < SAVED_DRAFT_LIMITS.items; index++)
    library = save(library, snapshot(), `d${index}`).library
  const raw = JSON.stringify(library)
  expect(() => save(library, snapshot(), 'overflow')).toThrow('full')
  const swapped = move(library, snapshot(), { kind: 'restore', id: 'd0', itemRevision: 1, parkId: 'park', at: 2 })
  expect(swapped.library.items).toHaveLength(SAVED_DRAFT_LIMITS.items)
  expect(() =>
    save(emptySavedDrafts('host'), { ...snapshot(), text: 'x'.repeat(SAVED_DRAFT_LIMITS.text + 1) }),
  ).toThrow('invalid')
  const huge = snapshot()
  huge.context = Array.from({ length: 3 }, (_, index) => ({
    repoId: 'r',
    path: `${index}.txt`,
    source: 'tab',
    content: 'x'.repeat(1_000_000),
  }))
  expect(() => save(emptySavedDrafts('host'), huge)).toThrow('full')
  expect(JSON.stringify(library)).toBe(raw)
})
