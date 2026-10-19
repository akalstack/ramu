import type { BranchChoice, WorkspaceChoice } from '@ramu/shared/workspaceDefaults'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type FileContext } from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  prompt: 'Fix login',
  failMethod: '',
  setupFailed: false,
  consumed: 0,
  draft: {
    choice: {
      mode: null as 'current' | 'worktree' | null,
      workspaceId: undefined as string | undefined,
      name: undefined as string | undefined,
    } as WorkspaceChoice,
    confirmed: true,
    problem: undefined as string | undefined,
    choose: vi.fn(),
    retry: vi.fn(),
  },
  editor: undefined as { choice?: BranchChoice; onChange: (choice?: BranchChoice) => void } | undefined,
  composer: undefined as { onSubmit: (context: FileContext[]) => Promise<void> } | undefined,
  calls: [] as { method: string; args: unknown[] }[],
  workspaces: [] as { id: string; projectId: string; name: string }[],
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (value: string, args: Record<string, string> = {}) =>
    value.replace(/\{(\w+)\}/g, (_, key: string) => args[key] ?? `{${key}}`),
}))
vi.mock('../src/models/ModelSets', () => ({ useModelSets: () => ({ initialSettings: DEFAULT_AGENT_SETTINGS }) }))
vi.mock('../src/workspace/workspace', () => ({
  useHostRuntime: () => ({ on: () => () => {} }),
  useWorkspace: () => ({
    projects: [{ id: 'p', name: 'Project' }],
    repos: { p: [{ id: 'repo', name: 'Repo' }] },
    workspaces: state.workspaces,
    composing: 'p',
    composingWorkspace: null,
    refresh: async () => {},
    openTask() {},
    openView() {},
  }),
}))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({
    id: 'a',
    status: 'connected',
    invoke: async (method: string, ...args: unknown[]) => {
      state.calls.push({ method, args })
      if (method === state.failMethod) throw new Error('Delivery rejected')
      if (method === 'tasks.setup' && state.setupFailed) return [{ setupState: 'failed' }]
      return method === 'tasks.setup' ? [] : { id: method === 'agent.start' ? 'session' : 'created' }
    },
  }),
}))
vi.mock('../src/workspace/HostSelection', () => ({ useHostSelection: () => ({ activeHost: 'a', select() {} }) }))
vi.mock('../src/workspace/addProject', () => ({ useAddProject: () => ({ busy: false }) }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null, StatusDot: () => null }))
vi.mock('../src/composer/useWorkspaceDraft', () => ({ useWorkspaceDraft: () => state.draft }))
vi.mock('../src/composer/drafts', () => ({
  clearDraft() {},
  draftKey: { newChat: (id: string) => id },
  draftStore: () => null,
  loadDraft: () => state.prompt,
  useDraftPersistence: () => () => {
    state.consumed++
    return { unchanged: true, persisted: true }
  },
}))
vi.mock('../src/hostStorage', () => ({ hostStorageFor: () => ({ getItem: () => null, setItem() {} }) }))
vi.mock('../src/ipc', () => ({ ramu: {} }))
vi.mock('../src/chat/Notifications', () => ({ notifyError() {} }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/Home', () => ({ HomeFeed: () => null }))
vi.mock('../src/Brand', () => ({ AnimatedMark: () => null }))
vi.mock('../src/chat/AgentControls', () => ({ AgentControls: () => null }))
vi.mock('../src/composer/Composer', () => ({
  Composer: (props: { onSubmit: (context: FileContext[]) => Promise<void> }) => {
    state.composer = props
    return null
  },
}))
vi.mock('../src/composer/ComposerTray', () => ({ ComposerTray: ({ children }: { children?: ReactNode }) => children }))
vi.mock('../src/workspace/BranchNameEditor', () => ({
  BranchNameEditor: (props: { choice?: BranchChoice; onChange: (choice?: BranchChoice) => void }) => {
    state.editor = props
    return null
  },
}))
vi.mock('../src/Menu', () => ({ Combobox: () => null, Menu: () => null }))
vi.mock('../src/components/desktop-button', () => ({
  Button: ({ children }: { children?: ReactNode }) => createElement('button', null, children),
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
  useQuery: ({ queryKey }: { queryKey: readonly unknown[] }) => ({
    data:
      queryKey[0] === 'workspace-options'
        ? {
            defaultCheckoutMode: 'current',
            branchPrefix: 'ramu/',
            branchNaming: 'fixed',
            branchInstructions: '',
            worktreeUnavailable: null,
          }
        : [],
  }),
}))
import { NewTask } from '../src/NewTask'

beforeEach(() => {
  state.prompt = 'Fix login'
  state.failMethod = ''
  state.setupFailed = false
  state.consumed = 0
  state.calls = []
  state.workspaces = []
  state.composer = undefined
  state.editor = undefined
  state.draft.choose.mockImplementation((choice: WorkspaceChoice) => {
    state.draft.choice = choice
  })
  state.draft.choice = { mode: null, workspaceId: undefined, name: undefined }
  state.draft.confirmed = true
  state.draft.problem = undefined
})
const render = (projectId = 'p') => renderToStaticMarkup(createElement(NewTask, { projectId, onProjectChange() {} }))

it('refuses creation until an unreadable draft workspace choice is reviewed', async () => {
  state.draft.confirmed = false
  state.draft.problem = 'storage'
  expect(render()).toContain('saved workspace choice could not be restored')
  await expect(state.composer!.onSubmit([])).rejects.toThrow('saved workspace choice could not be restored')
  expect(state.calls).toEqual([])
})

it('keeps a removed workspace visible and refuses to replace it with a new checkout', async () => {
  state.draft.choice = { mode: 'worktree', workspaceId: 'removed', name: 'Login' }
  state.workspaces = [{ id: 'removed', projectId: 'another-project', name: 'Login' }]
  expect(render()).toContain('Saved workspace is unavailable')
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Saved workspace is unavailable')
  expect(state.calls).toEqual([])
})

it('reuses the restored workspace ID and exact mode through the existing creation boundary', async () => {
  state.draft.choice = { mode: 'worktree', workspaceId: 'w', name: 'Login' }
  state.workspaces = [{ id: 'w', projectId: 'p', name: 'Login' }]
  render()
  await state.composer!.onSubmit([])
  expect(state.calls.find((call) => call.method === 'tasks.create')?.args[0]).toMatchObject({
    projectId: 'p',
    mode: 'worktree',
    workspaceId: 'w',
  })
  expect(state.calls.some((call) => call.method === 'agent.start')).toBe(true)
})

it('keeps no-project threads usable when workspace metadata storage is unavailable', async () => {
  state.draft.confirmed = false
  state.draft.problem = 'storage'
  render(NO_PROJECT)
  await state.composer!.onSubmit([])
  expect(state.calls.find((call) => call.method === 'tasks.create')?.args[0]).toMatchObject({
    projectId: NO_PROJECT,
    mode: 'current',
    workspaceId: undefined,
  })
})

it('retains the unsent snapshot and reports rejection when starting the agent fails', async () => {
  state.failMethod = 'agent.start'
  render()
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Delivery rejected')
  expect(state.consumed).toBe(0)
  expect(state.calls.some((call) => call.method === 'tasks.delete')).toBe(true)
})

it('does not acknowledge a send when worktree setup failed and retains the workspace for recovery', async () => {
  state.draft.choice.mode = 'worktree'
  state.setupFailed = true
  render()
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Your message has not been sent')
  expect(state.consumed).toBe(0)
  expect(state.calls.some((call) => call.method === 'tasks.delete' || call.method === 'agent.start')).toBe(false)
})

it('supports a deliberate file-only first message through the existing context boundary', async () => {
  state.prompt = ''
  const context: FileContext[] = [{ repoId: 'repo', path: 'src/login.ts', source: 'mention' }]
  render()
  await state.composer!.onSubmit(context)
  expect(state.calls.find((call) => call.method === 'tasks.create')?.args[0]).toMatchObject({
    title: 'Discuss login.ts',
  })
  expect(state.calls.find((call) => call.method === 'agent.start')?.args.at(-1)).toEqual(context)
  expect(state.consumed).toBe(1)
})

it('restores branch edits and saves new candidates with their naming request before submission', async () => {
  state.draft.choice = {
    mode: 'worktree',
    branch: {
      title: 'Earlier request',
      intent: { strategy: 'semantic', instructions: '', prompt: 'Earlier request' },
      choice: { name: 'mine/login', source: 'manual' },
    },
  }
  render()
  expect(state.editor?.choice?.name).toBe('mine/login')
  state.editor!.onChange({ name: 'manual/reviewed', source: 'manual' })
  expect(state.draft.choice.branch).toEqual({
    title: 'Fix login',
    intent: { strategy: 'fixed', instructions: '', prompt: 'Fix login' },
    choice: { name: 'manual/reviewed', source: 'manual' },
  })
  render()
  await state.composer!.onSubmit([])
  expect(state.calls.find((call) => call.method === 'tasks.create')?.args[0]).toMatchObject({
    branchChoice: { name: 'manual/reviewed', source: 'manual' },
  })
})

it('expires a generated snapshot with changed request inputs and preserves invalid manual edits for correction', async () => {
  state.draft.choice = {
    mode: 'worktree',
    branch: {
      title: 'Earlier request',
      intent: { strategy: 'fixed', instructions: '', prompt: 'Earlier request' },
      choice: { name: 'old/generated', source: 'generated' },
    },
  }
  render()
  expect(state.editor?.choice).toBeUndefined()
  state.editor!.onChange({ name: 'unfinished/', source: 'manual' })
  render()
  expect(state.editor?.choice?.name).toBe('unfinished/')
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Invalid Git branch name')
  expect(state.calls).toEqual([])
  state.editor!.onChange(undefined)
  render()
  expect(state.draft.choice.branch).toBeUndefined()
  await state.composer!.onSubmit([])
  expect(state.calls.some((call) => call.method === 'tasks.create')).toBe(true)
})
