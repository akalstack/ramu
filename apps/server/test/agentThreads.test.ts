import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentSessionInfo, AgentSettings } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import type { AgentService } from '../src/agent'
import {
  AgentThreadService,
  briefOf,
  MAX_MESSAGES_PER_HOUR,
  MAX_THREADS_PER_HOUR,
} from '../src/background/agentThreads'
import { PENDING_MS, REMOTE_POLL_MS, RemoteThreads, type RemoteRequest } from '../src/background/remoteThreads'
import type { AgentHostService } from '../src/remote/agentHosts'
import type { DeviceInfo } from '../src/remote/devices'
import { startedGroups } from '@ramu/shared/workspace/startedGroups'

type Handler = (
  input: Record<string, unknown>,
  extra: { signal: AbortSignal },
) => Promise<{
  isError?: boolean
  content: { text: string }[]
}>

let db: Db, ws: Workspace, service: AgentThreadService
let sessions: Map<string, AgentSessionInfo>
let events: Map<string, AgentEvent[]>
let approvals: boolean[], permissionDetails: string[]
let submitted: { id: string; text: string; mode: string }[]
let recorded: { id: string; threads: unknown[] }[]
let calls: string[]
let api: Project, web: Project, apiRoot: string
let remote: RemoteThreads
let hostCalls: { id: string; method: string; args: unknown[]; key?: string }[]
let hostFails: Error | null
let remoteStatus: Record<string, unknown> = { state: 'running', threadId: 'far-1', title: 'Remote', project: 'jobs' }

type Project = Awaited<ReturnType<Workspace['addProjectFromFolder']>>['project']

const session = (id: string, taskId: string, settings: Partial<AgentSettings> = {}): AgentSessionInfo => {
  const info = {
    id,
    taskId,
    state: 'running',
    parentId: null,
    settings: { ...DEFAULT_AGENT_SETTINGS, ...settings },
    covers: [],
  } as unknown as AgentSessionInfo
  sessions.set(id, info)
  events.set(id, [{ kind: 'user', text: 'Add dueDate to the API' } as AgentEvent])
  return info
}

const tools = (sessionId: string) => {
  const registered: Record<string, Handler> = {}
  service.register(
    { registerTool: (name: string, _def: unknown, handler: Handler) => (registered[name] = handler) } as never,
    sessionId,
  )
  const call = async (name: string, input: Record<string, unknown>) => {
    const out = await registered[name]!(input, { signal: new AbortController().signal })
    if (out.isError) throw new Error(out.content[0]!.text)
    return JSON.parse(out.content[0]!.text)
  }
  return { registered, call }
}

