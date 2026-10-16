import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { DEFAULT_AGENT_SETTINGS, NO_PROJECT, type AgentSessionInfo, type ManagedSkill } from '@ramu/shared/types'
import { openDb, type Db } from '../src/db'
import { Workspace } from '../src/workspace/workspace'
import { MemoryService } from '../src/memory/memory'
import { LearningService } from '../src/memory/learning'
import { claudeLaunchOptions } from '../src/agent/claudeOptions'
import { openCodeConfigEnv } from '../src/providers/acp'
import { providerAdapter } from '../src/providers/adapters'

let db: Db, root: string, service: LearningService
let workspace: Workspace
let provider: AgentSessionInfo['provider']
const session = () =>
  ({ id: 's', taskId: 't', parentId: null, provider, settings: DEFAULT_AGENT_SETTINGS }) as AgentSessionInfo
const nextTick = () => new Promise((resolve) => setImmediate(resolve))
const skill = (id: string, name: string, projectId: string | null): ManagedSkill => ({
  id,
  projectId,
  name,
  description: `Use ${name}`,
  content: `Steps for ${name}.`,
  status: 'active',
  pinned: false,
  revision: 1,
  createdAt: 1,
  updatedAt: Date.now(),
  lastUsedAt: null,
  useCount: 0,
  sourceSessionId: 's',
  sourceSeq: 1,
})
const insert = (value: ManagedSkill) =>
  db.prepare('INSERT INTO managed_skills VALUES (?, ?)').run(value.id, JSON.stringify(value))

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ramu-skill-export-'))
  db = openDb(':memory:')
  workspace = new Workspace(db, join(root, 'worktrees'))
  db.exec(
    "INSERT INTO projects(id,name,created_at) VALUES ('p','Project',1); INSERT INTO tasks(id,project_id,title,mode,status,created_at) VALUES ('t','p','Task','current','idle',1)",
  )
  provider = 'codex'
  const agents = { get: session, events: () => [], analyze: vi.fn() }
  const memory = new MemoryService(db, workspace, { analyze: agents.analyze, list: () => [] }, () => {})
  service = new LearningService(db, workspace, agents, memory, join(root, 'skills'), () => {})
})
afterEach(async () => {
  await service.settle()
  db.close()
  rmSync(root, { recursive: true, force: true })
})

it('exports only active skills of the scope under ramu- names inside a Ramu-owned plugin folder', () => {
  insert(skill('g', 'global-tip', null))
  insert(skill('a', 'alpha', 'p'))
  insert(skill('o', 'other-project', 'q'))
  insert({ ...skill('d', 'disabled-one', 'p'), status: 'disabled' })
  const dir = service.exportDir('p', 'codex', root)!
  expect(dir.startsWith(join(root, 'skills', 'export'))).toBe(true)
  expect(readdirSync(join(dir, 'skills')).sort()).toEqual(['ramu-alpha', 'ramu-global-tip'])
  expect(readFileSync(join(dir, 'skills', 'ramu-alpha', 'SKILL.md'), 'utf8')).toContain('name: ramu-alpha\n')
  expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name).toBe('ramu-managed')
  expect(readdirSync(join(service.exportDir(null, 'codex', root)!, 'skills'))).toEqual(['ramu-global-tip'])
  expect(service.exportDir(NO_PROJECT, 'codex', root)).toBe(service.exportDir(null, 'codex', root))
})

it('prefers the project skill when it shares a name with a global one', () => {
  insert(skill('g', 'deploy', null))
  insert({ ...skill('p', 'deploy', 'p'), content: 'Project steps.' })
  const file = join(service.exportDir('p', 'codex', root)!, 'skills', 'ramu-deploy', 'SKILL.md')
  expect(readFileSync(file, 'utf8')).toContain('Project steps.')
})

