import type { BranchChoice, WorkspaceChoice } from '@ramu/shared/workspaceDefaults'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import {
  AUTO_PROJECT,
  DEFAULT_AGENT_SETTINGS,
  NO_PROJECT,
  type FileContext,
  type AgentSettings,
} from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  projectOptions: [] as { value: string; label: string }[],
  prompt: 'Fix login',
  failMethod: '',
  openedTasks: [] as string[],
  returnedTo: [] as string[],
  route: { kind: 'unknown' } as Record<string, unknown>,
  setupFailed: false,
  consumed: 0,
  draftUnchanged: true,
  draftPersisted: true,
  model: null as AgentSettings | null,
  modelFailure: '',
  modelConsumed: 0,
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
  elsewhere: [] as { host: string; method: string; args: unknown[] }[],
  opened: [] as { host: string; taskId: string }[],
  workspaces: [] as { id: string; projectId: string; name: string }[],
  tasks: [] as { projectId: string; mode: 'current' | 'worktree'; status: string }[],
  buttons: [] as { children?: ReactNode; onClick?: () => void }[],
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (value: string, args: Record<string, string> = {}) =>
    value.replace(/\{(\w+)\}/g, (_, key: string) => args[key] ?? `{${key}}`),
}))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({ preferences: { autoProjectSelection: true } }),
}))
vi.mock('../src/models/ModelSets', () => ({
  useModelSets: () => ({ initialSettings: DEFAULT_AGENT_SETTINGS, catalogs: [] }),
  settingsNames: () => ({ model: '', effort: '' }),
}))
vi.mock('../src/settings/Usage', () => ({ useUsage: () => [] }))
vi.mock('../src/workspace/workspace', () => ({
  useHostRuntime: () => ({ on: () => () => {} }),
  useWorkspacesOf: () => [],
  useWorkspace: () => ({
    projects: [{ id: 'p', name: 'Project' }],
    repos: { p: [{ id: 'repo', name: 'Repo' }] },
    workspaces: state.workspaces,
    tasks: state.tasks,
    composing: 'p',
    composingWorkspace: null,
    refresh: async () => {},
    openTask(taskId: string) {
      state.openedTasks.push(taskId)
    },
    openView() {},
    newTask(projectId: string) {
      state.returnedTo.push(projectId)
    },
  }),
}))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({
    id: 'a',
    status: 'connected',
    invoke: async (method: string, ...args: unknown[]) => {
      state.calls.push({ method, args })
      if (method === state.failMethod) throw new Error('Delivery rejected')
      if (method === 'projects.route') return state.route
      if (method === 'tasks.workspaceOptions')
        return {
          defaultCheckoutMode: 'current',
          branchPrefix: 'ramu/',
          branchNaming: 'fixed',
          branchInstructions: '',
          worktreeUnavailable: null,
        }
      if (method === 'tasks.setup' && state.setupFailed) return [{ setupState: 'failed' }]
      return method === 'tasks.setup' ? [] : { id: method === 'agent.start' ? 'session' : 'created' }
    },
  }),
}))
vi.mock('../src/workspace/HostSelection', () => ({
  useHostSelection: () => ({
    activeHost: 'a',
    select: (host: string, destination: { taskId: string }) => state.opened.push({ host, taskId: destination.taskId }),
  }),
}))
vi.mock('../src/workspace/otherHostTargets', () => ({
  useOtherHostTargets: () => ({
    targets: new Map([['host0:jobs', { hostId: 'vps', projectId: 'jobs', name: 'Jobs', hostName: 'vps' }]]),
    candidates: [{ id: 'host0:jobs', name: 'Jobs', host: 'vps' }],
  }),
}))
vi.mock('../src/workspace/addProject', () => ({ useAddProject: () => ({ busy: false }) }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null, StatusDot: () => null }))
vi.mock('../src/composer/useWorkspaceDraft', () => ({ useWorkspaceDraft: () => state.draft }))
vi.mock('../src/composer/useAgentDraft', () => ({
  useAgentDraft: (_project: string, settings: unknown) => ({
    settings: state.model ?? settings,
    choice: { version: 1 },
    defaults: undefined,
    verify: async () => {
      if (state.modelFailure) throw Error(state.modelFailure)
      return state.model ?? settings
    },
    consume() {
      state.modelConsumed++
    },
  }),
}))
vi.mock('../src/composer/drafts', () => ({
  clearDraft() {},
  draftKey: { newChat: (id: string) => id },
  draftStore: () => null,
  loadDraft: () => state.prompt,
  useDraftPersistence: () => () => {
    state.consumed++
    return { unchanged: state.draftUnchanged, persisted: state.draftPersisted }
  },
}))
vi.mock('../src/hostStorage', () => ({ hostStorageFor: () => ({ getItem: () => null, setItem() {} }) }))
vi.mock('../src/ipc', () => ({
  ramu: {
    invokeOn: async (host: string, method: string, ...args: unknown[]) => {
      state.elsewhere.push({ host, method, args })
      return { taskId: 'far-thread', title: 'Fix login', projectName: 'Jobs' }
    },
  },
}))
vi.mock('../src/chat/Notifications', () => ({ notifyError() {} }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/Home', () => ({ HomeFeed: () => null }))
vi.mock('../src/Brand', () => ({ AnimatedMark: () => null }))
vi.mock('../src/views/agent/components/AgentHeader', () => ({ StartingAgentHeader: () => null }))
vi.mock('../src/views/agent/components/StartingThread', () => ({ StartingTranscript: () => null }))
vi.mock('../src/dataQueries', () => ({ ipcQueryKeyOn: (...key: unknown[]) => key }))
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
vi.mock('../src/Menu', () => ({ Menu: () => null }))
vi.mock('../src/components/combobox', () => ({
  Combobox: (props: { options: { value: string; label: string }[] }) => {
    state.projectOptions = props.options
    return null
  },
}))
vi.mock('../src/components/desktop-button', () => ({
  Button: (props: { children?: ReactNode; onClick?: () => void }) => {
    state.buttons.push(props)
    return createElement('button', null, props.children)
  },
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {}, setQueryData() {} }),
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
        : queryKey[0] === 'start-route'
          ? null
          : [],
  }),
}))
import { NewThread } from '../src/NewThread'
import { startingThreads } from '../src/workspace/startingThreads'