beforeEach(async () => {
  db = openDb(':memory:')
  ws = new Workspace(db, '/tmp/ramu-agent-threads-test')
  sessions = new Map()
  events = new Map()
  approvals = []
  permissionDetails = []
  submitted = []
  recorded = []
  calls = []
  const root = mkdtempSync(join(tmpdir(), 'ramu-agent-threads-'))
  for (const name of ['api', 'web']) mkdirSync(join(root, name))
  apiRoot = join(root, 'api')
  const run = (...args: string[]) => execFileSync('git', args, { cwd: apiRoot })
  run('init', '-q', '-b', 'main')
  writeFileSync(join(apiRoot, 'schema.ts'), 'export const fields = []\n')
  run('add', '.')
  run('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init')
  api = (await ws.addProjectFromFolder(join(root, 'api'))).project
  web = (await ws.addProjectFromFolder(join(root, 'web'))).project
  let started = 0
  const agents = {
    get: (id: string) => {
      const found = sessions.get(id)
      if (!found) throw new Error(`Unknown session ${id}`)
      return found
    },
    list: (taskId: string) => [...sessions.values()].filter((s) => s.taskId === taskId),
    events: (id: string) => events.get(id) ?? [],
    requestPermission: vi.fn(async (_id: string, _tool: string, detail: string) => {
      permissionDetails.push(detail)
      return approvals.shift() ?? false
    }),
    threadsStarted: (id: string, threads: unknown[]) => recorded.push({ id, threads }),
    submit: vi.fn(async (id: string, text: string, mode: string) => {
      submitted.push({ id, text, mode })
    }),
    analyze: vi.fn(async () => ({ message: '{"projectIds":[],"reason":""}' })),
    validateSettings: vi.fn(async (settings: AgentSettings) => {
      if (settings.provider === 'cursor') throw new Error('Not installed here')
    }),
    isRecoveryPending: () => false,
    providerWait: () => null,
    autoResumeOf: () => true,
    getGoal: () => null,
    queued: () => [],
  } as unknown as AgentService
  const invoke = async (method: string, args: unknown[]) => {
    calls.push(method)
    if (method === 'tasks.workspaceOptions') return { defaultCheckoutMode: 'current', worktreeUnavailable: null }
    if (method === 'tasks.create') return ws.createTask(args[0] as Parameters<Workspace['createTask']>[0])
    if (method === 'tasks.setup') return ws.setupTask(args[0] as string)
    if (method === 'tasks.rename') return ws.renameTask(args[0] as string, args[1] as string)
    if (method === 'settings.models.get')
      return {
        defaultSetId: 's',
        defaultStepId: 'b',
        sets: [{ id: 's', steps: [{ id: 'b', provider: 'codex', model: 'gpt-5.5', effort: 'high' }] }],
      }
    if (method === 'settings.app.get') return { defaultAutoFallback: true }
    if (method === 'agent.start') {
      const [taskId, prompt, settings] = args as [string, string, AgentSettings]
      const info = session(`started-${++started}`, taskId, settings)
      events.set(info.id, [{ kind: 'user', text: prompt } as AgentEvent])
      return info
    }
    throw new Error(`Unexpected ${method}`)
  }
  hostCalls = []
  hostFails = null
  const hosts = {
    list: () => [{ id: 'h1', name: 'vps', address: 'http://vps', deviceId: 'd1', expiresAt: null, addedAt: 1 }],
    find: (named: string) => (named === 'vps' ? hosts.list()[0]! : null),
    renew: async () => {},
    invoke: async (id: string, method: string, args: unknown[], key?: string) => {
      hostCalls.push({ id, method, args, key })
      if (hostFails) throw hostFails
      if (method === 'hostThreads.start')
        return [{ taskId: 'far-1', title: (args[0] as RemoteRequest).thread.title ?? 'Remote', projectName: 'jobs' }]
      if (method === 'hostThreads.status') return [remoteStatus]
      if (method === 'hostThreads.projects') return [{ id: 'jobs', name: 'jobs' }]
      return { sent: true }
    },
  } as unknown as AgentHostService
  remote = new RemoteThreads(db, agents, hosts, () => {})
  service = new AgentThreadService(db, ws, agents, invoke, () => {}, remote)
})

const callerIn = async (project: Project, access: AgentSettings['access'] = 'full') => {
  const task = await ws.createTask({ projectId: project.id, title: 'Plan the dueDate field', mode: 'current' })
  return { task, session: session('caller', task.id, { access }) }
}