it('withholds conditional skills from catalogs and existing provider exports when off, retaining ordinary skills and stored procedures', async () => {
  insert(skill('ordinary', 'ordinary', 'p'))
  insert({ ...skill('conditional', 'conditional', 'p'), activation: { requires_tools: ['browser_open'] } })
  const markdown =
    '---\nname: installed\ndescription: Installed\nmetadata:\n  hermes:\n    requires_tools: [shell]\n---\nInstructions'
  insert({
    ...skill('installed', 'installed', 'p'),
    installation: { source: '/local', skill: 'installed', cliVersion: '1.7.2', markdown, files: {} },
  })
  const dir = service.exportDir('p', 'codex', root)!
  expect(readdirSync(join(dir, 'skills'))).toHaveLength(3)
  workspace.setAppState('app-preferences', { intelligence: { toolAwareSkills: false, learning: 'off' } })
  service.settingsChanged()
  await nextTick()
  expect(readdirSync(join(dir, 'skills'))).toEqual(['ramu-ordinary'])
  expect(readdirSync(join(root, '.agents', 'skills'))).toEqual(['ramu-ordinary'])
  expect(service.catalog('p').map((value) => value.name)).toEqual(['ordinary'])
  expect(service.skills()).toHaveLength(3)
  expect(service.instructions('s')).not.toContain('skill_resolve')
  workspace.setAppState('app-preferences', { intelligence: { toolAwareSkills: true, learning: 'off' } })
  service.settingsChanged()
  await nextTick()
  expect(readdirSync(join(dir, 'skills'))).toHaveLength(3)
})

it('removes disabled tools from new registrations and rejects an earlier resolver without affecting same-thread recall', () => {
  const handlers = new Map<string, (args: Record<string, unknown>) => unknown>()
  const server = {
    registerTool: (name: string, _config: unknown, handler: never) => handlers.set(name, handler),
  } as unknown as McpServer
  service.register(server, 's')
  const resolve = handlers.get('skill_resolve')!,
    search = handlers.get('session_search')!,
    recall = handlers.get('session_recall')!
  workspace.setAppState('app-preferences', { intelligence: { toolAwareSkills: false, crossThreadRecall: false } })
  expect(() => resolve({ availableTools: [], availableToolsets: [], inventoryComplete: false })).toThrow('turned off')
  expect(() => search({ query: 'test', scope: 'project', limit: 5, offset: 0 })).toThrow('turned off')
  expect(() => recall({ sessionId: 'other', scope: 'all', startSeq: 1, limit: 5 })).toThrow('turned off')
  expect(() => recall({ startSeq: 1, limit: 5 })).not.toThrow()
  handlers.clear()
  service.register(server, 's')
  expect([...handlers.keys()]).toEqual(['session_recall'])
  expect(service.instructions('s')).not.toContain('session_search')
  workspace.setAppState('app-preferences', { intelligence: { toolAwareSkills: true, crossThreadRecall: false } })
  handlers.clear()
  service.register(server, 's')
  expect([...handlers.keys()]).toEqual(['skill_resolve', 'session_recall'])
  workspace.setAppState('app-preferences', { intelligence: { toolAwareSkills: false, crossThreadRecall: true } })
  handlers.clear()
  service.register(server, 's')
  expect([...handlers.keys()]).toEqual(['session_search', 'session_recall'])
})

