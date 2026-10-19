import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NO_PROJECT, type Task } from '@ramu/shared/types'

const memory = () => {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size
    },
  }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('window', { ramu: { hostId: 'local' } })
})
afterEach(() => vi.unstubAllGlobals())

describe('storage by host', () => {
  it('gives the own host the same keys as before and another host its own namespace', async () => {
    const base = memory()
    vi.stubGlobal('localStorage', base)
    const { hostStorage, hostStorageFor } = await import('../src/hostStorage')
    hostStorageFor('local').setItem('ramu.unread', '["a"]')
    expect(hostStorage.getItem('ramu.unread')).toBe('["a"]')
    expect(base.data.get('host:local:ramu.unread')).toBe('["a"]')
    hostStorageFor('studio').setItem('ramu.unread', '["b"]')
    expect(base.data.get('host:studio:ramu.unread')).toBe('["b"]')
    expect(hostStorage.getItem('ramu.unread')).toBe('["a"]')
  })
})

describe('checkpoints by host', () => {
  it('registers under the window’s own host by default and lists every host that has one', async () => {
    const { registerWorkspaceCheckpoint, checkpointHosts, allWorkspaceCheckpoints } =
      await import('../src/workspace/workspaceCheckpoint')
    const own = async () => true,
      studio = async () => false
    const offOwn = registerWorkspaceCheckpoint(own)
    const offStudio = registerWorkspaceCheckpoint(studio, 'studio')
    expect(checkpointHosts()).toEqual(['local', 'studio'])
    expect(allWorkspaceCheckpoints()).toEqual([own, studio])
    offStudio()
    expect(checkpointHosts()).toEqual(['local'])
    offOwn()
    expect(allWorkspaceCheckpoints()).toEqual([])
  })
})

describe('workspace model', () => {
  it('shares a chat’s editors and terminals with its project or worktree, as one store did before', async () => {
    const { effectiveTaskUi, workspaceOfTask, projectCtx, worktreeCtx } =
      await import('../src/workspace/workspaceModel')
    const chat = { id: 'c', projectId: 'p' } as Task
    const isolated = { id: 'w', projectId: 'p', workspaceId: 'x' } as Task
    const loose = { id: 'n', projectId: NO_PROJECT } as Task
    expect(workspaceOfTask(chat)).toBe(projectCtx('p'))
    expect(workspaceOfTask(isolated)).toBe(worktreeCtx('x'))
    expect(workspaceOfTask(loose)).toBe('n')
    const agent = { id: 'a', kind: 'agent', sessionId: 's' } as never
    const file = { id: 'f', kind: 'file', repoId: 'r', path: 'x.ts' } as never
    const ui = effectiveTaskUi(
      [chat],
      {
        c: { views: [agent], activeViewId: null, activeAgentViewId: 'a' },
        'project:p': { views: [file], activeViewId: 'f', terminalOpen: true },
      },
      (ctx) => (ctx === 'c' ? 'project:p' : ctx),
    )
    expect(ui.c!.views.map((view) => view.id)).toEqual(['a', 'f'])
    expect(ui.c!.activeViewId).toBe('f')
    expect(ui.c!.terminalOpen).toBe(true)
  })
})