describe('thread_start', () => {
  it('starts one thread in its own project at once in Full access and links both threads', async () => {
    const { task } = await callerIn(api)
    const { call } = tools('caller')
    const out = await call('thread_start', { threads: [{ prompt: 'Write the migration for dueDate' }] })
    expect(permissionDetails).toEqual([])
    expect(out.started).toHaveLength(1)
    const started = ws.getTask(out.started[0].threadId)
    expect(started.projectId).toBe(api.id)
    expect(started.title).toBe('Write the migration for dueDate')
    expect(started.startedFrom).toEqual({
      groupId: expect.any(String),
      taskId: task.id,
      title: task.title,
      groupSize: 1,
    })
    expect(ws.getTask(task.id).startedFrom).toBeUndefined()
    expect(recorded).toEqual([{ id: 'caller', threads: [expect.objectContaining({ taskId: started.id })] }])
  })

  it('asks once before starting in another project, and starting nothing when the person declines', async () => {
    await callerIn(api)
    const { call } = tools('caller')
    const declined = await call('thread_start', { threads: [{ prompt: 'Show dueDate', project: 'web' }] })
    expect(declined).toMatchObject({ started: [], declined: true })
    expect(permissionDetails[0]).toContain('web')
    expect(ws.listTasks(web.id)).toEqual([])
    approvals.push(true)
    const out = await call('thread_start', { threads: [{ prompt: 'Show dueDate', project: 'web' }] })
    expect(ws.getTask(out.started[0].threadId).projectId).toBe(web.id)
  })

  it('asks for any start outside Full access and for several threads at once', async () => {
    await callerIn(api, 'auto')
    approvals.push(true)
    const out = await tools('caller').call('thread_start', {
      threads: [{ prompt: 'API part' }, { prompt: 'Web part', project: web.id }],
    })
    expect(permissionDetails).toHaveLength(1)
    expect(out.started).toHaveLength(2)
    const [first, second] = out.started.map((entry: { threadId: string }) => ws.getTask(entry.threadId))
    expect(first.startedFrom.groupId).toBe(second.startedFrom.groupId)
    expect(first.startedFrom.groupSize).toBe(2)
  })

  it('writes the brief with the starting request and the threads that work beside it', async () => {
    await callerIn(api)
    approvals.push(true)
    const out = await tools('caller').call('thread_start', {
      threads: [
        { prompt: 'API part', title: 'API' },
        { prompt: 'Web part', title: 'Web', project: 'web' },
      ],
    })
    const brief = (events.get(sessions.get('started-1')!.id)![0] as { text: string }).text
    expect(brief).toContain('API part')
    expect(brief).toContain('Plan the dueDate field')
    expect(brief).toContain('Add dueDate to the API')
    expect(brief).toContain('"Web"')
    expect(out.started.map((entry: { title: string }) => entry.title)).toEqual(['API', 'Web'])
  })

  it('names an unknown project instead of guessing, and creates nothing', async () => {
    await callerIn(api)
    await expect(
      tools('caller').call('thread_start', { threads: [{ prompt: 'x', project: 'mobile' }] }),
    ).rejects.toThrow(/No project matches "mobile".*api, web/)
    expect(calls).not.toContain('tasks.create')
  })

  it('never gives a started thread more access than the caller', async () => {
    await callerIn(api, 'edits')
    await expect(tools('caller').call('thread_start', { threads: [{ prompt: 'x' }], access: 'full' })).rejects.toThrow(
      /more access/,
    )
    approvals.push(true)
    await tools('caller').call('thread_start', { threads: [{ prompt: 'x' }] })
    expect(sessions.get('started-1')!.settings.access).toBe('edits')
  })

  it('refuses a third level of agent-started threads and more than the hourly limit', async () => {
    await callerIn(api)
    const first = await tools('caller').call('thread_start', { threads: [{ prompt: 'Level one' }] })
    expect(first.started[0].threadId).toBeTruthy()
    const second = await tools('started-1').call('thread_start', { threads: [{ prompt: 'Level two' }] })
    await expect(tools('started-2').call('thread_start', { threads: [{ prompt: 'Level three' }] })).rejects.toThrow(
      /cannot start more/,
    )
    expect(second.started).toHaveLength(1)
    const many = Array.from({ length: MAX_THREADS_PER_HOUR }, (_, i) => ({ prompt: `Part ${i}` }))
    approvals.push(true)
    await expect(tools('caller').call('thread_start', { threads: many })).rejects.toThrow(/last hour/)
  })

  it('brings uncommitted changes into a new worktree and leaves the starting checkout as it was', async () => {
    await callerIn(api)
    writeFileSync(join(apiRoot, 'schema.ts'), "export const fields = ['dueDate']\n")
    const out = await tools('caller').call('thread_start', {
      threads: [{ prompt: 'Finish dueDate on a branch', bringChanges: true }],
    })
    expect(out.started[0].error).toBeUndefined()
    const [binding] = ws.listBindings(out.started[0].threadId)
    expect(binding!.mode).toBe('worktree')
    expect(binding!.cwd).not.toBe(apiRoot)
    expect(readFileSync(join(binding!.cwd, 'schema.ts'), 'utf8')).toContain('dueDate')
    expect(readFileSync(join(apiRoot, 'schema.ts'), 'utf8')).toContain('dueDate')
    const brief = (events.get('started-1')![0] as { text: string }).text
    expect(brief).toContain('uncommitted changes in api are already applied here')
  })

  it('keeps bringChanges to a new worktree of the same project', async () => {
    await callerIn(api)
    await expect(
      tools('caller').call('thread_start', { threads: [{ prompt: 'x', project: 'web', bringChanges: true }] }),
    ).rejects.toThrow(/same project/)
  })
})

