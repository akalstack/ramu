import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { ReviewService } from '../src/review/reviews'
import type { AgentService } from '../src/agent'
import { NO_PROJECT, type AgentEvent } from '@ramu/shared/types'

let db: Db, dir: string, cwd: string, reviews: ReviewService
const tasks: Record<string, string> = {}
const clashes: { sessionId: string; path: string; taskId: string }[] = []
const edit = (toolUseId: string, file: string): AgentEvent => ({
  kind: 'tool-use',
  toolUseId,
  name: 'Write',
  summary: file,
  input: JSON.stringify({ file_path: file, content: '' }),
})

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ramu-shared-checkout-'))
  db = openDb(':memory:')
  const workspace = new Workspace(db, join(dir, 'worktrees'))
  for (const session of ['a', 'b']) {
    const task = await workspace.createTask({ projectId: NO_PROJECT, title: `Thread ${session}`, mode: 'current' })
    tasks[session] = task.id
  }
  cwd = workspace.agentScope(tasks.a!).cwd
  clashes.length = 0
  const agents = {
    get: (id: string) => ({ id, taskId: tasks[id], cwd, covers: [cwd], additionalDirs: [] }),
    rootOf: (id: string) => id,
    writing: () => false,
    events: () => [],
    withWorkspaceReservation: async (_covers: string[], action: () => Promise<unknown>) => action(),
    recordCheckoutClash: (sessionId: string, path: string, taskId: string) => clashes.push({ sessionId, path, taskId }),
  } as unknown as AgentService
  reviews = new ReviewService(db, workspace, agents, join(dir, 'reviews'), () => {})
  writeFileSync(join(cwd, 'shared.txt'), 'start\n')
})
afterEach(() => {
  reviews.stop()
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

const open = async (session: 'a' | 'b') => {
  const id = await reviews.begin(tasks[session]!, { cwd, additionalDirs: [], covers: [cwd] })
  reviews.bind(id, session)
  return id
}

it('gives each of two threads working in one checkout only what it wrote, and keeps a shared file out of undo', async () => {
  const first = await open('a')
  const second = await open('b')
  reviews.observe('a', edit('1', join(cwd, 'a.txt')))
  writeFileSync(join(cwd, 'a.txt'), 'from a\n')
  reviews.observe('b', edit('2', 'b.txt'))
  writeFileSync(join(cwd, 'b.txt'), 'from b\n')
  reviews.observe('a', edit('3', 'shared.txt'))
  reviews.observe('b', edit('4', 'shared.txt'))
  writeFileSync(join(cwd, 'shared.txt'), 'start\nfrom a\nfrom b\n')
  // Each thread is told once that the other edits the same file.
  expect(clashes).toEqual([
    { sessionId: 'b', path: join(cwd, 'shared.txt'), taskId: tasks.a },
    { sessionId: 'a', path: join(cwd, 'shared.txt'), taskId: tasks.b },
  ])

  await reviews.complete('a')
  const mine = reviews.get(first)
  expect(mine.files.map((file) => [file.path, file.sharedWith]).sort()).toEqual([
    ['a.txt', undefined],
    ['shared.txt', [tasks.b]],
  ])
  expect(mine.elsewhere).toEqual([{ taskId: tasks.b, files: [expect.objectContaining({ path: 'b.txt' })] }])

  const preview = await reviews.undoPreview(first)
  expect(Object.fromEntries(preview.files.map((file) => [file.path, file.status]))).toEqual({
    'a.txt': 'ready',
    'shared.txt': 'unavailable',
  })
  await reviews.undoApply(
    preview.token,
    preview.files.filter((file) => file.status === 'ready').map((file) => file.fileId),
  )
  expect(existsSync(join(cwd, 'a.txt'))).toBe(false)
  // Undoing a's turn leaves b's file and the file both changed as they are.
  expect(readFileSync(join(cwd, 'b.txt'), 'utf8')).toBe('from b\n')
  expect(readFileSync(join(cwd, 'shared.txt'), 'utf8')).toBe('start\nfrom a\nfrom b\n')

  await reviews.complete('b')
  expect(
    reviews
      .get(second)
      .files.map((file) => file.path)
      .sort(),
  ).toEqual(['b.txt', 'shared.txt'])
})

it('keeps a turn that had the checkout to itself whole', async () => {
  const only = await open('a')
  writeFileSync(join(cwd, 'by-hand.txt'), 'edited\n')
  await reviews.complete('a')
  expect(reviews.get(only).files.map((file) => file.path)).toEqual(['by-hand.txt'])
  expect(reviews.get(only).elsewhere).toBeUndefined()
})

it('lets the person add a file set apart as someone else’s to this turn, which undo then covers', async () => {
  const first = await open('a')
  await open('b')
  // Written while both turns were open, by no tool either thread reported: nobody can say whose it is.
  reviews.observe('b', edit('1', 'b.txt'))
  writeFileSync(join(cwd, 'b.txt'), 'from b\n')
  writeFileSync(join(cwd, 'mystery.txt'), 'who wrote this?\n')
  await new Promise((resolve) => setTimeout(resolve, 300))
  await reviews.complete('a')
  const before = reviews.get(first)
  const outside = before.elsewhere?.find((group) => !group.taskId)
  expect(outside?.files.map((file) => file.path)).toEqual(['mystery.txt'])
  const claimed = reviews.claimElsewhere(
    first,
    outside!.files.map((file) => file.id),
  )
  expect(claimed.files.map((file) => file.path)).toContain('mystery.txt')
  expect(claimed.elsewhere?.map((group) => group.taskId)).toEqual([tasks.b])
  const preview = await reviews.undoPreview(first)
  expect(preview.files.find((file) => file.path === 'mystery.txt')?.status).toBe('ready')
})

it('leaves a file the person saved during the turn out of undo', async () => {
  const only = await open('a')
  reviews.observe('a', edit('1', 'shared.txt'))
  reviews.personWrote(join(cwd, 'shared.txt'))
  writeFileSync(join(cwd, 'shared.txt'), 'agent and person\n')
  await reviews.complete('a')
  expect(reviews.get(only).files[0]).toMatchObject({ path: 'shared.txt', editedByYou: true })
  const preview = await reviews.undoPreview(only)
  expect(preview.files[0]).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('You also edited') })
})

it('names the changed files another thread wrote last, so a commit from this thread leaves them out', async () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })
  git('init', '-q')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A')
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'start')
  await open('a')
  await open('b')
  reviews.observe('a', edit('1', 'a.txt'))
  writeFileSync(join(cwd, 'a.txt'), 'from a\n')
  reviews.observe('b', edit('2', 'b.txt'))
  writeFileSync(join(cwd, 'b.txt'), 'from b\n')
  writeFileSync(join(cwd, 'by-hand.txt'), 'nobody’s turn\n')
  // File events arrive a moment after the write.
  await new Promise((resolve) => setTimeout(resolve, 300))
  await reviews.complete('a')
  await reviews.complete('b')
  expect(await reviews.otherThreadPaths(tasks.a!, cwd)).toEqual(['b.txt'])
  expect(await reviews.otherThreadPaths(tasks.b!, cwd)).toEqual(['a.txt'])
})
