// Independent Node process. Electron windows are clients, never owners of agent lifetimes.
import { createServer, type ServerResponse } from 'node:http'
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { LspService } from './lsp'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQuestionTools } from './questionTools'
import { registerAdvisorTools } from './advisor'
import { registerGoalTools } from './goals'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { openDb } from './db'
import { Workspace } from './workspace'
import { AgentService } from './agent'
import { TerminalService } from './pty'
import { createDispatcher } from './ipc'
import { ScheduleService, scheduleSchema } from './schedules'
import { runtimeBuild, runtimeInvoke } from './runtimeClient'
import { ReviewService } from './reviews'
import { RecapService } from './recaps'
import type { AgentSessionInfo, ScheduleInput } from '../shared/types'

const userData = process.env.RAMU_USER_DATA
if (!userData) throw new Error('RAMU_USER_DATA is required for the background service')
mkdirSync(userData, { recursive: true })
const socketPath = process.env.RAMU_SOCKET ?? join(userData, 'runtime.sock')
// A launchd instance can supervise a daemon that was started by the UI without interrupting it.
// Intentional stops exit successfully; crashes let launchd restart or take over execution.
const stoppedPath = join(userData, 'background.stopped')
const serviceBuild = runtimeBuild(process.argv[1] ?? '')
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
const nativeRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()
const send = (channel: string, payload: unknown) => {
  const message = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const client of clients) { if (client.writableLength > 8 * 1024 * 1024) { client.destroy(); clients.delete(client) } else client.write(message) }
}
const changed = () => send('automation:changed', {})
const db = openDb(join(userData, 'ramu.db'))
const root = process.env.RAMU_WORKTREES ?? join(homedir(), '.ramu', 'worktrees')
mkdirSync(root, { recursive: true })
const workspace = new Workspace(db, root)
const fake = process.env.RAMU_FAKE_AGENT === '1' ? await import('./fakeAgent') : null
let reviews!: ReviewService
const agents = new AgentService(db, (sessionId, event, seq) => { send('agent:event', { sessionId, event, seq }) }, fake?.fakeQuery ?? query, fake?.fakeCodex, fake?.fakeCodex, fake?.fakeCodex)
if (fake) agents.helperHistory = async () => []
agents.markRestoredOnBoot()
const terminals = new TerminalService((id, data) => send('term:data', { id, data }), (id, code) => send('term:exit', { id, code }))
const schedules = new ScheduleService(db, workspace, agents, changed)
schedules.recover()
reviews = new ReviewService(db, workspace, agents, join(userData, 'reviews'), changed)
reviews.recover()
agents.reviewHooks = { begin: (taskId, scope) => reviews!.begin(taskId, scope), bind: (id, sessionId) => reviews!.bind(id, sessionId), abandon: (id, error) => reviews!.abandon(id, error), followup: (sessionId) => reviews!.beforeFollowup(sessionId), complete: (sessionId) => reviews!.complete(sessionId), validateFeedback: (reviewId) => reviews!.requireOriginalCheckout(reviewId) }
const recaps = new RecapService(db, workspace, agents, changed)
const lsp = new LspService(send)
const dispatcher = createDispatcher({ userData, send, native: (method, path) => {
  if (!clients.size) return Promise.reject(new Error('Open Ramu to use this desktop action'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { nativeRequests.delete(requestId); reject(new Error('Desktop action timed out')) }, 120000)
    nativeRequests.set(requestId, { resolve, reject, timer })
    // Exactly one UI owns a desktop dialog/action.
    clients.values().next().value?.write(`data: ${JSON.stringify({ channel: 'host:request', payload: { requestId, method, path } })}\n\n`)
  })
} }, { lsp, workspace, terminals, agents, schedules, recaps, reviews })
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
  await Promise.all([recaps.settle(), reviews.settle()])
  terminals.closeAll(); dispatcher.close(); await lsp.stop()
  for (const c of clients) c.end()
  for (const r of nativeRequests.values()) { clearTimeout(r.timer); r.reject(new Error('Service stopping')) }
  mcpHttp.close(); runtime.close(); db.close()
  try { unlinkSync(socketPath) } catch {}
  process.exit(0)
}
async function body(req: import('node:http').IncomingMessage): Promise<any> {
  let bytes = 0; const chunks: Buffer[] = []
  for await (const chunk of req) { bytes += chunk.length; if (bytes > 16000000) throw new Error('Request is too large'); chunks.push(chunk) }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}', (_key, value) => value && typeof value === 'object' && Object.keys(value).length === 1 && value.$ramuUndefined === true ? undefined : value)
}
const runtime = createServer(async (req, res) => {
  try {
    if (req.url === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); res.write(': connected\n\n'); clients.add(res); res.on('close', () => { clients.delete(res); if (!clients.size) lsp.releaseAll() }); return
    }
    if (req.method !== 'POST' || req.url !== '/invoke') { res.writeHead(404).end(); return }
    const { method, args } = await body(req)
    let value: unknown
    if (method === 'host.reply') {
      const request = nativeRequests.get(args?.[0])
      if (request) { clearTimeout(request.timer); nativeRequests.delete(args[0]); args[2] ? request.reject(new Error(String(args[2]))) : request.resolve(args[1]) }
    } else if (method === 'background.status') value = { running: true, pid: process.pid, startedAt, build: serviceBuild }
    else if (method === 'background.stop') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); void stop(true); return }
    else if (method === 'background.restart') { res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}'); void stop(); return }
    else value = await dispatcher.invoke(method, args)
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ value }))
  } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
})
// Per-agent bearer credentials bind tool calls to their originating chat, including no-project chats.
const sessions = new Map<string, AgentSessionInfo>()
const mcpHttp = createServer(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  const source = token && sessions.get(token)
  if (!source || req.url !== '/mcp' || stopping) { res.writeHead(401).end(); return }
  if (req.method !== 'POST') { res.writeHead(405).end(); return }
  const server = new McpServer({ name: 'ramu', version: '0.1.0' })
  registerQuestionTools(server, agents, source.id)
  if (!source.parentId) registerGoalTools(server, agents, source.id)
  if (agents.advisorStep(source.id)) registerAdvisorTools(server, agents, source.id)
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
  server.registerTool('schedule_list', { description: 'List saved schedules and next execution times.', inputSchema: {} }, async () => result(schedules.list()))
  server.registerTool('schedule_pause', { description: 'Pause or resume a schedule.', inputSchema: { id: z.string(), paused: z.boolean() } }, async ({ id, paused }) => result(schedules.pause(id, paused)))
  server.registerTool('schedule_run_now', { description: 'Run a schedule now without changing its recurrence.', inputSchema: { id: z.string() } }, async ({ id }) => result(schedules.runNow(id)))
  server.registerTool('schedule_delete', { description: 'Delete a schedule when requested. Existing run chats remain available.', inputSchema: { id: z.string() } }, async ({ id }) => { schedules.delete(id); return result({ deleted: id }) })
  server.registerTool('schedule_context', { description: 'Get current time, timezone, project and isolated workspace choices before creating a schedule.', inputSchema: {} }, async () => result({ now: new Date().toISOString(), preferences: workspace.getAppState('app-preferences', {}), currentProjectId: scope.projectId, currentWorkspaceId: scope.workspaceId, currentSettings: source.settings, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, projects: workspace.listProjects(), workspaces: workspace.listWorkspaces() }))
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => { void transport.close(); void server.close() })
  try { await server.connect(transport); await transport.handleRequest(req, res, await body(req)) }
  catch { if (!res.headersSent) res.writeHead(500).end() }
})
await new Promise<void>((resolve, reject) => { mcpHttp.once('error', reject); mcpHttp.listen(0, '127.0.0.1', resolve) })
const address = mcpHttp.address() as import('node:net').AddressInfo
agents.toolConnection = (session) => { const token = randomBytes(32).toString('hex'); sessions.set(token, session); return { url: `http://127.0.0.1:${address.port}/mcp`, token } }
// Never unlink a socket owned by another live service. The launcher removes stale sockets first.
await new Promise<void>((resolve, reject) => { runtime.once('error', reject); runtime.listen(socketPath, resolve) })
chmodSync(socketPath, 0o600)
const tick = setInterval(() => { void agents.resumeInterruptedChats().catch(console.error); void schedules.tick().catch(console.error); void recaps.tick().catch(console.error) }, 5000)
await agents.restoreHelperTranscripts()
await agents.resumeInterruptedChats()
agents.goalsSettingsChanged()
void schedules.tick().catch(console.error); void recaps.tick().catch(console.error)
process.on('SIGTERM', () => void stop()); process.on('SIGINT', () => void stop())