describe('Let agents start threads', () => {
  const off = () => ws.setAppState('app-preferences', { agentThreads: false })

  it('offers no tools to a thread that launches with it off', async () => {
    await callerIn(api)
    off()
    expect(Object.keys(tools('caller').registered)).toEqual([])
  })

  it('refuses in a running thread once it is turned off, and refuses a paired host', async () => {
    await callerIn(api)
    const { call } = tools('caller')
    off()
    await expect(call('thread_start', { threads: [{ prompt: 'x' }] })).rejects.toThrow(/turned off/)
    await expect(
      service.startForHost({ id: 'd', kind: 'host', maxAccess: 'edits', role: 'owner' } as DeviceInfo, {
        thread: { prompt: 'x', project: 'web' },
        depth: 1,
        access: 'edits',
        settings: DEFAULT_AGENT_SETTINGS,
        from: { host: 'laptop', thread: 'Plan', request: '' },
      }),
    ).rejects.toThrow(/turned off/)
    expect(calls).not.toContain('tasks.create')
  })
})

describe('related threads', () => {
  it('lets threads started together see and message each other, but not unrelated threads', async () => {
    await callerIn(api)
    approvals.push(true)
    const out = await tools('caller').call('thread_start', {
      threads: [{ prompt: 'API part' }, { prompt: 'Web part', project: 'web' }],
    })
    const [apiThread, webThread] = out.started.map((entry: { threadId: string }) => entry.threadId)
    const status = await tools('started-1').call('thread_status', {})
    expect(status.map((entry: { threadId: string; relation: string }) => [entry.threadId, entry.relation])).toEqual([
      [ws.getTask(apiThread).startedFrom!.taskId, 'starter'],
      [webThread, 'sibling'],
    ])
    await tools('started-1').call('thread_message', {
      threadId: webThread,
      text: 'The field is dueDate (ISO date).',
      mode: 'queue',
    })
    expect(submitted.at(-1)).toMatchObject({ id: 'started-2', mode: 'queue' })
    expect(submitted.at(-1)!.text).toContain('The field is dueDate')
    const other = await ws.createTask({ projectId: web.id, title: 'Unrelated', mode: 'current' })
    await expect(tools('started-1').call('thread_message', { threadId: other.id, text: 'hi' })).rejects.toThrow(
      /not related/,
    )
  })

  it('stops two threads from messaging each other without end', async () => {
    await callerIn(api)
    const out = await tools('caller').call('thread_start', { threads: [{ prompt: 'Write the migration' }] })
    const child = out.started[0].threadId
    for (let i = 0; i < MAX_MESSAGES_PER_HOUR; i++)
      await tools('caller').call('thread_message', { threadId: child, text: `ping ${i}`, mode: 'queue' })
    await expect(
      tools('caller').call('thread_message', { threadId: child, text: 'one more', mode: 'queue' }),
    ).rejects.toThrow(/last hour/)
  })

  it('reports each finished thread to the starting thread once', async () => {
    await callerIn(api)
    const out = await tools('caller').call('thread_start', { threads: [{ prompt: 'Write the migration' }] })
    await service.tick()
    expect(submitted).toEqual([])
    const child = sessions.get('started-1')!
    child.state = 'idle'
    // The report reads the thread's record, as the host keeps it.
    db.exec('PRAGMA foreign_keys = OFF')
    db.prepare('INSERT INTO agent_events (session_id, seq, event) VALUES (?, 1, ?)').run(
      child.id,
      JSON.stringify({ kind: 'text', text: 'Migration written and tested.' }),
    )
    await service.tick()
    await service.tick()
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toMatchObject({ id: 'caller', mode: 'queue' })
    expect(submitted[0]!.text).toContain(out.started[0].threadId)
    expect(submitted[0]!.text).toContain('it finished')
    expect(submitted[0]!.text).toContain('Migration written and tested.')
  })

  it('does not wake a starting thread the person stopped', async () => {
    await callerIn(api)
    await tools('caller').call('thread_start', { threads: [{ prompt: 'Write the migration' }] })
    sessions.get('caller')!.state = 'stopped'
    sessions.get('started-1')!.state = 'idle'
    await service.tick()
    expect(submitted).toEqual([])
  })

  it('keeps the started thread’s group when the starting thread is deleted', async () => {
    const { task } = await callerIn(api)
    const out = await tools('caller').call('thread_start', { threads: [{ prompt: 'Write the migration' }] })
    await ws.deleteTask(task.id, false)
    expect(ws.getTask(out.started[0].threadId).startedFrom).toMatchObject({ taskId: null, title: null, groupSize: 1 })
  })
})