it('resolves tool-aware variants against each runtime without exposing incompatible procedures', async () => {
  insert({
    ...skill('browser', 'browser-tests', 'p'),
    activation: { requires_tools: ['browser_open'] },
    content: 'Run the native browser tests.',
  })
  insert({
    ...skill('fallback', 'browser-cli', 'p'),
    activation: { requires_tools: ['shell'], fallback_for_tools: ['browser_open'] },
    content: 'Run the browser CLI from the shell.',
  })
  insert({ ...skill('other', 'other-project', 'q'), activation: { requires_tools: ['shell'] } })
  const handlers = new Map<string, (args: Record<string, unknown>) => { content: { text: string }[] }>()
  service.register(
    {
      registerTool: (name: string, _config: unknown, handler: never) => handlers.set(name, handler),
    } as unknown as McpServer,
    's',
  )
  const resolve = (tools: string[], id?: string, inventoryComplete = true) =>
    JSON.parse(
      handlers.get('skill_resolve')!({ id, availableTools: tools, availableToolsets: [], inventoryComplete })
        .content[0]!.text,
    )
  expect(resolve(['shell', 'browser_open']).map((value: { id: string }) => value.id)).toEqual(['browser'])
  expect(resolve(['shell']).map((value: { id: string }) => value.id)).toEqual(['fallback'])
  expect(resolve(['shell'], undefined, false)).toEqual([])
  expect(resolve(['shell'], 'browser')).toMatchObject({ available: false, reasons: ['Requires tool: browser_open'] })
  expect(resolve(['shell'], 'browser').content).toBeUndefined()
  expect(resolve(['shell', 'browser_open'], 'browser').content).toContain('native browser tests')
  expect(() => resolve(['shell'], 'other')).toThrow('unavailable')
  service.control('fallback', 'disable')
  expect(resolve(['shell'])).toEqual([])
})

it('exports stable runtime gates so concurrent providers in a shared checkout cannot select for one another', () => {
  insert({
    ...skill('browser', 'browser-tests', 'p'),
    activation: { requires_tools: ['browser_open'] },
    content: 'Only run these browser instructions when compatible.',
  })
  const codex = service.exportDir('p', 'codex', root)!
  const claude = service.exportDir('p', 'claude-code', root)!
  expect(codex).toBe(claude)
  const text = readFileSync(join(codex, 'skills', 'ramu-browser-tests', 'SKILL.md'), 'utf8')
  expect(text).toContain('skill_resolve')
  expect(text).toContain('browser_open')
  expect(text).not.toContain('Only run these browser instructions')
  expect(service.skills()[0]!.content).toContain('Only run these browser instructions')
})

it('honors Hermes activation metadata in existing installed skills and retains approved supporting files', () => {
  const markdown =
    '---\nname: browser-tests\ndescription: Test in a browser\nmetadata:\n  hermes:\n    requires_toolsets: [browser]\n    fallback_for_tools: [premium_browser]\n---\nRun the procedure.\n'
  insert({
    ...skill('installed', 'browser-tests', 'p'),
    content: 'Run the procedure.',
    installation: {
      source: '/local',
      skill: 'browser-tests',
      cliVersion: '1.7.2',
      markdown,
      files: { 'references/check.md': Buffer.from('Approved reference').toString('base64') },
    },
  })
  const dir = service.exportDir('p', 'opencode', root)!
  const exported = join(dir, 'skills', 'ramu-browser-tests')
  expect(readFileSync(join(exported, 'SKILL.md'), 'utf8')).toContain('skill_resolve')
  expect(readFileSync(join(exported, 'references/check.md'), 'utf8')).toBe('Approved reference')
})

it('drops archived or disabled skills and picks up restored or edited ones after a change', async () => {
  insert(skill('a', 'alpha', 'p'))
  const file = join(service.exportDir('p', 'codex', root)!, 'skills', 'ramu-alpha', 'SKILL.md')
  expect(existsSync(file)).toBe(true)
  service.control('a', 'archive')
  await nextTick()
  expect(existsSync(file)).toBe(false)
  service.control('a', 'restore')
  await nextTick()
  expect(existsSync(file)).toBe(true)
  service.control('a', 'disable')
  await nextTick()
  expect(existsSync(file)).toBe(false)
})

it('lists no skills in the instructions and registers no skill tools for any provider', () => {
  insert(skill('a', 'alpha', 'p'))
  const tools: string[] = []
  service.register({ registerTool: (name: string) => tools.push(name) } as unknown as McpServer, 's')
  expect(tools).toEqual(['skill_resolve', 'session_search', 'session_recall'])
  for (const each of ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as const) {
    provider = each
    expect(service.instructions('s')).not.toContain('alpha')
    expect(providerAdapter(each).skillsLaunch).toBeDefined()
  }
})