beforeEach(() => {
  state.openedTasks = []
  state.tasks = []
  state.buttons = []
  state.returnedTo = []
  state.prompt = 'Fix login'
  state.failMethod = ''
  state.route = { kind: 'unknown' }
  state.setupFailed = false
  state.consumed = 0
  state.draftUnchanged = true
  state.draftPersisted = true
  state.model = null
  state.modelFailure = ''
  state.modelConsumed = 0
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
const render = (projectId = 'p') => renderToStaticMarkup(createElement(NewThread, { projectId, onProjectChange() {} }))

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
  // The thread opened while its agent started; failing to start brings the person back to New thread and the draft.
  expect(state.openedTasks.length).toBeGreaterThan(0)
  expect(state.returnedTo).toEqual(['p'])
})

it('hands the opened thread its first message to draw until the host has it, and takes it back when starting fails', async () => {
  render()
  await state.composer!.onSubmit([])
  // The thread draws the message from the send to the host's copy; the thread view lets it go when that copy arrives.
  expect(startingThreads.get('created')).toMatchObject({ text: 'Fix login', attachments: [] })
  startingThreads.delete('created')

  state.failMethod = 'agent.start'
  render()
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Delivery rejected')
  expect(startingThreads.get('created')).toBeUndefined()
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

it('revalidates model defaults before allocating a thread and preserves the draft when they need review', async () => {
  state.modelFailure = 'Project model defaults changed. Review the model before sending.'
  render()
  await expect(state.composer!.onSubmit([])).rejects.toThrow('Project model defaults changed')
  expect(state.calls).toEqual([])
  expect(state.consumed).toBe(0)
  expect(state.modelConsumed).toBe(0)
  expect(state.prompt).toBe('Fix login')
})

it('starts with the reviewed effective model settings and consumes model intent only after successful delivery', async () => {
  state.model = {
    ...DEFAULT_AGENT_SETTINGS,
    provider: 'codex',
    model: 'reviewed-model',
    effort: 'high',
    access: 'edits',
  }
  render()
  await state.composer!.onSubmit([])
  expect(state.calls.find((call) => call.method === 'agent.start')!.args[2]).toEqual(state.model)
  expect(state.modelConsumed).toBe(1)
})

it('retains model intent when newer text survives a send acknowledgement or text persistence failed', async () => {
  state.model = { ...DEFAULT_AGENT_SETTINGS, provider: 'codex', model: 'keep-for-newer-draft' }
  state.draftUnchanged = false
  render()
  await state.composer!.onSubmit([])
  expect(state.modelConsumed).toBe(0)
  state.draftUnchanged = true
  state.draftPersisted = false
  render()
  await state.composer!.onSubmit([])
  expect(state.modelConsumed).toBe(0)
})

it('keeps Auto in the project picker once a project is selected', () => {
  render('p')
  expect(state.projectOptions.map((option) => option.value)).toContain(AUTO_PROJECT)
})

it('Auto creates the thread in the project the router resolved, without a speculative thread first', async () => {
  state.route = { kind: 'resolved', projectId: 'p', reason: 'Mentions “Project”', via: 'name' }
  render(AUTO_PROJECT)
  await state.composer!.onSubmit([])
  const methods = state.calls.map((call) => call.method)
  expect(methods.indexOf('projects.route')).toBeLessThan(methods.indexOf('tasks.create'))
  expect(state.calls.find((call) => call.method === 'tasks.create')?.args[0]).toMatchObject({
    projectId: 'p',
    mode: 'current',
  })
  expect(methods).toContain('agent.start')
})

it('Auto creates nothing and keeps the draft when the router cannot pick one project', async () => {
  for (const route of [
    { kind: 'ambiguous', candidates: [{ projectId: 'p', reason: 'x' }] },
    { kind: 'unknown' },
    { kind: 'unavailable', reason: 'ai-failed' },
  ]) {
    state.calls = []
    state.consumed = 0
    state.route = route
    render(AUTO_PROJECT)
    await state.composer!.onSubmit([])
    expect(state.calls.map((call) => call.method)).toEqual(['projects.route'])
    expect(state.consumed).toBe(0)
  }
})

it('Auto starts a request that belongs to a project on another host there, and opens it', async () => {
  state.route = { kind: 'resolved', projectId: 'host0:jobs', reason: 'Mentions “Jobs”', via: 'name' }
  state.elsewhere = []
  state.opened = []
  render(AUTO_PROJECT)
  await state.composer!.onSubmit([])
  const route = state.calls.find((call) => call.method === 'projects.route')
  expect(route?.args[2]).toEqual({ others: [{ id: 'host0:jobs', name: 'Jobs', host: 'vps' }], localHost: '' })
  expect(state.calls.some((call) => call.method === 'tasks.create')).toBe(false)
  expect(state.elsewhere).toEqual([
    {
      host: 'vps',
      method: 'threads.startInProject',
      args: [{ projectId: 'jobs', title: 'Fix login', prompt: 'Fix login' }, expect.anything()],
    },
  ])
  expect(state.opened).toEqual([{ host: 'vps', taskId: 'far-thread' }])
  expect(state.consumed).toBe(1)
})

it('Auto never sends a stale or missing destination to the server', async () => {
  state.route = { kind: 'resolved', projectId: 'gone', reason: 'Mentions “Gone”', via: 'name' }
  render(AUTO_PROJECT)
  await expect(state.composer!.onSubmit([])).rejects.toThrow('no longer available')
  expect(state.calls.some((call) => call.method === 'tasks.create')).toBe(false)
})

it('offers a new worktree when the default checkout already has a thread at work', () => {
  expect(render()).not.toContain('working in this checkout')
  state.tasks = [
    { projectId: 'p', mode: 'current', status: 'running' },
    { projectId: 'p', mode: 'worktree', status: 'running' },
  ]
  expect(render()).toContain('Another thread is working in this checkout.')
  state.buttons.find((button) => button.children === 'Use a new worktree')!.onClick!()
  expect(state.draft.choose).toHaveBeenCalledWith({ mode: 'worktree', branch: undefined })
})