describe('threads.startGroup', () => {
  it('starts reviewed parts of one Home prompt as a group that knows every member, without a starting thread', async () => {
    const groupId = '7b0a1f8e-8c1d-4c3e-9a51-0e9a1d0c4b11'
    const out = await service.startGroup(
      {
        groupId,
        threads: [
          { projectId: api.id, title: 'Store dueDate', prompt: 'API brief' },
          { projectId: web.id, title: 'Show dueDate', prompt: 'Web brief' },
        ],
        together: ['Store dueDate', 'Show dueDate', 'Ship dueDate on mobile'],
      },
      DEFAULT_AGENT_SETTINGS,
    )
    expect(out.map((entry) => entry.error)).toEqual([undefined, undefined])
    const tasks = out.map((entry) => ws.getTask(entry.taskId))
    expect(tasks.map((task) => task.startedFrom)).toEqual([
      { groupId, taskId: null, title: null, groupSize: 2 },
      { groupId, taskId: null, title: null, groupSize: 2 },
    ])
    const brief = (events.get('started-1')![0] as { text: string }).text
    expect(brief).toContain('"Show dueDate", "Ship dueDate on mobile"')
    expect(brief).not.toContain('"Store dueDate"')
    // Retrying the same group finds the same threads and starts no second agent.
    const again = await service.startGroup(
      {
        groupId,
        threads: [
          { projectId: api.id, title: 'Store dueDate', prompt: 'API brief' },
          { projectId: web.id, title: 'Show dueDate', prompt: 'Web brief' },
        ],
        together: ['Store dueDate', 'Show dueDate', 'Ship dueDate on mobile'],
      },
      DEFAULT_AGENT_SETTINGS,
    )
    expect(again.map((entry) => entry.taskId)).toEqual(out.map((entry) => entry.taskId))
    expect(sessions.has('started-3')).toBe(false)
    await service.tick()
    expect(submitted).toEqual([])
  })
})