it('hands each provider the export through its own mechanism', () => {
  expect(providerAdapter('claude-code').skillsLaunch?.('/x', '/w')).toEqual({ plugins: ['/x'] })
  expect(providerAdapter('codex').skillsLaunch?.('/x', '/w')).toEqual({ linkDirs: [join('/w', '.agents', 'skills')] })
  expect(providerAdapter('opencode').skillsLaunch?.('/x', '/w')).toEqual({ configPaths: [join('/x', 'skills')] })
  expect(providerAdapter('cursor').skillsLaunch?.('/x', '/w')).toEqual({ linkDirs: [join('/w', '.cursor', 'skills')] })
  expect(providerAdapter('antigravity').skillsLaunch?.('/x', '/w')).toEqual({
    linkDirs: [join('/w', '.gemini', 'skills')],
  })
})

it.each([
  ['cursor', '.cursor'],
  ['antigravity', '.gemini'],
  ['codex', '.agents'],
] as const)(
  'links the export into the folder %s scans in the thread directory and keeps it current',
  async (name, hidden) => {
    insert(skill('g', 'global-tip', null))
    insert(skill('a', 'alpha', 'p'))
    const cwd = join(root, 'work')
    mkdirSync(cwd)
    const linked = join(cwd, hidden, 'skills')
    const exported = service.exportDir('p', name, cwd)!
    expect(readdirSync(linked).sort()).toEqual(['ramu-alpha', 'ramu-global-tip'])
    expect(readlinkSync(join(linked, 'ramu-alpha'))).toBe(join(exported, 'skills', 'ramu-alpha'))
    service.control('a', 'archive')
    await nextTick()
    expect(readdirSync(linked)).toEqual(['ramu-global-tip'])
    service.control('a', 'restore')
    await nextTick()
    expect(readdirSync(linked).sort()).toEqual(['ramu-alpha', 'ramu-global-tip'])
    // The project folder going away is not undone by a later skill change.
    rmSync(cwd, { recursive: true })
    service.control('a', 'archive')
    await nextTick()
    expect(existsSync(cwd)).toBe(false)
  },
)

it('does not link for providers that load the export themselves', () => {
  insert(skill('a', 'alpha', 'p'))
  const cwd = join(root, 'work')
  mkdirSync(cwd)
  for (const each of ['claude-code', 'opencode'] as const) service.exportDir('p', each, cwd)
  expect(readdirSync(cwd)).toEqual([])
})

it('loads the export as a Claude plugin only when the thread has one', () => {
  const launch = (skillsDir?: string) =>
    claudeLaunchOptions({
      session: { ...session(), cwd: '/tmp', additionalDirs: [] } as AgentSessionInfo,
      connection: { url: 'http://127.0.0.1:1/mcp', token: 't', instructions: '', ...(skillsDir ? { skillsDir } : {}) },
      advisorModel: undefined,
      abort: new AbortController(),
      canUseTool: async () => ({ behavior: 'deny', message: '' }),
      resume: null,
      preferences: undefined,
      hooks: undefined,
    })
  expect(launch('/x').plugins).toEqual([{ type: 'local', path: '/x' }])
  expect(launch().plugins).toBeUndefined()
})

it('adds the export to OpenCode skills without dropping the user inline config', () => {
  const connection = { url: 'http://127.0.0.1:1/mcp', token: 't', skillsDir: '/x' }
  const config = (existing?: string, extra = {}) =>
    JSON.parse(openCodeConfigEnv({ ...connection, ...extra }, existing).OPENCODE_CONFIG_CONTENT!)
  expect(config(undefined)).toEqual({ skills: [join('/x', 'skills')] })
  expect(config('{"model":"a/b","skills":["/mine"]}')).toEqual({
    model: 'a/b',
    skills: ['/mine', join('/x', 'skills')],
  })
  expect(config('{"skills":{"paths":["/mine"],"urls":["https://u"]}}')).toEqual({
    skills: { paths: ['/mine', join('/x', 'skills')], urls: ['https://u'] },
  })
  expect(config(undefined, { nativeSubagents: false })).toEqual({
    permission: { task: 'deny' },
    skills: [join('/x', 'skills')],
  })
})
