import { registerRtkTool } from './rtk'
import type { AppPreferences } from '@ramu/shared/types'
import { ToolRegistry } from './toolRegistry'
import { CompressionService } from './compression'
import { LearningService } from './learning'
import { DEFAULT_INTELLIGENCE_PREFERENCES } from '@ramu/shared/types'
// Independent Node process. Electron windows are clients, never owners of agent lifetimes.
import { createServer, type ServerResponse } from 'node:http'
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { claudeAcpQuery } from './claudeAcpQuery'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQuestionTools } from './questionTools'
import { registerAdvisorTools } from './advisor'
import { registerGoalTools } from './goals'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { runtimeInvoke } from '@ramu/client-runtime'
import { CAPABILITIES, MAX_REQUEST_BYTES, PROTOCOL_VERSION, decodeInvoke, type Capability } from '@ramu/contracts'
import { loadConfig } from './config'
import { TokenStore, authorized } from './auth'
import { openDb } from './db'
import { Workspace } from './workspace'
import { AgentService } from './agent'
import { TerminalService } from './pty'
import { createDispatcher } from './ipc'
import { ScheduleService, scheduleSchema } from './schedules'
import { runtimeBuild, runtimeVersion } from './build'
import { ReviewService } from './reviews'
import { RecapService } from './recaps'
import { MemoryService, registerMemoryTools } from './memory'
import type { AgentSessionInfo, ScheduleInput } from '@ramu/shared/types'