describe('threads another host asks for', () => {
  const device = { id: 'dev1', name: 'studio', kind: 'host', maxAccess: 'edits', role: 'owner' } as DeviceInfo
  const request = (extra: Partial<RemoteRequest> = {}): RemoteRequest => ({
    thread: { prompt: 'Backfill dueDate', project: 'web' },
    depth: 1,
    access: 'full',
    settings: { ...DEFAULT_AGENT_SETTINGS, access: 'full' },
    from: { host: 'laptop', thread: 'Plan dueDate', request: 'Add dueDate everywhere' },
    ...extra,
  })

  it('starts the thread under this host’s ceiling, names the pairing as this host knows it, and keeps it off Home', async () => {
    const [started] = await service.startForHost(device, request())
    expect(started!.error).toBeUndefined()
    const task = ws.getTask(started!.taskId)
    expect(task.projectId).toBe(web.id)
    // The label is this host's own name for the pairing, not what the asking host claims to be.
    expect(task.startedFrom).toMatchObject({ taskId: null, title: 'Plan dueDate', host: 'studio' })
    expect(sessions.get('started-1')!.settings.access).toBe('edits')
    expect(startedGroups([{ hostId: 'h', tasks: ws.listTasks() }])).toEqual([])
    const brief = (events.get('started-1')![0] as { text: string }).text
    expect(brief).toContain('Started by an agent on the paired host "studio" (it calls itself "laptop")')
  })

  it('ignores the asking host’s account and tier, and spends nothing on a vague project name', async () => {
    await service.startForHost(
      device,
      request({ settings: { ...DEFAULT_AGENT_SETTINGS, accountId: 'work', serviceTier: 'fast' } }),
    )
    expect(sessions.get('started-1')!.settings.accountId).toBeUndefined()
    expect(sessions.get('started-1')!.settings.serviceTier).toBe('standard')
    await expect(
      service.startForHost(device, request({ thread: { prompt: 'x', project: 'the shop frontend' } })),
    ).rejects.toThrow(/No project here/)
    expect(vi.mocked((service as unknown as { agents: AgentService }).agents.analyze)).not.toHaveBeenCalled()
  })

  it('uses this host’s default model when the asking host’s is not here', async () => {
    await service.startForHost(device, request({ settings: { ...DEFAULT_AGENT_SETTINGS, provider: 'cursor' } }))
    expect(sessions.get('started-1')!.settings).toMatchObject({ provider: 'codex', model: 'gpt-5.5', access: 'edits' })
  })

  it('refuses a request that is too deep, from a phone, or over the pairing’s hourly limit', async () => {
    await expect(service.startForHost(device, request({ depth: 3 }))).rejects.toThrow(/deep/)
    await expect(service.startForHost({ id: 'p', role: 'owner' } as DeviceInfo, request())).rejects.toThrow(
      /Only a paired host/,
    )
    for (let i = 0; i < MAX_THREADS_PER_HOUR; i++)
      await service.startForHost(device, request({ thread: { prompt: `Part ${i}`, project: 'web' } }))
    await expect(service.startForHost(device, request())).rejects.toThrow(/last hour/)
  })

  it('names projects to a paired host without their folders', () => {
    expect(service.projectsForHost(device)).toEqual([
      { id: api.id, name: 'api' },
      { id: web.id, name: 'web' },
    ])
    expect(() => service.projectsForHost({ id: 'p', role: 'owner' } as DeviceInfo)).toThrow(/Only a paired host/)
  })

  it('starts a retried request once, and shows and messages only that pairing’s threads', async () => {
    const [first] = await service.startForHost(device, request(), 'key-1')
    const [again] = await service.startForHost(device, request(), 'key-1')
    expect(again!.taskId).toBe(first!.taskId)
    expect(sessions.has('started-2')).toBe(false)
    expect(service.statusForHost(device).map((entry) => entry.threadId)).toEqual([first!.taskId])
    const other = { ...device, id: 'dev2' } as DeviceInfo
    expect(service.statusForHost(other)).toEqual([])
    await expect(service.messageForHost(other, first!.taskId, 'hi', 'queue')).rejects.toThrow(
      /not started by this host/,
    )
    await service.messageForHost(device, first!.taskId, 'The field is dueDate', 'queue')
    expect(submitted.at(-1)).toMatchObject({ id: 'started-1', text: 'The field is dueDate' })
  })
})

