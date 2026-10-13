import { mkdtempSync, rmSync, writeFileSync, readFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace'
import { ReviewService } from '../src/reviews'
import { reviewsByTurn } from '@ramu/shared/reviewGroups'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type ChangeReview } from '@ramu/shared/types'
import type { AgentService } from '../src/agent'
let db: Db, dir: string, ws: Workspace, service: ReviewService, review: ChangeReview, cwd: string
let submit: ReturnType<typeof vi.fn>, analyze: ReturnType<typeof vi.fn>
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-review-')); db = openDb(':memory:'); ws = new Workspace(db, join(dir, 'worktrees'))
  ws.setAppState('app-preferences', { aiChangeNotes: false, autoReviewChanges: false })
  const task = await ws.createTask({ projectId: NO_PROJECT, title: 'Review test', mode: 'current' })
  const scope = ws.agentScope(task.id); cwd = scope.cwd
  db.prepare('INSERT INTO agent_sessions (id,task_id,provider,cwd,covers,state,created_at,settings) VALUES (?,?,?,?,?,?,?,?)').run('session', task.id, 'claude-code', cwd, JSON.stringify([cwd]), 'idle', Date.now(), JSON.stringify(DEFAULT_AGENT_SETTINGS))
  submit = vi.fn(async () => {}); analyze = vi.fn(async () => ({ message: '{"summary":"Looks good","findings":[],"notes":[]}' }))
  const agents = { get: () => ({ settings: DEFAULT_AGENT_SETTINGS, taskId: task.id, cwd, covers: [cwd], additionalDirs: [] }), events: () => [{ kind: 'user', text: 'Improve the notes' }], submit, analyze } as unknown as AgentService
  service = new ReviewService(db, ws, agents, join(dir, 'reviews'), () => {})
  writeFileSync(join(cwd, 'changed.txt'), 'Pre-existing local edit\nOriginal line\n')
  writeFileSync(join(cwd, 'unchanged.txt'), 'User local edits stay unchanged\n')
  writeFileSync(join(cwd, 'deleted.txt'), 'Delete this\n')
  const id = await service.begin(task.id, scope); service.bind(id, 'session')
  writeFileSync(join(cwd, 'changed.txt'), 'Pre-existing local edit\nAgent change\n')
  writeFileSync(join(cwd, 'added.txt'), 'New file\n'); rmSync(join(cwd, 'deleted.txt'))
  await service.complete('session'); review = service.get(id)
})
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })
const human = (text = 'Fix this line') => service.comment(review.id, { fileId: review.files.find((f) => f.path === 'changed.txt')!.id, side: 'new', line: 2, endLine: 2, scope: 'line', text })
describe('saved reviews and live workspaces', () => {
  it('records added and removed line counts from the run, independent of current edits', async () => {
    expect(review.files.find((f) => f.path === 'changed.txt')).toMatchObject({ addedLines: 1, removedLines: 1 })
    expect(review.files.find((f) => f.path === 'added.txt')).toMatchObject({ addedLines: 1, removedLines: 0 })
    expect(review.files.find((f) => f.path === 'deleted.txt')).toMatchObject({ addedLines: 0, removedLines: 1 })
    writeFileSync(join(cwd, 'changed.txt'), 'External edit\nWith more lines\nAnother line\n')
    expect(service.get(review.id).files.find((f) => f.path === 'changed.txt')).toMatchObject({ addedLines: 1, removedLines: 1 })
  })
  it('backfills older snapshots without changing their discussions or asking AI', async () => {
    human()
    const saved = service.get(review.id)
    const legacy = { ...saved, files: saved.files.map(({ addedLines, removedLines, ...file }) => file) }
    db.prepare('UPDATE change_reviews SET data=? WHERE id=?').run(JSON.stringify(legacy), review.id)
    const hydrated = await service.details(review.id)
    expect(hydrated.files.find((f) => f.path === 'changed.txt')).toMatchObject({ addedLines: 1, removedLines: 1 })
    expect(hydrated.comments).toEqual(saved.comments); expect(analyze).not.toHaveBeenCalled()
  })
  it('keeps snapshot content and comments when current code changes', async () => {
    const comment = human().comments[0]!
    writeFileSync(join(cwd, 'changed.txt'), 'Pre-existing local edit\nExternal change\n')
    const state = (await service.inspect(review.id)).find((s) => s.fileId === comment.fileId)!
    expect(state).toMatchObject({ state: 'changed', outdatedCommentIds: [comment.id] })
    expect(service.get(review.id).files.find((f) => f.id === comment.fileId)?.newContent).toContain('Agent change')
    expect(service.get(review.id).comments[0]?.state).toBe('draft')
    const comparison = await service.compareCurrent(review.id, comment.fileId)
    expect(comparison.oldContent).toContain('Agent change'); expect(comparison.newContent).toContain('External change')
  })
  it('distinguishes missing files from recorded deletions and lets humans locate a move', async () => {
    const file = review.files.find((f) => f.path === 'changed.txt')!
    renameSync(join(cwd, file.path), join(cwd, 'moved.txt'))
    const states = await service.inspect(review.id)
    expect(states.find((s) => s.fileId === file.id)?.state).toBe('missing')
    expect(states.find((s) => s.fileId === review.files.find((f) => f.path === 'deleted.txt')!.id)?.state).toBe('deleted')
    await service.locate(review.id, file.id, 'moved.txt')
    expect((await service.inspect(review.id)).find((s) => s.fileId === file.id)).toMatchObject({ state: 'moved', currentPath: 'moved.txt' })
    expect(service.get(review.id).files.find((f) => f.id === file.id)?.path).toBe('changed.txt')
    await expect(service.locate(review.id, file.id, '../escape.txt')).rejects.toThrow()
  })
  it('links matching later changes in another chat only in the same working folder', async () => {
    const file = review.files.find((f) => f.path === 'changed.txt')!
    const next = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(next, 'other-session')
    writeFileSync(join(cwd, file.path), 'Other chat change\n'); await service.complete('other-session')
    const newer = service.get(next)
    db.prepare('UPDATE change_reviews SET task_id=?, data=? WHERE id=?').run('other-chat', JSON.stringify({ ...newer, taskId: 'other-chat' }), next)
    expect((await service.inspect(review.id)).find((s) => s.fileId === file.id)?.newerReview).toEqual({ id: next, taskId: 'other-chat', fileId: file.id })
    writeFileSync(join(cwd, file.path), 'Unrecorded external edit\n')
    expect((await service.inspect(review.id)).find((s) => s.fileId === file.id)?.newerReview).toBeUndefined()
  })
  it('checks branch identity without treating commits or pushes as review completion', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-m', 'Initial')
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    writeFileSync(join(cwd, 'changed.txt'), 'Recorded change\n'); await service.complete('session')
    const saved = service.get(id), file = saved.files[0]!
    service.comment(id, { fileId: file.id, scope: 'line', side: 'new', line: 1, endLine: 1, text: 'Check this' })
    git('add', '.'); git('commit', '-m', 'Recorded run')
    expect((await service.inspect(id))[0]).toMatchObject({ state: 'unchanged', checkoutChanged: false })
    expect(service.get(id).reviewedAt).toBeUndefined()
    git('checkout', '-b', 'other')
    expect((await service.inspect(id))[0]).toMatchObject({ checkoutChanged: true, recordedBranch: 'main', currentBranch: 'other' })
    await expect(service.sendComments(id, service.get(id).comments.map((c) => c.id))).rejects.toThrow('branch main')
    await expect(service.undoPreview(id)).rejects.toThrow('branch main')
    git('checkout', 'main')
    await expect(service.requireOriginalCheckout(id)).resolves.toBeUndefined()
    git('mv', file.path, 'renamed.txt')
    expect((await service.inspect(id))[0]).toMatchObject({ state: 'moved', currentPath: 'renamed.txt' })
  })
  it('reports branch context without inspecting files or replacing the saved diff', async () => {
    const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
    git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com'); git('add', '.'); git('commit', '-m', 'Initial')
    git('checkout', '-b', 'feature')
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    writeFileSync(join(cwd, 'changed.txt'), 'Snapshot result\n'); await service.complete('session')
    const saved = service.get(id)
    git('checkout', '-b', 'other')
    rmSync(join(cwd, 'changed.txt'))
    const inspect = vi.spyOn(service, 'inspect')
    expect(await service.branches(id)).toEqual([{ repoId: 'general', repoName: 'Chat files', currentBranch: 'other', targetBranch: 'main', recordedBranch: 'feature' }])
    expect(inspect).not.toHaveBeenCalled()
    expect(service.get(id)).toEqual(saved)
    git('checkout', '--detach')
    expect((await service.branches(id))[0]?.currentBranch).toMatch(/^HEAD \([a-f0-9]{8}\)$/)
    // Old reviews still resolve a target without rewriting their saved data.
    const legacy = JSON.parse(JSON.stringify(saved))
    delete legacy.roots[0].targetBranch
    db.prepare('UPDATE change_reviews SET data=? WHERE id=?').run(JSON.stringify(legacy), id)
    expect((await service.branches(id))[0]?.targetBranch).toBe('main')
  })
  it('preserves the worktree target from capture even if its binding changes', async () => {
    const binding = { ...ws.fileBindings(review.taskId)[0]!, baseRef: 'release' }
    const list = vi.spyOn(ws, 'listBindings').mockReturnValue([binding])
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    writeFileSync(join(cwd, 'changed.txt'), 'Another run\n'); await service.complete('session')
    list.mockReturnValue([{ ...binding, baseRef: 'main' }])
    expect((await service.branches(id))[0]?.targetBranch).toBe('release')
    list.mockRestore()
  })
  it('shows the branch before a repository has its first commit', async () => {
    execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' })
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    writeFileSync(join(cwd, 'changed.txt'), 'First run\n'); await service.complete('session')
    expect((await service.branches(id))[0]).toMatchObject({ currentBranch: 'main', targetBranch: 'main', recordedBranch: 'main' })
  })
  it('supports snapshots without a Git branch or target', async () => {
    expect(await service.branches(review.id)).toEqual([{ repoId: 'general', repoName: 'Chat files', currentBranch: null, targetBranch: null, recordedBranch: null }])
  })
  it('sends current-file context and outdated state without resolving the comment', async () => {
    const comment = human().comments[0]!
    writeFileSync(join(cwd, 'changed.txt'), 'External replacement\n')
    await service.sendComments(review.id, [comment.id])
    const prompt = submit.mock.calls[0]![1] as unknown as string
    expect(prompt).toContain('"outdated":true'); expect(prompt).toContain('"state":"changed"')
    expect(service.get(review.id).comments[0]?.state).toBe('sent')
  })
})
describe('agent changes and batched feedback', () => {
  it('never starts automatic analysis, even for old profiles with both toggles enabled', async () => {
    ws.setAppState('app-preferences', { aiChangeNotes: true, autoReviewChanges: true })
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    writeFileSync(join(cwd, 'changed.txt'), 'Another change\n')
    await service.complete('session'); await service.settle()
    expect(analyze).not.toHaveBeenCalled()
    expect(service.get(id)).toMatchObject({ state: 'ready', aiState: 'idle', comments: [] })
  })
  it('keeps empty and recording captures out of pair review without losing run boundaries', async () => {
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    expect(service.list('session').map((r) => r.id)).toEqual([review.id])
    db.prepare('INSERT INTO agent_events VALUES (?,?,?)').run('session', 1, JSON.stringify({ kind: 'tool-use', toolUseId: 'check', name: 'Bash', summary: 'pnpm test' }))
    await service.complete('session')
    expect(service.list('session').map((r) => r.id)).toEqual([review.id])
    expect(service.get(id).endSeq).toBe(1)
    const next = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(next, 'session')
    expect(service.get(next).startSeq).toBe(1)
  })
  it('reuses completed manual AI review results instead of spending tokens again', async () => {
    await service.reviewAi(review.id)
    await service.reviewAi(review.id)
    expect(analyze).toHaveBeenCalledTimes(1)
  })
  it('allows retry after a failed manual AI review', async () => {
    analyze.mockRejectedValueOnce(new Error('Provider unavailable'))
    expect((await service.reviewAi(review.id)).aiState).toBe('failed')
    expect((await service.reviewAi(review.id)).aiState).toBe('completed')
    expect(analyze).toHaveBeenCalledTimes(2)
  })
  it('captures added, modified and deleted files while excluding unchanged local edits', () => {
    expect(review.files.map((f) => [f.path, f.status]).sort()).toEqual([['added.txt', 'added'], ['changed.txt', 'modified'], ['deleted.txt', 'deleted']])
    expect(review.files.find((f) => f.path === 'changed.txt')?.oldContent).toContain('Pre-existing local edit')
    expect(readFileSync(join(cwd, 'unchanged.txt'), 'utf8')).toContain('User local edits')
  })
  it('automatically selects human comments and replies without sending them', () => {
    const comment = human().comments[0]!
    expect(comment).toMatchObject({ state: 'draft', readyToSend: true })
    const updated = service.reply(review.id, comment.id, 'Also keep the old behavior')
    expect(updated.comments[0]?.replies?.[0]?.state).toBe('draft'); expect(submit).not.toHaveBeenCalled()
    expect(service.get(review.id).comments[0]?.readyToSend).toBe(true)
  })
  it('excludes, resolves, and reopens without losing the discussion', () => {
    const comment = human().comments[0]!
    expect(service.select(review.id, [comment.id], false).comments[0]?.readyToSend).toBe(false)
    expect(service.resolveComment(review.id, comment.id).comments[0]).toMatchObject({ state: 'resolved', readyToSend: false })
    expect(service.reopenComment(review.id, comment.id).comments[0]).toMatchObject({ state: 'draft', readyToSend: true, text: 'Fix this line' })
  })
  it('sends selected threads together with their replies and before/after code', async () => {
    const first = human().comments[0]!; service.reply(review.id, first.id, 'Keep the first line')
    const second = human('Another comment').comments.at(-1)!
    await service.sendComments(review.id, [first.id, second.id])
    expect(submit).toHaveBeenCalledTimes(1)
    const prompt = submit.mock.calls[0]![1] as unknown as string
    expect(prompt).toContain('Original line'); expect(prompt).toContain('Agent change'); expect(prompt).toContain('Keep the first line')
    expect(prompt).toContain(first.id); expect(prompt).toContain(review.id)
    expect(service.get(review.id).comments.every((c) => c.state === 'sent' && !c.readyToSend)).toBe(true)
  })
  it('keeps a reply added during sending unsent and prevents duplicate dispatch', async () => {
    let release!: () => void
    submit.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const comment = human().comments[0]!
    const sending = service.sendComments(review.id, [comment.id])
    await expect(service.sendComments(review.id, [comment.id])).rejects.toThrow('already being sent')
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    service.reply(review.id, comment.id, 'New feedback while sending')
    release(); await sending
    expect(service.get(review.id).comments[0]).toMatchObject({ state: 'draft', readyToSend: true })
    expect(service.get(review.id).comments[0]?.replies?.[0]?.state).toBe('draft')
  })
  it('allows an AI reply and suggestion without silently resolving a human thread', () => {
    const comment = human().comments[0]!
    const updated = service.agentReply(review.id, comment.id, 'Fixed the line and checked the caller.', true)
    expect(updated.comments[0]?.state).toBe('draft')
    expect(updated.comments[0]?.resolutionSuggestion?.text).toContain('Fixed')
    expect(updated.comments[0]?.replies?.[0]?.author).toBe('ai')
    expect(updated.comments[0]?.text).toBe('Fix this line')
  })
  it('returns a sent discussion to sent after deleting its last unsent reply', async () => {
    const comment = human().comments[0]!; await service.sendComments(review.id, [comment.id])
    const reply = service.reply(review.id, comment.id, 'Temporary feedback').comments[0]!.replies![0]!
    expect(() => service.comment(review.id, { ...comment, text: 'Overwrite history' }, comment.id)).toThrow('Only unsent')
    expect(service.removeReply(review.id, comment.id, reply.id).comments[0]).toMatchObject({ state: 'sent', readyToSend: false, text: 'Fix this line' })
    service.resolveComment(review.id, comment.id)
    expect(() => service.removeComment(review.id, comment.id)).toThrow('marked resolved')
  })
  it('selects manual AI findings and notes by default without sending them', async () => {
    const file = review.files.find((f) => f.path === 'changed.txt')!
    analyze.mockResolvedValue({ message: JSON.stringify({ summary: 'Review finished', findings: [{ fileId: file.id, line: 2, severity: 'medium', text: 'Check this regression' }], notes: [{ fileId: file.id, scope: 'file', kind: 'question', text: 'Should this support older callers?' }] }) })
    const result = await service.reviewAi(review.id)
    expect(result.comments.map((c) => c.kind)).toEqual(['finding', 'question'])
    expect(result.comments.every((c) => c.readyToSend)).toBe(true)
    const question = result.comments[1]!
    expect(service.reply(review.id, question.id, 'Yes, keep compatibility').comments[1]?.readyToSend).toBe(true)
    expect(submit).not.toHaveBeenCalled()
  })
  it('validates line references and preserves sent replies', () => {
    expect(() => service.comment(review.id, { fileId: review.files[0]!.id, side: 'new', line: 999, endLine: 999, text: 'Invalid' })).toThrow('valid lines')
    const comment = human().comments[0]!; const result = service.agentReply(review.id, comment.id, 'Agent explanation')
    expect(() => service.reply(review.id, comment.id, 'Overwrite', result.comments[0]!.replies![0]!.id)).toThrow('Only unsent')
  })
  it('records human review decisions independently of discussion resolution', () => {
    const comment = human().comments[0]!
    expect(service.markReviewed(review.id, true).reviewedAt).toBeGreaterThan(0)
    expect(service.get(review.id).comments[0]?.state).toBe('draft')
    service.resolveComment(review.id, comment.id)
    expect(service.markReviewed(review.id, false).reviewedAt).toBeNull()
    expect(service.get(review.id).comments[0]?.state).toBe('resolved')
  })
  it('keeps AI replies simple and shows the follow-up changes as a separate revision', async () => {
    const comment = human().comments[0]!
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    const events = [
      { kind: 'tool-use', toolUseId: 'check', name: 'Bash', summary: 'pnpm test' },
      { kind: 'tool-result', toolUseId: 'check', isError: false, summary: '12 tests passed' },
      { kind: 'tool-use', toolUseId: 'missing', name: 'Bash', summary: 'pnpm build' },
    ]
    events.forEach((e, i) => db.prepare('INSERT INTO agent_events VALUES (?,?,?)').run('session', i + 1, JSON.stringify(e)))
    const replied = service.agentReply(review.id, comment.id, 'Fixed and checked', true)
    expect(replied.comments[0]?.replies?.[0]).toMatchObject({ author: 'ai', text: 'Fixed and checked' })
    expect(replied.comments[0]?.replies?.[0]).not.toHaveProperty('evidence')
    writeFileSync(join(cwd, 'changed.txt'), 'Fixed in follow-up\n')
    await service.complete('session')
    expect(service.list('session').map((r) => r.id)).toEqual([id, review.id])
    expect(service.get(review.id).files.find((f) => f.path === 'changed.txt')?.newContent).toContain('Agent change')
    expect(service.get(id).files[0]?.newContent).toContain('Fixed in follow-up')
    expect(service.get(review.id).comments[0]?.state).toBe('draft')
  })
  it('keeps results, notes and snapshots on the same run across follow-ups', async () => {
    const insert = db.prepare('INSERT INTO agent_events VALUES (?,?,?)')
    insert.run('session', 1, JSON.stringify({ kind: 'result', text: 'Earlier result', isError: false, costUsd: null }))
    await service.beforeFollowup('session')
    const firstId = (db.prepare("SELECT id FROM change_reviews WHERE state='recording'").get() as { id: string }).id
    insert.run('session', 2, JSON.stringify({ kind: 'user', text: 'First request' }))
    writeFileSync(join(cwd, 'changed.txt'), 'First run changes\n')
    insert.run('session', 3, JSON.stringify({ kind: 'result', text: 'First result', isError: false, costUsd: null }))
    await service.beforeFollowup('session')
    const nextId = (db.prepare("SELECT id FROM change_reviews WHERE state='recording'").get() as { id: string }).id
    insert.run('session', 4, JSON.stringify({ kind: 'user', text: 'Follow up' }))
    writeFileSync(join(cwd, 'changed.txt'), 'Follow-up changes\n')
    insert.run('session', 5, JSON.stringify({ kind: 'result', text: 'Second result', isError: false, costUsd: null }))
    await service.complete('session')
    const first = service.get(firstId), file = first.files[0]!
    const noted = service.agentNote(firstId, { fileId: file.id, side: 'new', line: 1, endLine: 1, scope: 'line', kind: 'note', text: 'Explains first result' })
    expect(noted.files[0]?.newContent).toBe('First run changes\n')
    expect(noted.comments[0]).toMatchObject({ text: 'Explains first result', readyToSend: true })
    expect(service.select(firstId, [noted.comments[0]!.id], false).comments[0]?.readyToSend).toBe(false)
    const next = service.get(nextId)
    expect(first).toMatchObject({ startSeq: 1, endSeq: 3 })
    expect(next).toMatchObject({ startSeq: 3, endSeq: 5, comments: [] })
    expect(next.files[0]?.newContent).toBe('Follow-up changes\n')
    const byTurn = reviewsByTurn([noted, next], 'session', [{ key: 2, sequences: [2, 3] }, { key: 4, sequences: [4, 5] }])
    expect([...byTurn].map(([key, rows]) => [key, rows.map((r) => r.id)])).toEqual([[2, [firstId]], [4, [nextId]]])
    expect(submit).not.toHaveBeenCalled()
  })
  it('preserves event boundaries across follow-ups', async () => {
    db.prepare('INSERT INTO agent_events VALUES (?,?,?)').run('session', 1, JSON.stringify({ kind: 'tool-use', toolUseId: 'old', name: 'Bash', summary: 'old command' }))
    const id = await service.begin(review.taskId, { cwd, covers: [cwd], additionalDirs: [] }); service.bind(id, 'session')
    db.prepare('INSERT INTO agent_events VALUES (?,?,?)').run('session', 2, JSON.stringify({ kind: 'tool-use', toolUseId: 'new', name: 'Bash', summary: 'pnpm test' }))
    db.prepare('INSERT INTO agent_events VALUES (?,?,?)').run('session', 3, JSON.stringify({ kind: 'tool-result', toolUseId: 'new', isError: true, summary: '1 test failed' }))
    await service.complete('session')
    expect(service.get(id)).toMatchObject({ startSeq: 1, endSeq: 3 })
  })
})
