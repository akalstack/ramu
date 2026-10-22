import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { ReviewService } from '../src/review/reviews'
import type { AgentService } from '../src/agent'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type AgentEvent } from '@ramu/shared/types'

let db: Db, dir: string, cwd: string, taskId: string, reviews: ReviewService
const base = 'Owner line\n\nStable line\n\nOriginal behavior\n\nTail\n'
const events = () =>
  (
    db.prepare('SELECT event FROM agent_events WHERE session_id = ? ORDER BY seq').all('session') as { event: string }[]
  ).map((row) => JSON.parse(row.event) as AgentEvent)
const record = (event: AgentEvent) =>
  db
    .prepare(
      'INSERT INTO agent_events (session_id, seq, event) VALUES (?, (SELECT COALESCE(MAX(seq),0)+1 FROM agent_events WHERE session_id=?), ?)',
    )
    .run('session', 'session', JSON.stringify(event))
const capture = async (request: string, write: () => void) => {
  const id = await reviews.begin(taskId, { cwd, additionalDirs: [], covers: [cwd] })
  reviews.bind(id, 'session')
  record({ kind: 'user', text: request })
  write()
  record({ kind: 'result', text: 'done', isError: false, costUsd: null })
  await reviews.complete('session')
  return id
}
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-chat-undo-'))
  db = openDb(':memory:')
  const workspace = new Workspace(db, join(dir, 'worktrees'))
  workspace.setAppState('app-preferences', { aiChangeNotes: false, autoReviewChanges: false })
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Undo across providers', mode: 'current' })
  taskId = task.id
  cwd = workspace.agentScope(taskId).cwd
  db.prepare(
    'INSERT INTO agent_sessions (id,task_id,provider,cwd,covers,state,created_at,settings) VALUES (?,?,?,?,?,?,?,?)',
  ).run('session', taskId, 'claude-code', cwd, JSON.stringify([cwd]), 'idle', 0, JSON.stringify(DEFAULT_AGENT_SETTINGS))
  const agents = {
    get: () => ({ taskId, cwd, covers: [cwd], additionalDirs: [], settings: DEFAULT_AGENT_SETTINGS }),
    events,
    activeWriter: () => null,
    withWorkspaceReservation: async (_covers: string[], action: () => Promise<unknown>) => action(),
    recordFileRestore: (_id: string, userSeq: number, fileCount: number) =>
      record({ kind: 'file-restore', userSeq, fileCount }),
  } as unknown as AgentService
  reviews = new ReviewService(db, workspace, agents, join(dir, 'reviews'), () => {})
  writeFileSync(join(cwd, 'behavior.txt'), base)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('thread restore across captured runs', () => {
  it('restores Claude and Codex runs together, retains later user edits, and marks every original revision', async () => {
    const first = await capture('Claude request', () => {
      writeFileSync(join(cwd, 'behavior.txt'), base.replace('Original behavior', 'Claude behavior'))
      writeFileSync(join(cwd, 'added.txt'), 'Claude created this\n')
    })
    db.prepare("UPDATE agent_sessions SET provider = 'codex' WHERE id = 'session'").run()
    const second = await capture('Codex continuation', () => {
      writeFileSync(join(cwd, 'behavior.txt'), base.replace('Original behavior', 'Codex behavior'))
      writeFileSync(join(cwd, 'added.txt'), 'Codex refined this\n')
    })
    writeFileSync(
      join(cwd, 'behavior.txt'),
      base.replace('Owner line', 'Later user line').replace('Original behavior', 'Codex behavior'),
    )
    const preview = await reviews.chatUndoPreview('session', 1)
    expect(preview.files.every((file) => file.status === 'ready')).toBe(true)
    await reviews.chatUndoApply(
      preview.token,
      preview.files.map((file) => file.fileId),
    )
    expect(readFileSync(join(cwd, 'behavior.txt'), 'utf8')).toBe(base.replace('Owner line', 'Later user line'))
    expect(existsSync(join(cwd, 'added.txt'))).toBe(false)
    expect(reviews.get(first).undoFileIds).toHaveLength(2)
    expect(reviews.get(second).undoFileIds).toHaveLength(2)
    expect(events().filter((event) => event.kind === 'user')).toHaveLength(2)
    expect(events().at(-1)).toEqual({ kind: 'file-restore', userSeq: 1, fileCount: 2 })
  })
  it('restores only later runs when editing a later message', async () => {
    await capture('First request', () => writeFileSync(join(cwd, 'behavior.txt'), 'First change\n'))
    await capture('Second request', () => writeFileSync(join(cwd, 'behavior.txt'), 'Second change\n'))
    const preview = await reviews.chatUndoPreview('session', 3)
    await reviews.chatUndoApply(
      preview.token,
      preview.files.map((file) => file.fileId),
    )
    expect(readFileSync(join(cwd, 'behavior.txt'), 'utf8')).toBe('First change\n')
  })
  it('does not remove manual edits made between captured provider runs', async () => {
    await capture('First request', () => writeFileSync(join(cwd, 'behavior.txt'), 'Claude change\n'))
    writeFileSync(join(cwd, 'behavior.txt'), 'User edit between turns\n')
    await capture('Second request', () => writeFileSync(join(cwd, 'behavior.txt'), 'Codex change\n'))
    const preview = await reviews.chatUndoPreview('session', 1)
    expect(preview.files[0]).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('outside the captured runs'),
    })
    await expect(reviews.chatUndoApply(preview.token, [preview.files[0]!.fileId])).rejects.toThrow('ready')
    expect(readFileSync(join(cwd, 'behavior.txt'), 'utf8')).toBe('Codex change\n')
  })
  it('rejects stale thread and file previews before writing', async () => {
    await capture('Request', () => {
      writeFileSync(join(cwd, 'behavior.txt'), 'Agent change\n')
      writeFileSync(join(cwd, 'added.txt'), 'Added\n')
    })
    const staleChat = await reviews.chatUndoPreview('session', 1)
    record({ kind: 'user', text: 'New input' })
    await expect(
      reviews.chatUndoApply(
        staleChat.token,
        staleChat.files.map((file) => file.fileId),
      ),
    ).rejects.toThrow('thread changed')
    const staleFiles = await reviews.chatUndoPreview('session', 1)
    writeFileSync(join(cwd, 'added.txt'), 'Later user edit\n')
    await expect(
      reviews.chatUndoApply(
        staleFiles.token,
        staleFiles.files.map((file) => file.fileId),
      ),
    ).rejects.toThrow('changed after preview')
    expect(readFileSync(join(cwd, 'behavior.txt'), 'utf8')).toBe('Agent change\n')
  })
  it('does not claim an exact checkpoint for a steering message inside a shared capture', async () => {
    const id = await reviews.begin(taskId, { cwd, covers: [cwd], additionalDirs: [] })
    reviews.bind(id, 'session')
    record({ kind: 'user', text: 'Initial input' })
    record({ kind: 'user', text: 'Steered input' })
    writeFileSync(join(cwd, 'behavior.txt'), 'Changes from both inputs\n')
    await reviews.complete('session')
    await expect(reviews.chatUndoPreview('session', 2)).rejects.toThrow('shares a file snapshot')
  })
})