const config = loadConfig()
const { userData, socketPath } = config
mkdirSync(userData, { recursive: true })
const remoteTokens = config.listen ? new TokenStore(config.tokenPath) : null
// A launchd instance can supervise a daemon that was started by the UI without interrupting it.
// Intentional stops exit successfully; crashes let launchd restart or take over execution.
const stoppedPath = join(userData, 'background.stopped')
const serviceBuild = runtimeBuild(process.argv[1] ?? '')
const serviceVersion = runtimeVersion(process.argv[1] ?? '')
if (process.env.RAMU_SUPERVISOR === '1') {
  try { unlinkSync(stoppedPath) } catch {}
  for (;;) {
    try { await runtimeInvoke(socketPath, 'background.status') } catch { break }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try { readFileSync(stoppedPath); process.exit(0) } catch {}
  }
}
const ownerPath = join(userData, 'runtime-owner')
let owned = false
for (let attempts = 0; attempts < 20 && !owned; attempts++) {
  try { mkdirSync(ownerPath, { mode: 0o700 }); writeFileSync(join(ownerPath, 'pid'), String(process.pid)); owned = true }
  catch {
    try {
      const pid = Number(readFileSync(join(ownerPath, 'pid'), 'utf8'))
      if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid owner')
      try { process.kill(pid, 0); process.exit(0) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      rmSync(ownerPath, { recursive: true, force: true })
    } catch { let stale = false; try { stale = Date.now() - statSync(ownerPath).mtimeMs > 10000 } catch {}
      if (stale) rmSync(ownerPath, { recursive: true, force: true }); else await new Promise((resolve) => setTimeout(resolve, 100)) }
  }
}
if (!owned) throw new Error('Another service is starting; try again shortly')
process.once('exit', () => { try { if (readFileSync(join(ownerPath, 'pid'), 'utf8') === String(process.pid)) rmSync(ownerPath, { recursive: true, force: true }) } catch {} })
try { unlinkSync(socketPath) } catch {}
const clients = new Set<ServerResponse>()
// Only clients on the local socket can answer native dialogs; a remote client's folder picker would open on the wrong machine.
const hostClients = new Set<ServerResponse>()
const nativeRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
const send = (channel: string, payload: unknown) => {
  const message = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const client of clients) { if (client.writableLength > 8 * 1024 * 1024) { client.destroy(); clients.delete(client); hostClients.delete(client) } else client.write(message) }
}
const changed = () => send('automation:changed', {})
const db = openDb(join(userData, 'ramu.db'))
const root = process.env.RAMU_WORKTREES ?? join(homedir(), '.ramu', 'worktrees')
mkdirSync(root, { recursive: true })
const workspace = new Workspace(db, root)
// Review first was the stored default for one release; move those saved values to the new Automatic default once.
if (!workspace.getAppState('migration:learning-auto-default', false)) {
  const saved = workspace.getAppState<{ intelligence?: { learning?: string } } | null>('app-preferences', null)
  if (saved?.intelligence?.learning === 'review') workspace.setAppState('app-preferences', { ...saved, intelligence: { ...saved.intelligence, learning: 'auto' } })
  workspace.setAppState('migration:learning-auto-default', true)
}
const fake = process.env.RAMU_FAKE_AGENT === '1' ? await import('./fakeAgent') : null
let reviews!: ReviewService
const agents = new AgentService(db, (sessionId, event, seq) => { send('agent:event', { sessionId, event, seq }) }, fake?.fakeQuery ?? claudeAcpQuery(query), fake?.fakeCodex, fake?.fakeCodex, fake?.fakeCodex)
if (fake) agents.helperHistory = async () => []
agents.markRestoredOnBoot()
const terminals = new TerminalService((id, data) => send('term:data', { id, data }), (id, code) => send('term:exit', { id, code }))
const schedules = new ScheduleService(db, workspace, agents, changed)
schedules.recover()
reviews = new ReviewService(db, workspace, agents, join(userData, 'reviews'), changed)
reviews.recover()
agents.reviewHooks = { begin: (taskId, scope) => reviews!.begin(taskId, scope), bind: (id, sessionId) => reviews!.bind(id, sessionId), abandon: (id, error) => reviews!.abandon(id, error), followup: (sessionId) => reviews!.beforeFollowup(sessionId), complete: (sessionId) => reviews!.complete(sessionId), validateFeedback: (reviewId) => reviews!.requireOriginalCheckout(reviewId) }
const recaps = new RecapService(db, workspace, agents, changed)
const memory = new MemoryService(db, workspace, agents, () => send('memory:changed', {}))
const compression = new CompressionService(db)
const learning = new LearningService(db, workspace, agents, memory, join(userData, 'skills'), () => send('memory:changed', {}))
agents.sessionCheckpoint = (id) => learning.checkpoint(id)
agents.learningInstructions = (session) => learning.instructions(session.id)
const projectOf = (session: AgentSessionInfo) => { try { return workspace.getTask(session.taskId).projectId } catch { return null } }
agents.memoryInstructions = (session) => memory.instructions(session, projectOf(session))
const dispatcher = createDispatcher({ userData, send, native: (method, path) => {
  if (!hostClients.size) return Promise.reject(new Error('Open Ramu on this computer to use this desktop action'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { nativeRequests.delete(requestId); reject(new Error('Desktop action timed out')) }, 120000)
    nativeRequests.set(requestId, { resolve, reject, timer })
    // Exactly one UI owns a desktop dialog/action.
    hostClients.values().next().value?.write(`data: ${JSON.stringify({ channel: 'host:request', payload: { requestId, method, path } })}\n\n`)
  })
} }, { workspace, terminals, agents, schedules, recaps, reviews, memory, learning, compression })
const startedAt = Date.now()
let stopping = false
async function stop(intentional = false) {
  if (intentional) writeFileSync(stoppedPath, String(Date.now()))
  if (stopping) return; stopping = true
  clearInterval(tick)
  await schedules.stop()
  // Capture after the scheduler drains, so a chat that finished during that wait is not resumed.
  if (!intentional) agents.prepareForRestart()
  reviews.stop(); agents.stopAll(!intentional)
  await Promise.all(workspace.listTasks().flatMap((task) => agents.list(task.id).map((s) => agents.stopAndWait(s.id))))
  await Promise.all(workspace.listTasks().flatMap((task) => agents.list(task.id).map((s) => reviews.complete(s.id))))
  await Promise.all([recaps.settle(), reviews.settle(), memory.settle(), learning.settle()])
  terminals.closeAll(); dispatcher.close()
  for (const c of clients) c.end()
  for (const r of nativeRequests.values()) { clearTimeout(r.timer); r.reject(new Error('Service stopping')) }
  clearInterval(heartbeat)
  mcpHttp.close(); runtime.close(); remote?.close(); db.close()
  try { unlinkSync(socketPath) } catch {}
  process.exit(0)
}
async function body(req: import('node:http').IncomingMessage): Promise<any> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX_REQUEST_BYTES) throw new Error('Request is too large'); chunks.push(chunk) }
  return decodeInvoke(Buffer.concat(chunks).toString())
}
const capabilities: Capability[] = [CAPABILITIES.invoke, CAPABILITIES.events, CAPABILITIES.hostRequests, ...(config.listen ? [CAPABILITIES.remote] : [])]
const failedAuth = new Map<string, { count: number; until: number }>()
const json = { 'Content-Type': 'application/json' }
// One handler serves both transports. Requests over TCP (`remote`) must present the bearer token.
const handle = (remote: boolean) => async (req: import('node:http').IncomingMessage, res: ServerResponse) => {
  try {
    const path = (req.url ?? '/').split('?')[0]
    if (remote) {
      if (path === '/health' && req.method === 'GET') { res.writeHead(200, json).end(JSON.stringify({ ok: true, protocol: PROTOCOL_VERSION })); return }
      const peer = req.socket.remoteAddress ?? 'unknown', limit = failedAuth.get(peer)
      if (limit && limit.until > Date.now()) { res.writeHead(429).end(); return }
      if (!remoteTokens || !authorized(req.headers.authorization, remoteTokens.current())) {
        const count = (limit?.count ?? 0) + 1
        failedAuth.set(peer, { count, until: count >= 5 ? Date.now() + Math.min(60000, 1000 * 2 ** (count - 5)) : 0 })
        res.writeHead(401).end(); return
      }
      failedAuth.delete(peer)
    }
    if (path === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': connected\n\n'); clients.add(res)
      if (!remote) hostClients.add(res)
      res.on('close', () => { clients.delete(res); hostClients.delete(res) }); return
    }
    if (req.method !== 'POST' || path !== '/invoke') { res.writeHead(404).end(); return }
    const { method, args } = await body(req)
    let value: unknown
    if (method === 'host.reply') {
      if (remote) throw new Error('Desktop actions are only available on this computer')
      const request = nativeRequests.get(args?.[0])
      if (request) { clearTimeout(request.timer); nativeRequests.delete(args[0]); args[2] ? request.reject(new Error(String(args[2]))) : request.resolve(args[1]) }
    } else if (method === 'background.status') value = { running: true, pid: process.pid, startedAt, build: serviceBuild, version: serviceVersion, protocol: PROTOCOL_VERSION, capabilities, ...(config.listen ? { listening: `${config.listen.host}:${config.listen.port}` } : {}) }
    else if (method === 'background.stop') { res.writeHead(200, json).end('{}'); void stop(true); return }
    else if (method === 'background.restart') { res.writeHead(200, json).end('{}'); void stop(); return }
    else value = await dispatcher.invoke(method, args)
    res.writeHead(200, json).end(JSON.stringify({ value }))
  } catch (error) { if (!res.headersSent) res.writeHead(400, json); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
}
const runtime = createServer(handle(false))
const remote = config.listen ? createServer(handle(true)) : null
// Per-agent bearer credentials bind tool calls to their originating chat, including no-project chats.
const sessions = new Map<string, { session: AgentSessionInfo; toolSearch: boolean }>()
const mcpHttp = createServer(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  const connection = token ? sessions.get(token) : undefined
  const source = connection?.session
  if (!source || req.url !== '/mcp' || stopping) { res.writeHead(401).end(); return }
  if (req.method !== 'POST') { res.writeHead(405).end(); return }
  const target = new McpServer({ name: 'ramu', version: '0.1.0' })
  const preferences = { ...DEFAULT_INTELLIGENCE_PREFERENCES, ...workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).intelligence }
  const registry = new ToolRegistry(target, connection!.toolSearch, (result) => compression.compact(source.id, preferences.compression, result))
  const server = registry.server
  learning.register(server, source.id)
  if (preferences.rtk) registerRtkTool(server, agents.get(source.id))
  compression.register(server, source.id)
  registerQuestionTools(server, agents, source.id)
  if (!source.parentId) registerGoalTools(server, agents, source.id)
  if (agents.advisorStep(source.id)) registerAdvisorTools(server, agents, source.id)
  if (memory.enabled()) registerMemoryTools(server, memory, source, projectOf(source))
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const scope = workspace.getTask(source.taskId)
  const input = scheduleSchema.omit({ sourceTaskId: true }).extend({ projectId: scheduleSchema.shape.projectId.optional(), workspaceId: scheduleSchema.shape.workspaceId })
  const resolve = (value: Omit<ScheduleInput, 'sourceTaskId' | 'projectId'> & { projectId?: string }): ScheduleInput => ({ ...value, projectId: value.projectId ?? scope.projectId, workspaceId: value.workspaceId === undefined && (!value.projectId || value.projectId === scope.projectId) ? scope.workspaceId : value.workspaceId, sourceTaskId: scope.id })
  const descriptions = {
    schedule_create: 'Create a one-time or repeating agent schedule when the user requests it. Interpret dates using the current time and requested timezone. Ask about ambiguous timing. Defaults to the current chat scope. Return the saved schedule and next run.',
    schedule_update: 'Edit an existing schedule using its ID and full replacement configuration.',
  }
  const checkReview = (reviewId: string) => { const review = reviews!.get(reviewId); if (review.sessionId !== source.id) throw new Error('This review belongs to another agent session'); return review }
  server.registerTool('review_reply', { description: 'Reply to a selected review discussion after fixing or investigating it. Explain the change and any remaining limitations. suggestResolved only suggests closure; the human must resolve the thread. Never edit human comments.', inputSchema: { reviewId: z.string(), threadId: z.string(), text: z.string().min(1).max(10000), suggestResolved: z.boolean().default(false) } }, async ({ reviewId, threadId, text, suggestResolved }) => { checkReview(reviewId); return result(reviews!.agentReply(reviewId, threadId, text, suggestResolved)) })
  server.registerTool('review_add_note', { description: 'Add an explanation or genuine question to a file or line in this session’s review. Prefer replying to an existing thread. New AI notes remain unselected until the human responds or selects them.', inputSchema: { reviewId: z.string(), fileId: z.string(), scope: z.enum(['file', 'line']), side: z.enum(['old', 'new']).default('new'), line: z.number().int().positive().default(1), endLine: z.number().int().positive().default(1), kind: z.enum(['note', 'question']), text: z.string().min(1).max(10000) } }, async ({ reviewId, ...input }) => { checkReview(reviewId); return result(reviews!.agentNote(reviewId, input)) })
  server.registerTool('schedule_create', { description: descriptions.schedule_create, inputSchema: input.shape }, async (value) => { const saved = schedules.save(resolve(value)); agents.scheduleSaved(source.id, saved); return result(saved) })
  server.registerTool('schedule_update', { description: descriptions.schedule_update, inputSchema: { id: z.string(), input } }, async (value) => { const saved = schedules.save(resolve(value.input), value.id); agents.scheduleSaved(source.id, saved); return result(saved) })
  // Codex asks this before one of its own sub-agents starts (see CODEX_HOOK_CONFIG); the answer is the hook's JSON output.
  server.registerTool('codex_pre_tool_use', { description: 'Used by Ramu\'s Codex hook; not for the model.', inputSchema: { tool_name: z.string().optional(), tool_input: z.any().optional(), session_id: z.string().optional() } },
    async (value) => { const decision = await agents.codexSpawnDecision(source.id, value.tool_input).catch(() => null); return result(decision ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: decision.reason } } : {}) })
  // Sub-agents Ramu runs on another provider or model; a sub-agent itself does not get the tool.
  if (!agents.get(source.id).parentId) server.registerTool('ramu_agent', { description: 'Start a sub-agent through Ramu, which may run it on a different provider or model than you. Use it when told to, or when the Agent tool is refused. It takes a description, a prompt and optionally a type, a name and background. Without background it waits and returns the sub-agent\'s report; with background it returns at once and the report arrives later as a message.', inputSchema: { description: z.string().min(1).max(200), prompt: z.string().min(1).max(100000), type: z.string().max(80).optional(), name: z.string().max(80).optional(), background: z.boolean().optional() } },
    async (value, extra) => { try { return result(await agents.spawnSubagent(source.id, value, extra.signal)) } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] } } })
  // A Ramu-run sub-agent talks to the chat that started it; the chat answers its questions.
  if (agents.get(source.id).parentId) {
    server.registerTool('message_parent', { description: 'Send the agent that started you a short note (a finding, a blocker, progress) without stopping. It does not wait for a reply. Finish with your report as usual.', inputSchema: { text: z.string().min(1).max(20000) } },
      async ({ text }) => { try { await agents.messageParent(source.id, text); return result({ sent: true }) } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] } } })
    server.registerTool('ask_parent', { description: 'Ask the agent that started you a question and wait for the answer. Use it only when you cannot continue without it. If no answer comes you are told to carry on with your best judgment.', inputSchema: { question: z.string().min(1).max(20000) } },
      async ({ question }, extra) => { try { return result({ answer: await agents.askParent(source.id, question, extra.signal) }) } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] } } })
  } else server.registerTool('answer_subagent', { description: 'Answer a question a sub-agent asked you (the message names the agent id). The sub-agent then continues.', inputSchema: { agent: z.string(), text: z.string().min(1).max(20000) } },
    async ({ agent, text }) => { try { agents.answerSubagent(source.id, agent, text); return result({ delivered: true }) } catch (error) { return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }] } } })
  server.registerTool('schedule_list', { description: 'List saved schedules and next execution times.', inputSchema: {} }, async () => result(schedules.list()))
  server.registerTool('schedule_pause', { description: 'Pause or resume a schedule.', inputSchema: { id: z.string(), paused: z.boolean() } }, async ({ id, paused }) => result(schedules.pause(id, paused)))
  server.registerTool('schedule_run_now', { description: 'Run a schedule now without changing its recurrence.', inputSchema: { id: z.string() } }, async ({ id }) => result(schedules.runNow(id)))
  server.registerTool('schedule_delete', { description: 'Delete a schedule when requested. Existing run chats remain available.', inputSchema: { id: z.string() } }, async ({ id }) => { schedules.delete(id); return result({ deleted: id }) })
  server.registerTool('schedule_context', { description: 'Get current time, timezone, project and isolated workspace choices before creating a schedule.', inputSchema: {} }, async () => result({ now: new Date().toISOString(), preferences: workspace.getAppState('app-preferences', {}), currentProjectId: scope.projectId, currentWorkspaceId: scope.workspaceId, currentSettings: source.settings, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, projects: workspace.listProjects(), workspaces: workspace.listWorkspaces() }))
  registry.expose()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { void transport.close(); void server.close() })
  try { await server.connect(transport); await transport.handleRequest(req, res, await body(req)) }
  catch { if (!res.headersSent) res.writeHead(500).end() }
})
await new Promise<void>((resolve, reject) => { mcpHttp.once('error', reject); mcpHttp.listen(0, '127.0.0.1', resolve) })
const address = mcpHttp.address() as import('node:net').AddressInfo
agents.toolConnection = (session) => { const token = randomBytes(32).toString('hex'); sessions.set(token, { session, toolSearch: workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).intelligence?.toolSearch ?? true }); return { url: `http://127.0.0.1:${address.port}/mcp`, token } }
// Never unlink a socket owned by another live service. The launcher removes stale sockets first.
await new Promise<void>((resolve, reject) => { runtime.once('error', reject); runtime.listen(socketPath, resolve) })
chmodSync(socketPath, 0o600)
if (remote && config.listen) {
  const { host, port } = config.listen
  await new Promise<void>((resolve, reject) => { remote.once('error', reject); remote.listen(port, host, resolve) })
  console.log(`Ramu server listening on ${host}:${port}; access token in ${config.tokenPath}`)
}
// Proxies and mobile networks drop idle event streams; a comment line every 20 s keeps them open.
const heartbeat = setInterval(() => { for (const client of clients) client.write(': ping\n\n') }, 20000)
const tick = setInterval(() => { void agents.resumeInterruptedChats().catch(console.error); void schedules.tick().catch(console.error); void recaps.tick().catch(console.error); void memory.tick().catch(console.error); void learning.tick().catch(console.error) }, 5000)
await agents.restoreHelperTranscripts()
await agents.resumeInterruptedChats()
agents.goalsSettingsChanged()
void schedules.tick().catch(console.error); void recaps.tick().catch(console.error)
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop())