describe('threads this host’s agents start on another host', () => {
  it('always asks first, starts there, and reports its outcome back once', async () => {
    await callerIn(api)
    approvals.push(true)
    const out = await tools('caller').call('thread_start', {
      host: 'vps',
      threads: [{ prompt: 'Backfill dueDate', title: 'Backfill', project: 'jobs' }],
    })
    expect(permissionDetails[0]).toContain('jobs on vps')
    expect(out.started[0]).toMatchObject({ host: 'vps', title: 'Backfill', projectName: 'jobs' })
    expect(out.started[0].threadId).toMatch(/^remote:/)
    const sent = hostCalls.find((call) => call.method === 'hostThreads.start')!
    expect(sent.args[0]).toMatchObject({ depth: 1, access: 'full', from: { thread: 'Plan the dueDate field' } })
    expect(sent.key).toBeTruthy()
    const now = Date.now()
    await remote.tick(now)
    expect(submitted).toEqual([])
    remoteStatus = { state: 'completed', threadId: 'far-1', title: 'Backfill', latest: 'Backfilled 120 rows.' }
    await remote.tick(now + REMOTE_POLL_MS)
    await remote.tick(now + 2 * REMOTE_POLL_MS)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]!.text).toContain('on vps')
    expect(submitted[0]!.text).toContain('Backfilled 120 rows.')
    const status = await tools('caller').call('thread_status', { threadId: out.started[0].threadId })
    expect(status[0]).toMatchObject({ host: 'vps', state: 'completed' })
    remoteStatus = { state: 'running', threadId: 'far-1', title: 'Remote', project: 'jobs' }
  })

  it('keeps a start for a host that is offline, starts it when it returns, and gives up after a day', async () => {
    await callerIn(api)
    approvals.push(true, true)
    hostFails = Object.assign(new Error('Cannot connect to this host.'), { code: 'ECONNREFUSED' })
    const out = await tools('caller').call('thread_start', {
      host: 'vps',
      threads: [{ prompt: 'Backfill dueDate', project: 'jobs' }],
    })
    expect(out.started[0]).toMatchObject({ pending: true })
    const now = Date.now()
    hostFails = null
    await remote.tick(now)
    const status = await tools('caller').call('thread_status', {})
    expect(status[0].state).toBe('running')
    hostFails = Object.assign(new Error('Cannot connect to this host.'), { code: 'ECONNREFUSED' })
    await tools('caller').call('thread_start', { host: 'vps', threads: [{ prompt: 'Second', project: 'jobs' }] })
    await remote.tick(now + PENDING_MS + REMOTE_POLL_MS)
    expect(submitted.at(-1)!.text).toContain('could not be reached for a day')
  })

  it('tells the starting thread once when the pairing was revoked on the other host', async () => {
    await callerIn(api)
    approvals.push(true)
    const out = await tools('caller').call('thread_start', {
      host: 'vps',
      threads: [{ prompt: 'Backfill dueDate', project: 'jobs' }],
    })
    hostFails = Object.assign(new Error('The server rejected the access token'), { status: 401 })
    const now = Date.now()
    await remote.tick(now)
    await remote.tick(now + REMOTE_POLL_MS)
    expect(submitted.filter((entry) => entry.text.includes('revoked'))).toHaveLength(1)
    const status = await tools('caller').call('thread_status', { threadId: out.started[0].threadId })
    expect(status[0]).toMatchObject({ state: 'failed' })
    hostFails = null
  })

  it('keeps reporting local threads while another host hangs', async () => {
    await callerIn(api)
    await tools('caller').call('thread_start', { threads: [{ prompt: 'Write the migration' }] })
    approvals.push(true)
    await tools('caller').call('thread_start', { host: 'vps', threads: [{ prompt: 'Backfill', project: 'jobs' }] })
    // The other host never answers from now on.
    remote.tick = () => new Promise(() => {})
    sessions.get('started-1')!.state = 'idle'
    await service.tick()
    expect(submitted.some((entry) => entry.id === 'caller' && entry.text.includes('it finished'))).toBe(true)
  })

  it('names how the person adds a host it does not know, and keeps uncommitted changes here', async () => {
    await callerIn(api)
    await expect(
      tools('caller').call('thread_start', { host: 'mars', threads: [{ prompt: 'x', project: 'jobs' }] }),
    ).rejects.toThrow(/ramu hosts add .* Only the person can add a host/)
    await expect(
      tools('caller').call('thread_start', {
        host: 'vps',
        threads: [{ prompt: 'x', project: 'jobs', bringChanges: true }],
      }),
    ).rejects.toThrow(/never leave it/)
    const projects = await tools('caller').call('project_list', { host: 'vps' })
    expect(projects).toEqual([{ id: 'jobs', name: 'jobs', host: 'vps' }])
  })
})

it('leaves a brief without context unchanged', () => {
  expect(briefOf('Do it', undefined, [])).toBe('Do it')
  expect(briefOf('Do it', 'From X', ['Y'])).toContain('Started together with: "Y"')
})
