import { expect, it, vi } from 'vitest'
import { DEFAULT_APP_PREFERENCES } from '@ramu/shared/types'
import type { HandlerContext } from '../src/ipc/types'
import { registerWorkspaceHandlers } from '../src/ipc/handlers/workspace'
const intent = { strategy: 'semantic', instructions: '', prompt: 'Fix login' }
it('uses isolated, bounded, non-deferred analysis and the host maintenance model', async () => {
  const analyze = vi.fn(async () => ({ message: 'fix/login' }))
  const methods = registerWorkspaceHandlers({
    workspace: { getAppState: () => null, worktreeUnavailable: async () => null },
    agents: { analyze },
    loadPreferences: () => ({
      ...DEFAULT_APP_PREFERENCES,
      intelligence: {
        ...DEFAULT_APP_PREFERENCES.intelligence,
        maintenanceModel: { provider: 'codex', model: 'chosen', effort: null },
      },
    }),
  } as unknown as HandlerContext)
  expect(await methods['tasks.generateBranch']!.run('project', 'Login', intent)).toEqual({
    name: 'fix/login',
    source: 'generated',
  })
  expect(analyze).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ provider: 'codex', model: 'chosen' }),
    400,
    expect.objectContaining({ timeoutMs: 15000, defer: false, signal: expect.any(AbortSignal) }),
  )
  expect(
    methods['tasks.create']!.args.safeParse([
      {
        projectId: 'project',
        title: 'Login',
        mode: 'worktree',
        branchNaming: intent,
        branchChoice: { name: '../bad', source: 'manual' },
      },
    ]).success,
  ).toBe(false)
})
it('registers cancellation before async project validation and never creates workspaces for generation', async () => {
  let validate!: (reason: null) => void
  const analyze = vi.fn()
  const createTask = vi.fn()
  const methods = registerWorkspaceHandlers({
    workspace: {
      getAppState: () => null,
      createTask,
      worktreeUnavailable: () =>
        new Promise((resolve) => {
          validate = resolve
        }),
    },
    agents: { analyze },
    loadPreferences: () => DEFAULT_APP_PREFERENCES,
  } as unknown as HandlerContext)
  const request = 'b73d4a3d-df8d-4c96-9b47-b34a5db4734f'
  const pending = methods['tasks.generateBranch']!.run('project', 'Login', intent, request)
  methods['tasks.cancelBranch']!.run(request)
  validate(null)
  expect(await pending).toEqual({ name: 'ramu/login', source: 'fallback' })
  expect(analyze).not.toHaveBeenCalled()
  expect(createTask).not.toHaveBeenCalled()
})
it('names a branch set to Same as thread with the model and login the new thread will run on', async () => {
  const analyze = vi.fn(async () => ({ message: 'fix/login' }))
  const methods = registerWorkspaceHandlers({
    workspace: { getAppState: () => null, worktreeUnavailable: async () => null },
    agents: { analyze },
    loadPreferences: () => ({
      ...DEFAULT_APP_PREFERENCES,
      intelligence: { ...DEFAULT_APP_PREFERENCES.intelligence, maintenanceModel: { use: 'thread' } },
    }),
  } as unknown as HandlerContext)
  const thread = { provider: 'codex', model: 'gpt-thread', effort: 'low', accountId: 'work' }
  const args = methods['tasks.generateBranch']!.args.parse(['project', 'Login', intent, undefined, thread])
  await methods['tasks.generateBranch']!.run(...args)
  expect(analyze).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ provider: 'codex', model: 'gpt-thread', effort: 'low', accountId: 'work' }),
    400,
    expect.anything(),
  )
  expect(
    methods['tasks.generateBranch']!.args.safeParse(['project', 'Login', intent, undefined, { provider: 'other' }])
      .success,
  ).toBe(false)
})
