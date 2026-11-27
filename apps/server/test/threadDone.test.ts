import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { NO_PROJECT } from '@ramu/shared/types'
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
})
const until = async (check: () => boolean) => {
  const end = Date.now() + 8000
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

it('gives back what a thread holds when it is marked done, and leaves other threads alone', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ramu-done-'))
  const db = openDb(join(directory, 'test.sqlite'))
  const workspace = new Workspace(db, join(directory, 'worktrees'))
  const task = await workspace.createTask({ projectId: NO_PROJECT, title: 'Finished', mode: 'current' })
  const other = await workspace.createTask({ projectId: NO_PROJECT, title: 'Still going', mode: 'current' })
  const terminals = new TerminalService(
    () => {},
    () => {},
    () => {},
    new SqliteBackgroundTerminalHistory(db),
  )
  cleanups.push(() => {
    terminals.closeAll()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  })
  const agents = {
    list: vi.fn(() => [
      { id: 'main', state: 'idle' },
      { id: 'helper', parentId: 'main', state: 'running' },
      { id: 'finished-helper', parentId: 'main', state: 'idle' },
    ]),
    holdThread: vi.fn(),
    stopAndWait: vi.fn(async () => {}),
  }
  const computer = { revoke: vi.fn(), session: vi.fn(() => null) }
  const testDevices = { releaseThread: vi.fn(async () => {}) }
  const watchers = { release: vi.fn() }
  const browser = {
    isReady: () => true,
    view: vi.fn(async (_thread: string, command: { kind: string }) =>
      command.kind === 'list' ? [{ id: 'tab-1' }, { id: 'tab-2' }] : undefined,
    ),
  }
  const hostBrowser = { closeThread: vi.fn(), threadTabs: vi.fn(() => 1) }
  const agentItem = { kind: 'agent' as const, id: 'main', name: 'Agent' }
  // One server the agent left behind with nohup, and a Gradle daemon on two ports, which is not asked about.
  const servers = {
    list: vi.fn(async () => [
      { pid: 41, port: 3000, owner: agentItem, orphaned: false },
      { pid: 42, port: 17038, owner: agentItem, orphaned: false, daemon: 'Gradle daemon' },
      { pid: 42, port: 17039, owner: agentItem, orphaned: false, daemon: 'Gradle daemon' },
    ]),
    release: vi.fn(async () => 2),
  }
  const table = registerWorkspaceHandlers({
    workspace,
    terminals,
    agents,
    lock: new KeyedLock(),
    host: {},
    watchers,
    computer,
    testDevices,
    browser,
    hostBrowser,
    servers,
  } as unknown as HandlerContext)
  const server = terminals.launchBackground(task.id, null, tmpdir(), 'sleep 300')
  const unrelated = terminals.launchBackground(other.id, null, tmpdir(), 'sleep 300')

  // Tabs in the host's own browser count and close as well as the attached desktop's.
  expect(await table['tasks.doneImpact']!.run(task.id)).toMatchObject({ browserTabs: 3, servers: 1 })
  browser.view.mockClear()

  const done = table['tasks.done']!
  done.run(...done.args.parse([task.id, true]))

  expect(agents.holdThread).toHaveBeenCalledWith(task.id)
  expect(agents.stopAndWait.mock.calls).toEqual([['helper']])
  expect(computer.revoke).toHaveBeenCalledWith(task.id)
  expect(testDevices.releaseThread).toHaveBeenCalledWith(task.id)
  expect(watchers.release).toHaveBeenCalledWith(task.id)
  expect(hostBrowser.closeThread).toHaveBeenCalledWith(task.id)
  expect(servers.release).toHaveBeenCalledWith(task.id)
  await until(() => browser.view.mock.calls.length === 3)
  expect(browser.view.mock.calls.slice(1).map(([, command]) => command)).toEqual([
    { kind: 'close', tabId: 'tab-1' },
    { kind: 'close', tabId: 'tab-2' },
  ])
  await until(() => terminals.inspectBackground(task.id, server.id).state !== 'running')
  expect(terminals.inspectBackground(other.id, unrelated.id).state).toBe('running')

  // Reopening gives nothing back by itself: the work starts what it needs again.
  agents.stopAndWait.mockClear()
  done.run(...done.args.parse([task.id, false]))
  expect(agents.stopAndWait).not.toHaveBeenCalled()
})
