import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NO_PROJECT } from '@ramu/shared/types'
import { removalReview, type TaskRemovalReview } from '@ramu/shared/chat/taskRemoval'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { TerminalService } from '../src/workspace/pty'
import { SqliteBackgroundTerminalHistory } from '../src/workspace/backgroundTerminalHistory'
import { registerWorkspaceHandlers } from '../src/ipc/handlers/workspace'
import { KeyedLock } from '../src/ipc/keyedLock'
import type { HandlerContext } from '../src/ipc/types'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const close of cleanups.splice(0).reverse()) close()
  vi.restoreAllMocks()
})
const until = async (check: () => boolean) => {
  const end = Date.now() + 8000
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-removal-'))
  const db = openDb(join(directory, 'test.sqlite'))
  const workspace = new Workspace(db, join(directory, 'worktrees'))
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Owned command', mode: 'current' })
  const other = await workspace.createTask({ projectId: NO_PROJECT, title: 'Other command', mode: 'current' })
  let terminals = new TerminalService(
    () => {},
    () => {},
    () => {},
    new SqliteBackgroundTerminalHistory(db),
  )
  const agents = { list: vi.fn(() => [] as { id: string }[]), stopAndWait: vi.fn(async (_id: string) => {}) }
  const lock = new KeyedLock()
  const table = () =>
    registerWorkspaceHandlers({
      workspace,
      terminals,
      agents,
      lock,
      host: {},
      watchers: { release() {} },
    } as unknown as HandlerContext)
  const remove = (removeWorktrees = false, review?: TaskRemovalReview) => {
    const method = table()['tasks.delete']!
    return method.run(
      ...method.args.parse(review ? [task.id, removeWorktrees, review] : [task.id, removeWorktrees]),
    ) as Promise<void>
  }
  cleanups.push(() => {
    terminals.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  return {
    workspace,
    task,
    other,
    agents,
    remove,
    get terminals() {
      return terminals
    },
    restart() {
      terminals.closeAll()
      terminals = new TerminalService(
        () => {},
        () => {},
        () => {},
        new SqliteBackgroundTerminalHistory(db),
      )
    },
  }
}

it.skipIf(process.platform === 'win32')(
  'requires review before stopping agents or commands and rejects a command added after review',
  async () => {
    const f = await fixture()
    const first = f.terminals.launchBackground(f.task.id, null, tmpdir(), 'sleep 300')
    await expect(f.remove()).rejects.toThrow(/need review/)
    expect(f.agents.stopAndWait).not.toHaveBeenCalled()
    expect(f.terminals.inspectBackground(f.task.id, first.id).state).toBe('running')
    const review = removalReview(f.terminals.listBackground(f.task.id))
    const next = f.terminals.launchBackground(f.task.id, null, tmpdir(), 'echo later; sleep 300')
    await expect(f.remove(false, review)).rejects.toThrow(/changed or need review/)
    expect(f.terminals.inspectBackground(f.task.id, next.id).state).toBe('running')
    expect(f.workspace.getTask(f.task.id).id).toBe(f.task.id)
  },
)

it.skipIf(process.platform === 'win32')(
  'stops reviewed commands before deleting their owner and leaves another thread running',
  async () => {
    const f = await fixture()
    f.terminals.launchBackground(f.task.id, null, tmpdir(), 'sleep 300')
    const other = f.terminals.launchBackground(f.other.id, null, tmpdir(), 'sleep 300')
    await f.remove(false, removalReview(f.terminals.listBackground(f.task.id)))
    expect(() => f.workspace.getTask(f.task.id)).toThrow()
    expect(f.terminals.listBackground(f.task.id)).toEqual([])
    expect(f.terminals.inspectBackground(f.other.id, other.id).state).toBe('running')
  },
)

it.skipIf(process.platform === 'win32')(
  'keeps the thread and its output when graceful stop does not finish, then allows a reviewed retry',
  async () => {
    const f = await fixture()
    const command = f.terminals.launchBackground(
      f.task.id,
      null,
      tmpdir(),
      "trap '' TERM; echo armed; while true; do sleep 1; done",
    )
    await until(() => f.terminals.inspectBackground(f.task.id, command.id).output.includes('armed'))
    const review = removalReview(f.terminals.listBackground(f.task.id))
    await expect(f.remove(false, review)).rejects.toThrow(/still stopping/)
    expect(f.workspace.getTask(f.task.id).id).toBe(f.task.id)
    expect(f.terminals.inspectBackground(f.task.id, command.id).output).toContain('armed')
    f.terminals.stopBackground(f.task.id, command.id, true)
    await until(() => f.terminals.inspectBackground(f.task.id, command.id).state === 'exited')
    await f.remove(false, review)
    expect(() => f.workspace.getTask(f.task.id)).toThrow()
  },
)

it.skipIf(process.platform === 'win32')(
  'blocks new launches while agents stop and releases the lifecycle guard afterward',
  async () => {
    const f = await fixture()
    const command = f.terminals.launchBackground(f.task.id, null, tmpdir(), 'sleep 300')
    let release!: () => void
    f.agents.list.mockReturnValue([{ id: 'session' }])
    f.agents.stopAndWait.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const pending = f.remove(false, removalReview(f.terminals.listBackground(f.task.id)))
    await until(() => !!release)
    expect(() => f.terminals.launchBackground(f.task.id, null, tmpdir(), 'echo must-not-start')).toThrow(
      /being deleted/,
    )
    expect(() => f.terminals.open(f.task.id, null, tmpdir())).toThrow(/being deleted/)
    expect(f.terminals.inspectBackground(f.task.id, command.id).state).toBe('running')
    release()
    await pending
    expect(() => f.terminals.assertTaskAvailable(f.task.id)).not.toThrow()
  },
)

it.skipIf(process.platform === 'win32')(
  'requires explicit unknown-record acknowledgement and keeps files instead of targeting stale processes',
  async () => {
    const f = await fixture()
    f.terminals.launchBackground(f.task.id, null, tmpdir(), 'sleep 300')
    f.restart()
    const commands = f.terminals.listBackground(f.task.id)
    expect(commands[0]!.state).toBe('unknown')
    await expect(f.remove(false, { backgroundIds: commands.map((command) => command.id) })).rejects.toThrow(
      /Commands with unknown status cannot be stopped/,
    )
    await expect(f.remove(true, removalReview(commands))).rejects.toThrow(/Keep the worktree/)
    expect(f.workspace.getTask(f.task.id).id).toBe(f.task.id)
    const kill = vi.spyOn(process, 'kill')
    await f.remove(false, removalReview(commands))
    expect(kill).not.toHaveBeenCalled()
    expect(() => f.workspace.getTask(f.task.id)).toThrow()
  },
)

it('retains the legacy two-argument deletion for threads without unsettled managed commands', async () => {
  const f = await fixture()
  await f.remove()
  expect(() => f.workspace.getTask(f.task.id)).toThrow()
})

it.skipIf(process.platform === 'win32')(
  'preserves final command output when removal fails after stopping, then permits retry',
  async () => {
    const f = await fixture()
    const command = f.terminals.launchBackground(f.task.id, null, tmpdir(), 'echo retained-output; sleep 300')
    await until(() => f.terminals.inspectBackground(f.task.id, command.id).output.includes('retained-output'))
    const review = removalReview(f.terminals.listBackground(f.task.id))
    const remove = vi
      .spyOn(f.workspace, 'deleteTask')
      .mockRejectedValueOnce(new Error('Worktree has uncommitted changes'))
    await expect(f.remove(false, review)).rejects.toThrow(/uncommitted changes/)
    expect(f.workspace.getTask(f.task.id).id).toBe(f.task.id)
    expect(f.terminals.inspectBackground(f.task.id, command.id)).toMatchObject({
      state: 'exited',
      output: expect.stringContaining('retained-output'),
    })
    remove.mockRestore()
    await f.remove(false, review)
    expect(f.terminals.listBackground(f.task.id)).toEqual([])
  },
)
