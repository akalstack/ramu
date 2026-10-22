import { DEFAULT_AGENT_BROWSER_PREFERENCES } from '@ramu/shared/browser'
import { providerAdapter } from './providers/adapters'
import { LocalDiagnostics } from './background/diagnostics'
import {
  accountEnvironment,
  configureMcpSharing,
  MCP_SHARING_KEY,
  SKILL_SHARING_KEY,
  sharedSessionSkills,
  type McpSharing,
  type SkillSharing,
} from './agent/projectSetup'
import { MobileLiveActivities } from './remote/mobileLiveActivity'
import { MobilePush } from './remote/mobilePush'
import { DEFAULT_FALLBACK_PREFERENCES, type AppPreferences } from '@ramu/shared/types'
import { InteractiveStore } from './interactive/store'
import { registerInteractiveTools } from './interactive/tools'
import { registerThemeTools } from './themeTools'
import { registerBackgroundTerminalTools } from './agent/backgroundTerminalTools'
import { SqliteBackgroundTerminalHistory } from './workspace/backgroundTerminalHistory'
import { ToolRegistry } from './agent/toolRegistry'
import { ExternalSkills } from './memory/externalSkills'
import { crossedSwitchAt, LearningService } from './memory/learning'
import { migrateLearningDefault } from './memory/learningDefault'
import { SettingsStore } from './settings/settingsStore'
import { SharedMcpStorage } from './mcp/storage'
import { SharedMcpService } from './mcp/service'
import { ExternalSessionTools, hasExternalConnections, type ExternalSessionSource } from './mcp/sessionTools'
// Independent Node process. Electron windows are clients, never owners of agent lifetimes.
import { createServer, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync, rmSync, statSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import { NoticeInbox } from './background/notices'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQuestionTools } from './agent/questionTools'
import { usesRamuQuestionTools } from './agent/nativeFeatures'
import { registerAdvisorTools } from './agent/advisor'
import { registerGoalTools } from './agent/goals'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { runtimeInvoke, runtimeNetwork } from '@ramu/client-runtime'
import { HostPresence } from './remote/presence'
import {
  CAPABILITIES,
  MAX_REQUEST_BYTES,
  OPERATION_KEY_PATTERN,
  PROTOCOL_VERSION,
  decodeInvoke,
  type Capability,
} from '@ramu/contracts'
import { loadConfig } from './config'
import { TokenStore } from './remote/auth'
import { DeviceStore, validLifetime, type DeviceInfo } from './remote/devices'
import { RemoteAccess, accessOf, deviceMayInvoke } from './remote/access'
import { HostAdvertiser, discoveryName, readDiscoveryHostId } from './remote/discovery'
import {
  candidateUrls,
  localAddresses,
  readNetworkSetting,
  validateNetworkSetting,
  writeNetworkSetting,
  type NetworkSetting,
} from './remote/network'
import { openDb } from './db'
import { Workspace } from './workspace/workspace'
import { AgentService } from './agent'
import { ThreadTitles } from './agent/threadTitles'
import { DesktopBrowserBroker } from './browser/desktopBroker'
import { INTEGRATED_BROWSER_GUIDE, registerBrowserTools } from './browser/tools'
import { HostBrowser } from './browser/hostBrowser'
import { MacosComputerBackend } from './computer/macos'
import { OcuBackend } from './computer/ocu'
import { SckDisplayBackend } from './computer/sck'
import { BrokerHub } from './computer/broker'
import { RtcViewers } from './computer/rtc'
import { VideoFeed } from './computer/video'
import { ComputerRouter } from './computer/router'
import { ComputerService } from './computer/service'
import { COMPUTER_GUIDE, registerComputerTools } from './computer/tools'
import { TerminalService } from './workspace/pty'
import { createDispatcher } from './ipc'
import { OperationLog, runOnce } from './ipc/operationLog'
import { ScheduleService, scheduleSchema } from './background/schedules'
import { PullRequestWatchService } from './background/pullRequestWatches'
import { runtimeBuild, runtimeVersion } from './build'
import { ReviewService } from './review/reviews'
import { RecapService } from './memory/recaps'
import { MemoryService, registerMemoryTools } from './memory/memory'
import { RuleStore } from './rules/rules'
import { SummaryService, registerLibraryTools, withoutTools } from './memory/summaries'
import { discoverSkills } from './context'
import { NO_PROJECT, type AgentSessionInfo, type ScheduleInput } from '@ramu/shared/types'

const config = loadConfig()
const { userData, socketPath } = config
mkdirSync(userData, { recursive: true })
// Network clients present either their own device token (see `ramu pair`) or the older shared token.
const remoteTokens = config.allowLegacyToken ? new TokenStore(config.tokenPath) : null
const devices = new DeviceStore(config.devicesPath, config.deviceLifetimeMs)
const remoteAccess = new RemoteAccess({
  devices,
  browserOrigins: config.browserOrigins,
  ...(remoteTokens ? { legacyToken: () => remoteTokens.current() } : {}),
})
const presence = new HostPresence(join(userData, 'presence.json'), (id) => devices.presenceKey(id))
const stopPresenceNetwork = runtimeNetwork.subscribe(() => {
  if (network.enabled) presence.announce()
  // A changed network or a wake may add or remove an interface to advertise on.
  void advertiser.refresh().catch(() => {})
})
// Nearby discovery: advertises the bound listener only while access and Discoverable are both on.
const advertiser = new HostAdvertiser({ hostId: readDiscoveryHostId(join(userData, 'discovery.json')) })
// `--listen` / RAMU_LISTEN wins and cannot be changed from Settings. Otherwise Settings decides, and applies without a restart.
let network: NetworkSetting = config.listen
  ? {
      enabled: true,
      host: config.listen.host,
      port: config.listen.port,
      acceptUnencrypted: true,
      discoverable: config.discoverable,
    }
  : readNetworkSetting(config.networkPath, Boolean(config.tls))
// A launchd instance can supervise a daemon that was started by the UI without interrupting it.
// Intentional stops exit successfully; crashes let launchd restart or take over execution.
const stoppedPath = join(userData, 'background.stopped')
const serviceBuild = runtimeBuild(process.argv[1] ?? '')
const serviceVersion = runtimeVersion(process.argv[1] ?? '')
if (process.env.RAMU_SUPERVISOR === '1') {
  try {
    unlinkSync(stoppedPath)
  } catch {}
  for (;;) {
    try {
      await runtimeInvoke(socketPath, 'background.status')
    } catch {
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
    try {
      readFileSync(stoppedPath)
      process.exit(0)
    } catch {}
  }
}
const ownerPath = join(userData, 'runtime-owner')
let owned = false
for (let attempts = 0; attempts < 20 && !owned; attempts++) {
  try {
    mkdirSync(ownerPath, { mode: 0o700 })
    writeFileSync(join(ownerPath, 'pid'), String(process.pid))
    owned = true
  } catch {
    try {
      const pid = Number(readFileSync(join(ownerPath, 'pid'), 'utf8'))
      if (!Number.isInteger(pid) || pid < 1) throw new Error('Invalid owner')
      try {
        process.kill(pid, 0)
        process.exit(0)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
      rmSync(ownerPath, { recursive: true, force: true })
    } catch {
      let stale = false
      try {
        stale = Date.now() - statSync(ownerPath).mtimeMs > 10000
      } catch {}
      if (stale) rmSync(ownerPath, { recursive: true, force: true })
      else await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
}
if (!owned) throw new Error('Another service is starting; try again shortly')
process.once('exit', () => {
  try {
    if (readFileSync(join(ownerPath, 'pid'), 'utf8') === String(process.pid))
      rmSync(ownerPath, { recursive: true, force: true })
  } catch {}
})
try {
  unlinkSync(socketPath)
} catch {}
const clients = new Set<ServerResponse>()
// Only clients on the local socket can answer native dialogs; a remote client's folder picker would open on the wrong machine.
const hostClients = new Set<ServerResponse>()
const desktopClients = new Map<string, ServerResponse>()
const hostBrowser = new HostBrowser(
  join(userData, 'host-browser'),
  () => {
    for (const client of clients)
      if (!client.destroyed && client.writableLength < 1024 * 1024)
        client.write(`data: ${JSON.stringify({ channel: 'hostBrowser:changed', payload: {} })}\n\n`)
  },
  (tab) => {
    for (const client of clients)
      if (!client.destroyed && client.writableLength < 1024 * 1024)
        client.write(`data: ${JSON.stringify({ channel: 'hostBrowser:present', payload: tab })}\n\n`)
  },
  (id) => devices.list().some((device) => device.id === id && device.role !== 'viewer'),
)
const browserBroker = new DesktopBrowserBroker(
  (clientId, request) => {
    const client = desktopClients.get(clientId)
    if (!client || client.destroyed || client.writableLength > 1024 * 1024) return false
    return (
      client.write(`data: ${JSON.stringify({ channel: 'browser:operation', payload: request })}\n\n`) ||
      !client.destroyed
    )
  },
  30000,
  hostBrowser,
)
const nativeRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
>()
const send = (channel: string, payload: unknown) => {
  const message = `data: ${JSON.stringify({ channel, payload })}\n\n`
  for (const client of clients) {
    if (client.writableLength > 8 * 1024 * 1024) {
      client.destroy()
      clients.delete(client)
      hostClients.delete(client)
    } else client.write(message)
  }
}
const changed = () => send('automation:changed', {})
const db = openDb(join(userData, 'ramu.db'))
const root = process.env.RAMU_WORKTREES ?? join(homedir(), '.ramu', 'worktrees')
mkdirSync(root, { recursive: true })
const workspace = new Workspace(db, root)
configureMcpSharing(() => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {}))
migrateLearningDefault(workspace)
workspace.settingsStore = new SettingsStore(userData, {
  preferences: workspace.getAppState('app-preferences', {}),
  models: workspace.getAppState('model-preferences', null),
})
const fake = process.env.RAMU_FAKE_AGENT === '1' ? await import('./providers/fakeAgent') : null
const browserAccessEpochs = new Map<string, number>()
let reviews!: ReviewService
const mobilePush = new MobilePush(
  join(userData, 'mobile-push.json'),
  () => devices.list(),
  fetch,
  (sessionId) => schedules.hasSession(sessionId),
)
const computerBroker = new BrokerHub()
const computerVideo = new RtcViewers(new VideoFeed(), (threadId, deviceId) => {
  const access = computer.viewerAccess(threadId, deviceId)
  return access.observe && !!computer.session(threadId)
})
const ocuBackend = new OcuBackend(
  undefined,
  undefined,
  () => workspace.getAppState<boolean>('computer:globalPointer', false) === true,
)
const computer = new ComputerService(new ComputerRouter(new SckDisplayBackend(new MacosComputerBackend()), ocuBackend))
const agents = new AgentService(
  db,
  (sessionId, event, seq, revision) => {
    send('agent:event', { sessionId, event, seq, revision })
    if (event.kind === 'state' && ['idle', 'failed', 'stopped'].includes(event.state)) {
      browserAccessEpochs.set(sessionId, (browserAccessEpochs.get(sessionId) ?? 0) + 1)
      try {
        browserBroker.endRun(agents.get(sessionId).taskId, sessionId)
      } catch {}
      try {
        computer.endRun(agents.get(sessionId).taskId, sessionId)
      } catch {}
    }
    threadTitles?.observe(sessionId, event)
    queueMicrotask(() => {
      try {
        inbox.observe(agents.get(sessionId), event)
        mobilePush.observe(agents.get(sessionId), event, agents.getGoal(sessionId))
        if (['state', 'permission', 'question', 'goal'].includes(event.kind)) mobileLiveActivities.observe()
      } catch {}
    })
  },
  fake?.fakeQuery ?? query,
  fake?.fakeCodex,
)
const threadTitles = new ThreadTitles(
  db,
  workspace,
  agents,
  () => send('workspace:changed', {}),
  undefined,
  (session) => providerAdapter(session.provider).native?.titles === true,
)
agents.providerTitle = (sessionId, title) => void threadTitles.acceptProviderTitle(sessionId, title)
const mobileLiveActivities = new MobileLiveActivities(
  join(userData, 'mobile-live-activities.json'),
  () => devices.list(),
  () => agents.counts(),
)
if (fake) agents.helperHistory = async () => []
agents.markRestoredOnBoot()
const terminals = new TerminalService(
  (id, data, cursor) => send('term:data', { id, data, cursor }),
  (id, code) => send('term:exit', { id, code }),
  (taskId) => send('term:changed', { taskId }),
  new SqliteBackgroundTerminalHistory(db),
)
const inbox = new NoticeInbox(
  (items) => send('notices:changed', items),
  (taskId) => {
    try {
      return workspace.getTask(taskId).title
    } catch {
      return 'Thread'
    }
  },
)
const diagnostics = new LocalDiagnostics(workspace)
process.on('uncaughtExceptionMonitor', (error) => diagnostics.record('service-crash', error))
const schedules = new ScheduleService(
  db,
  workspace,
  agents,
  changed,
  () => void mobilePush.deliverScheduleFailure().catch(() => {}),
)
const pullRequestWatches = new PullRequestWatchService(db, workspace, agents, changed)
schedules.recover()
// eslint-disable-next-line prefer-const -- declared earlier because closures built before this point reference it
reviews = new ReviewService(db, workspace, agents, join(userData, 'reviews'), changed)
reviews.recover()
agents.reviewHooks = {
  begin: (taskId, scope) => reviews!.begin(taskId, scope),
  bind: (id, sessionId) => reviews!.bind(id, sessionId),
  abandon: (id, error) => reviews!.abandon(id, error),
  followup: (sessionId) => reviews!.beforeFollowup(sessionId),
  complete: (sessionId) => reviews!.complete(sessionId),
  validateFeedback: (reviewId) => reviews!.requireOriginalCheckout(reviewId),
}
const recaps = new RecapService(db, workspace, agents, changed, () => void mobilePush.deliverDigest().catch(() => {}))
const memory = new MemoryService(db, workspace, agents, () => send('memory:changed', {}), join(userData, 'memory'))
memory.start()
const learning = new LearningService(
  db,
  workspace,
  agents,
  memory,
  join(userData, 'skills'),
  () => send('memory:changed', {}),
  // A better checkpoint is written ahead of an early switch (an add-on: the handoff never waits for it).
  (session) =>
    crossedSwitchAt(
      agents.usage?.list({ [session.provider]: session.settings.accountId ?? 'default' }) ?? [],
      session.settings,
      agents.preferences?.()?.fallback.switchAt ?? DEFAULT_FALLBACK_PREFERENCES.switchAt,
    ),
)
const externalSkills = new ExternalSkills(learning, workspace)
// Skills a person shares from their own provider folders reach every provider and account through the same export.
learning.sharedSkills = ({ projectId, provider, accountId, cwd }) => {
  const sharing = workspace.getAppState<SkillSharing>(SKILL_SHARING_KEY, {})
  if (!Object.values(sharing).some(Boolean)) return []
  const project = projectId ? workspace.listProjects().find((entry) => entry.id === projectId) : undefined
  const dirs = [
    cwd,
    ...(project?.root ? [project.root] : []),
    ...(projectId ? workspace.listRepositories(projectId).map((repo) => repo.root) : []),
  ]
  return sharedSessionSkills([...new Set(dirs)], provider, accountEnvironment(provider, accountId), sharing)
}
const summaries = new SummaryService(db, workspace, agents, memory, learning, (created) =>
  send('summaries:changed', { created }),
)
agents.sessionCheckpoint = (id) => learning.checkpoint(id)
agents.onRewound = (sessionId, seq) => send('agent:rewound', { sessionId, seq })
agents.learningInstructions = (session, options) =>
  [
    summaries.isReviewChat(session.taskId) ? '' : learning.instructions(session.id, options),
    summaries.instructions(session),
  ]
    .filter(Boolean)
    .join('\n\n')
const projectOf = (session: AgentSessionInfo) => {
  try {
    return workspace.getTask(session.taskId).projectId
  } catch {
    return null
  }
}
agents.memoryInstructions = (session) => memory.instructions(session, projectOf(session))
const rules = new RuleStore(db)
agents.rulesInstructions = (session) => rules.instructions(projectOf(session), session.provider)
agents.mcpDestination = (session, settings) => {
  const project = projectOf(session)
  return getSharedMcp().destinationAttention(
    settings.provider,
    settings.accountId ?? 'default',
    project && project !== NO_PROJECT ? project : null,
  )
}
// Calls that arrive over the network are marked, so a desktop dialog is never opened on this computer for someone else.
const origin = new AsyncLocalStorage<{ network: boolean; deviceId?: string }>()
const interactive = new InteractiveStore(db, (session, ref) => agents.interactivePublished(session, ref))
let sharedMcp: SharedMcpService | undefined
const getSharedMcp = () => {
  try {
    return (sharedMcp ??= new SharedMcpService(new SharedMcpStorage(workspace), undefined, () =>
      send('mcp:changed', {}),
    ))
  } catch {
    throw new Error('Shared MCP configuration could not be loaded. Restore valid configuration on this host.')
  }
}
const externalTools = new ExternalSessionTools(getSharedMcp, (sessionId, title, detail, signal) =>
  agents.requestPermission(sessionId, title, detail, signal),
)
const externalSource = (session: AgentSessionInfo): ExternalSessionSource => {
  const project = projectOf(session)
  return {
    sessionId: session.id,
    hostId: getSharedMcp().storage.hostId,
    provider: session.provider,
    accountId: session.settings.accountId ?? 'default',
    projectId: project && project !== NO_PROJECT ? project : null,
    // Review chats are restricted; sub-agents are helpers and never inherit external access by default.
    role: summaries.isReviewChat(session.taskId) ? 'restricted' : 'interactive',
    externalToolsAllowed: !session.parentId,
  }
}
const dispatcher = createDispatcher(
  {
    userData,
    canAdministerIntegrations: () => origin.getStore()?.network !== true,
    browserDevice: () => (origin.getStore()?.network ? origin.getStore()?.deviceId : 'local'),
    browserGrantEligible: (id) => devices.list().some((device) => device.id === id && device.role !== 'viewer'),
    send,
    native: (method, path) => {
      if (origin.getStore()?.network)
        return Promise.reject(
          new Error(
            'This opens a window on the host that runs Ramu, so it is not available from another host yet. Do it on that host.',
          ),
        )
      if (!hostClients.size) return Promise.reject(new Error('Open Ramu on this host to use this desktop action'))
      const requestId = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          nativeRequests.delete(requestId)
          reject(new Error('Desktop action timed out'))
        }, 120000)
        nativeRequests.set(requestId, { resolve, reject, timer })
        // Exactly one UI owns a desktop dialog/action.
        hostClients
          .values()
          .next()
          .value?.write(
            `data: ${JSON.stringify({ channel: 'host:request', payload: { requestId, method, path } })}\n\n`,
          )
      })
    },
  },
  {
    workspace,
    getSharedMcp,
    browser: browserBroker,
    hostBrowser,
    computer,
    computerBroker,
    computerVideo,
    terminals,
    agents,
    threadTitles,
    interactive,
    schedules,
    pullRequestWatches,
    recaps,
    reviews,
    memory,
    learning,
    externalSkills,
    diagnostics,
    summaries,
    rules,
    notices: inbox,
  },
)
const startedAt = Date.now()
let stopping = false
async function stop(intentional = false) {
  if (intentional) writeFileSync(stoppedPath, String(Date.now()))
  if (stopping) return
  stopping = true
  clearInterval(tick)
  await schedules.stop()
  await pullRequestWatches.stop()
  // Capture after the scheduler drains, so a chat that finished during that wait is not resumed.
  if (!intentional) agents.prepareForRestart()
  reviews.stop()
  await threadTitles?.stop()
  computerVideo.closeAll()
  // The app-control helper is a child process; end it with the server.
  void ocuBackend.close()
  agents.stopAll(!intentional)
  await Promise.all(workspace.listTasks().flatMap((task) => agents.list(task.id).map((s) => agents.stopAndWait(s.id))))
  await Promise.all(workspace.listTasks().flatMap((task) => agents.list(task.id).map((s) => reviews.complete(s.id))))
  await Promise.all([recaps.settle(), reviews.settle(), memory.settle(), learning.settle(), summaries.settle()])
  terminals.closeAll()
  await externalTools.close()
  await sharedMcp?.close()
  await hostBrowser.close()
  dispatcher.close()
  for (const c of clients) c.end()
  for (const r of nativeRequests.values()) {
    clearTimeout(r.timer)
    r.reject(new Error('Service stopping'))
  }
  clearInterval(heartbeat)
  clearInterval(pushReceipts)
  mobileLiveActivities.dispose()
  stopPresenceNetwork()
  void advertiser.stop()
  presence.close()
  clearTimeout(remoteRetry)
  mcpHttp.close()
  runtime.close()
  try {
    remote?.close()
  } catch {}
  db.close()
  try {
    unlinkSync(socketPath)
  } catch {}
  process.exit(0)
}
async function rawBody(req: import('node:http').IncomingMessage, limit = MAX_REQUEST_BYTES): Promise<string> {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    bytes += chunk.length
    if (bytes > limit) throw new Error('Request is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString()
}
const body = async (req: import('node:http').IncomingMessage): Promise<any> => decodeInvoke(await rawBody(req))
const capabilities = (): Capability[] => [
  CAPABILITIES.invoke,
  CAPABILITIES.events,
  CAPABILITIES.mobileCompanion,
  CAPABILITIES.liveActivities,
  CAPABILITIES.hostBrowser,
  CAPABILITIES.hostRequests,
  CAPABILITIES.operationKeys,
  ...(network.enabled ? [CAPABILITIES.remote, CAPABILITIES.pairing, CAPABILITIES.renewal] : []),
]
// Event streams of network clients stay open, so a revoked device must be cut off here, not only refused on its next request.
const remoteStreams = new Map<ServerResponse, string | undefined>()
const stillAuthorized = (header: string | undefined) => remoteAccess.authorized(header)
const dropRevoked = () => {
  for (const [stream, header] of remoteStreams) if (!stillAuthorized(header)) stream.end()
}
const json = { 'Content-Type': 'application/json' }
// Results of keyed mutations, kept briefly so a retry after a lost reply returns the first outcome instead of running twice.
const operations = new OperationLog<unknown>(10 * 60_000, 500)
// Identifies this server run; a client that sees it change knows the host restarted and every cursor it held is void.
const runEpoch = randomUUID()
// One handler serves both transports. Requests over TCP (`remote`) must present the bearer token.
const handle = (remote: boolean) => async (req: import('node:http').IncomingMessage, res: ServerResponse) => {
  try {
    let device: DeviceInfo | undefined
    if (remote) {
      const authenticated = await remoteAccess.accept(req, res)
      if (authenticated === undefined) return
      device = authenticated ?? undefined
    }
    const deviceId = device?.id
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/events' && req.method === 'GET') {
      if (remote && deviceId && req.socket.remoteAddress)
        presence.register(deviceId, req.socket.remoteAddress, Number(req.headers['x-ramu-presence-port']))
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
      res.write(': connected\n\n')
      res.write(`data: ${JSON.stringify({ channel: 'background:epoch', payload: { epoch: runEpoch } })}\n\n`)
      clients.add(res)
      const clientId =
        !remote &&
        typeof req.headers['x-ramu-desktop-client'] === 'string' &&
        /^[a-zA-Z0-9-]{1,100}$/.test(req.headers['x-ramu-desktop-client'])
          ? req.headers['x-ramu-desktop-client']
          : null
      if (!remote) {
        hostClients.add(res)
        if (clientId) {
          if (desktopClients.has(clientId)) browserBroker.detach(clientId)
          desktopClients.set(clientId, res)
        }
      } else remoteStreams.set(res, req.headers.authorization)
      res.on('close', () => {
        clients.delete(res)
        hostClients.delete(res)
        if (clientId && desktopClients.get(clientId) === res) {
          desktopClients.delete(clientId)
          browserBroker.detach(clientId)
        }
        remoteStreams.delete(res)
      })
      return
    }
    if (req.method !== 'POST' || path !== '/invoke') {
      res.writeHead(404).end()
      return
    }
    const { method, args, operationKey } = await body(req)
    if (operationKey !== undefined && !(typeof operationKey === 'string' && OPERATION_KEY_PATTERN.test(operationKey)))
      throw new Error('Invalid operation key.')
    if (remote && !deviceMayInvoke(device, method)) {
      res
        .writeHead(403, json)
        .end(JSON.stringify({ error: 'This device is a viewer. This action requires full access.' }))
      return
    }
    let value: unknown
    if (method === 'browser.bridge.attach') {
      if (remote || typeof args?.[0] !== 'string' || !desktopClients.has(args[0]))
        throw new Error('A local desktop event stream is required.')
      // A desktop that is gone (quit, crashed) must not keep the browser from a new one that is connected.
      const owner = browserBroker.owner()
      if (owner && owner !== args[0] && !desktopClients.has(owner)) browserBroker.detach(owner)
      value = browserBroker.attach(args[0])
    } else if (method === 'browser.bridge.ready') {
      if (remote || typeof args?.[0] !== 'string' || typeof args?.[1] !== 'string')
        throw new Error('Invalid local browser connection.')
      browserBroker.ready(args[0], args[1])
    } else if (method === 'browser.bridge.reply') {
      if (
        remote ||
        !Array.isArray(args) ||
        !args.slice(0, 3).every((item) => typeof item === 'string' && item.length <= 100)
      )
        throw new Error('Invalid local browser response.')
      browserBroker.reply(args[0], args[1], args[2], args[3], typeof args[4] === 'string' ? args[4] : undefined)
    } else if (method === 'host.reply') {
      if (remote) throw new Error('Desktop actions are only available on this host')
      const request = nativeRequests.get(args?.[0])
      if (request) {
        clearTimeout(request.timer)
        nativeRequests.delete(args[0])
        args[2] ? request.reject(new Error(String(args[2]))) : request.resolve(args[1])
      }
    } else if (method === 'notifications.register') {
      if (!deviceId || typeof args?.[0] !== 'string' || typeof args?.[1] !== 'string')
        throw new Error('Push registration requires a paired phone')
      mobilePush.register(deviceId, args[0], args[1], args[2])
    } else if (method === 'notifications.unregister') {
      if (!deviceId) throw new Error('Push registration requires a paired phone')
      mobilePush.remove(deviceId)
    } else if (method === 'liveActivity.status') {
      if (!deviceId) throw new Error('Live Activities require a paired phone')
      value = { enabled: mobileLiveActivities.enabled }
    } else if (method === 'liveActivity.register') {
      if (!deviceId) throw new Error('Live Activities require a paired phone')
      value = mobileLiveActivities.register(deviceId, args?.[0])
    } else if (method === 'liveActivity.unregister') {
      if (!deviceId || typeof args?.[0] !== 'string') throw new Error('Live Activities require a paired phone')
      mobileLiveActivities.remove(deviceId, args[0])
    } else if (method === 'background.status')
      value = {
        running: true,
        hostname: hostname(),
        platform: process.platform,
        pid: process.pid,
        startedAt,
        build: serviceBuild,
        version: serviceVersion,
        protocol: PROTOCOL_VERSION,
        capabilities: capabilities(),
        access: accessOf(device),
        ...(network.enabled ? { listening: `${network.host}:${network.port}`, tls: Boolean(config.tls) } : {}),
      }
    else if (method.startsWith('network.')) {
      if (remote) throw new Error('Network access is managed from the host running Ramu')
      value = await networkMethod(method, args)
    } else if (method === 'background.stop') {
      res.writeHead(200, json).end('{}')
      void stop(true)
      return
    } else if (method === 'background.restart') {
      res.writeHead(200, json).end('{}')
      void stop()
      return
    } else {
      const dispatch = async () =>
        await origin.run({ network: remote, deviceId }, () => dispatcher.invoke(method, args))
      value = operationKey
        ? await runOnce(operations, deviceId ?? 'local', operationKey, method, args, dispatch)
        : await dispatch()
    }
    res.writeHead(200, json).end(JSON.stringify({ value }))
  } catch (error) {
    if (!res.headersSent) res.writeHead(400, json)
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}
const runtime = createServer(handle(false))
let remote: ReturnType<typeof createServer> | null = null
let remoteError: string | null = null
let remoteRetry: NodeJS.Timeout | undefined
// Per-agent bearer credentials bind tool calls to their originating chat, including no-project chats.
const browserTokens = new Map<string, string>()
const sessions = new Map<
  string,
  { session: AgentSessionInfo; toolSearch: boolean; browser?: import('@ramu/shared/browser').AgentBrowserPreferences }
>()
const mcpHttp = createServer(async (req, res) => {
  const token = req.headers.authorization?.replace(/^Bearer /, '')
  const connection = token ? sessions.get(token) : undefined
  const source = connection?.session
  if (!source || (req.url !== '/mcp' && req.url !== '/mcp/external') || stopping) {
    res.writeHead(401).end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  if (req.url === '/mcp/external') {
    // External tools stay off the trusted Ramu registry: a separate endpoint and server name, gated by Shared MCP policy.
    try {
      await externalTools.serve(externalSource(source), req, res, await body(req))
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
    return
  }
  const target = new McpServer({ name: 'ramu', version: '0.1.0' })
  const registry = new ToolRegistry(target, connection!.toolSearch)
  // A review chat about learned memories gets Ramu's memory and skill tools and nothing else: later registrations are ignored.
  const review = summaries.isReviewChat(source.taskId)
  if (review)
    registerLibraryTools(
      registry.server,
      { memory, learning, db, installedSkills: () => discoverSkills(workspace.agentScope(source.taskId)) },
      source,
    )
  const server = review ? withoutTools(registry.server) : registry.server
  if (!review) registerInteractiveTools(server, interactive, source.id)
  if (!review)
    registerBackgroundTerminalTools(
      server,
      terminals,
      source,
      () => agents.get(source.id),
      (detail, signal) => agents.requestPermission(source.id, 'Background command', detail, signal),
    )
  if (!review) registerThemeTools(server, (theme) => agents.themeProposed(source.id, theme))
  if (!review)
    registerBrowserTools(
      server,
      browserBroker,
      source,
      () => agents.get(source.id),
      connection!.browser,
      () => browserTokens.get(source.id) === token,
      (detail, signal) => agents.requestPermission(source.id, 'Ramu integrated browser', detail, signal),
      () => browserAccessEpochs.get(source.id) ?? 0,
    )
  if (!review && workspace.getAppState<boolean>('computer:enabled', false) === true)
    registerComputerTools(
      server,
      computer,
      source,
      () => agents.get(source.id),
      () => browserTokens.get(source.id) === token,
    )
  if (!review) externalSkills.register(server, agents, source.id)
  if (!review) pullRequestWatches.register(server, source.id)
  // A chat keeps the settings it launched with, so its tools match its instructions until it relaunches. Turning a
  // setting off mid-thread keeps its tools listed, and their handlers refuse.
  const launched = agents.launchSettings(source.id)
  learning.register(server, source.id, launched.crossThreadRecall)
  // With async questions off, Claude and Codex ask through their own blocking question tools instead.
  if (usesRamuQuestionTools(launched.asyncQuestions, source)) registerQuestionTools(server, agents, source.id)
  if (!source.parentId) registerGoalTools(server, agents, source.id)
  if (launched.advisor) registerAdvisorTools(server, agents, source.id)
  if (launched.memory) registerMemoryTools(server, memory, source, projectOf(source))
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const scope = workspace.getTask(source.taskId)
  const input = scheduleSchema
    .omit({ sourceTaskId: true })
    .extend({ projectId: scheduleSchema.shape.projectId.optional(), workspaceId: scheduleSchema.shape.workspaceId })
  const resolve = (
    value: Omit<ScheduleInput, 'sourceTaskId' | 'projectId'> & { projectId?: string },
  ): ScheduleInput => ({
    ...value,
    projectId: value.projectId ?? scope.projectId,
    workspaceId:
      value.workspaceId === undefined && (!value.projectId || value.projectId === scope.projectId)
        ? scope.workspaceId
        : value.workspaceId,
    sourceTaskId: scope.id,
  })
  const descriptions = {
    schedule_create:
      'Create a one-time or repeating agent schedule when the user requests it. Interpret dates using the current time and requested timezone. Ask about ambiguous timing. Defaults to the current thread scope. Return the saved schedule and next run.',
    schedule_update: 'Edit an existing schedule using its ID and full replacement configuration.',
  }
  const checkReview = (reviewId: string) => {
    const review = reviews!.get(reviewId)
    if (review.sessionId !== source.id) throw new Error('This review belongs to another agent session')
    return review
  }
  server.registerTool(
    'review_reply',
    {
      description:
        'Reply to a selected review discussion after fixing or investigating it. Explain the change and any remaining limitations. suggestResolved only suggests closure; the human must resolve the thread. Never edit human comments.',
      inputSchema: {
        reviewId: z.string(),
        threadId: z.string(),
        text: z.string().min(1).max(10000),
        suggestResolved: z.boolean().default(false),
      },
    },
    async ({ reviewId, threadId, text, suggestResolved }) => {
      checkReview(reviewId)
      return result(reviews!.agentReply(reviewId, threadId, text, suggestResolved))
    },
  )
  server.registerTool(
    'schedule_create',
    { description: descriptions.schedule_create, inputSchema: input.shape },
    async (value) => {
      const saved = schedules.save(resolve(value))
      agents.scheduleSaved(source.id, saved)
      return result(saved)
    },
  )
  server.registerTool(
    'schedule_update',
    { description: descriptions.schedule_update, inputSchema: { id: z.string(), input } },
    async (value) => {
      const saved = schedules.save(resolve(value.input), value.id)
      agents.scheduleSaved(source.id, saved)
      return result(saved)
    },
  )
  // Codex asks this before one of its own sub-agents starts (see CODEX_HOOK_CONFIG); the answer is the hook's JSON output.
  server.registerTool(
    'codex_pre_tool_use',
    {
      description: "Used by Ramu's Codex hook; not for the model.",
      inputSchema: {
        tool_name: z.string().optional(),
        tool_input: z.any().optional(),
        session_id: z.string().optional(),
      },
    },
    async (value) => {
      const decision = await agents.codexSpawnDecision(source.id, value.tool_input).catch(() => null)
      return result(
        decision
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'deny',
                permissionDecisionReason: decision.reason,
              },
            }
          : {},
      )
    },
  )
  // Sub-agents Ramu runs on another provider or model; a sub-agent itself does not get the tool.
  if (!agents.get(source.id).parentId)
    server.registerTool(
      'ramu_agent',
      {
        description:
          "Start a sub-agent through Ramu, which may run it on a different provider or model than you. Use it when told to, or when the Agent tool is refused. It takes a description, a prompt and optionally a type, a name and background. Without background it waits and returns the sub-agent's report; with background it returns at once and the report arrives later as a message.",
        inputSchema: {
          description: z.string().min(1).max(200),
          prompt: z.string().min(1).max(100000),
          type: z.string().max(80).optional(),
          name: z.string().max(80).optional(),
          background: z.boolean().optional(),
        },
      },
      async (value, extra) => {
        try {
          return result(await agents.spawnSubagent(source.id, value, extra.signal))
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  // A Ramu-run sub-agent talks to the chat that started it; the chat answers its questions.
  if (agents.get(source.id).parentId) {
    server.registerTool(
      'message_parent',
      {
        description:
          'Send the agent that started you a short note (a finding, a blocker, progress) without stopping. It does not wait for a reply. Finish with your report as usual.',
        inputSchema: { text: z.string().min(1).max(20000) },
      },
      async ({ text }) => {
        try {
          await agents.messageParent(source.id, text)
          return result({ sent: true })
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
    server.registerTool(
      'ask_parent',
      {
        description:
          'Ask the agent that started you a question and wait for the answer. Use it only when you cannot continue without it. If no answer comes you are told to carry on with your best judgment.',
        inputSchema: { question: z.string().min(1).max(20000) },
      },
      async ({ question }, extra) => {
        try {
          return result({ answer: await agents.askParent(source.id, question, extra.signal) })
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  } else
    server.registerTool(
      'answer_subagent',
      {
        description:
          'Answer a question a sub-agent asked you (the message names the agent id). The sub-agent then continues.',
        inputSchema: { agent: z.string(), text: z.string().min(1).max(20000) },
      },
      async ({ agent, text }) => {
        try {
          agents.answerSubagent(source.id, agent, text)
          return result({ delivered: true })
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  server.registerTool(
    'schedule_list',
    { description: 'List saved schedules and next execution times.', inputSchema: {} },
    async () => result(schedules.list()),
  )
  server.registerTool(
    'schedule_pause',
    { description: 'Pause or resume a schedule.', inputSchema: { id: z.string(), paused: z.boolean() } },
    async ({ id, paused }) => result(schedules.pause(id, paused)),
  )
  server.registerTool(
    'schedule_run_now',
    { description: 'Run a schedule now without changing its recurrence.', inputSchema: { id: z.string() } },
    async ({ id }) => result(schedules.runNow(id)),
  )
  server.registerTool(
    'schedule_delete',
    {
      description: 'Delete a schedule when requested. Existing run threads remain available.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      schedules.delete(id)
      return result({ deleted: id })
    },
  )
  server.registerTool(
    'schedule_context',
    {
      description: 'Get current time, timezone, project and isolated workspace choices before creating a schedule.',
      inputSchema: {},
    },
    async () =>
      result({
        now: new Date().toISOString(),
        preferences: workspace.getAppState('app-preferences', {}),
        currentProjectId: scope.projectId,
        currentWorkspaceId: scope.workspaceId,
        currentSettings: source.settings,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        projects: workspace.listProjects(),
        workspaces: workspace.listWorkspaces(),
      }),
  )
  registry.expose()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  try {
    await server.connect(transport)
    await transport.handleRequest(req, res, await body(req))
  } catch {
    if (!res.headersSent) res.writeHead(500).end()
  }
})
await new Promise<void>((resolve, reject) => {
  mcpHttp.once('error', reject)
  mcpHttp.listen(0, '127.0.0.1', resolve)
})
const address = mcpHttp.address() as import('node:net').AddressInfo
agents.toolConnection = (session) => {
  const token = randomBytes(32).toString('hex')
  browserTokens.set(session.id, token)
  const browserPreferences = structuredClone(
    workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).agentBrowser ??
      DEFAULT_AGENT_BROWSER_PREFERENCES,
  )
  sessions.set(token, {
    session,
    browser: browserPreferences,
    toolSearch:
      !summaries.isReviewChat(session.taskId) &&
      (workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).intelligence?.toolSearch ?? true),
  })
  const review = summaries.isReviewChat(session.taskId)
  const projectId = projectOf(session)
  const projectRoot = workspace.listProjects().find((project) => project.id === projectId)?.root
  const mcpConfigDirs =
    projectId && projectId !== NO_PROJECT
      ? [
          ...(projectRoot ? [projectRoot] : []),
          ...workspace.listBindings(session.taskId).map((binding) => workspace.getRepository(binding.repoId).root),
        ]
      : []
  const skillsDir = review
    ? null
    : learning.exportDir(projectOf(session), session.provider, session.cwd, session.settings.accountId ?? 'default')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    token,
    ...(review ? { restricted: true } : {}),
    ...(() => {
      if (review) return {}
      const integrated =
        (browserPreferences?.providerOverrides[session.provider] ?? browserPreferences?.agentBrowser) === 'integrated'
      const computerOn = workspace.getAppState<boolean>('computer:enabled', false) === true
      const parts = [...(integrated ? [INTEGRATED_BROWSER_GUIDE] : []), ...(computerOn ? [COMPUTER_GUIDE] : [])]
      return parts.length ? { browserInstructions: parts.join('\n\n') } : {}
    })(),
    ...(mcpConfigDirs.length ? { mcpConfigDirs } : {}),
    ...(skillsDir ? { skillsDir } : {}),
    ...(() => {
      try {
        return hasExternalConnections(getSharedMcp(), externalSource(session))
          ? { externalUrl: `http://127.0.0.1:${address.port}/mcp/external` }
          : {}
      } catch {
        return {}
      }
    })(),
  }
}
// Never unlink a socket owned by another live service. The launcher removes stale sockets first.
await new Promise<void>((resolve, reject) => {
  runtime.once('error', reject)
  runtime.listen(socketPath, resolve)
})
chmodSync(socketPath, 0o600)
// A VPN address can be missing at boot (the interface comes up after this service). Keep the local socket and agents
// running and retry the network listener rather than exiting into a restart loop.
function listenRemote(server: NonNullable<typeof remote>, attempt = 0) {
  const { host, port } = network
  const failed = (error: NodeJS.ErrnoException) => {
    if (remote !== server) return
    remoteError = error.code ?? error.message
    const delay = Math.min(30000, 1000 * 2 ** attempt)
    console.error(
      `Ramu cannot listen on ${host}:${port} (${remoteError}). Local clients still work; retrying in ${Math.round(delay / 1000)}s.`,
    )
    remoteRetry = setTimeout(() => {
      if (remote === server && !stopping) listenRemote(server, attempt + 1)
    }, delay)
  }
  server.once('error', failed)
  server.listen(port, host, () => {
    server.off('error', failed)
    remoteError = null
    presence.announce()
    server.on('error', (error) => console.error(`Ramu network listener error: ${error.message}`))
    syncDiscovery()
    console.log(
      `Ramu server listening on ${config.tls ? 'https' : 'http'}://${host}:${port}; pair a device with \`ramu pair\``,
    )
  })
}
function startRemote() {
  if (!network.enabled || stopping) return
  remoteError = null
  const server = (remote = config.tls
    ? createHttpsServer({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }, handle(true))
    : createServer(handle(true)))
  listenRemote(server)
}
/** Advertises the address the listener bound, and only while both settings allow it. Never affects the listener. */
function syncDiscovery() {
  if (network.enabled && network.discoverable && remote?.listening)
    void advertiser.start({ host: network.host, port: network.port, tls: Boolean(config.tls) }).catch(() => {})
  else void advertiser.stop()
}
function stopRemote() {
  clearTimeout(remoteRetry)
  void advertiser.stop()
  const old = remote
  remote = null
  remoteError = null
  // Event streams from paired devices would keep a closing server open; they reconnect (or are refused) afterwards.
  if (old) {
    try {
      old.close()
    } catch {}
    old.closeAllConnections()
  }
}
function networkStatus() {
  return {
    enabled: network.enabled,
    listening: Boolean(remote?.listening),
    discovery: {
      discoverable: network.discoverable,
      ...advertiser.status(),
      name: discoveryName(),
    },
    host: network.host,
    port: network.port,
    source: config.listen ? ('command-line' as const) : ('settings' as const),
    tls: Boolean(config.tls),
    error: remoteError,
    addresses: localAddresses(),
    devices: devices.list(),
    deviceLifetime: devices.lifetime(),
    offers: devices.offers(),
  }
}
async function networkMethod(method: string, args: unknown[]) {
  if (method === 'network.status') return networkStatus()
  if (method === 'network.configure') {
    if (config.listen) throw new Error('Network access was set with --listen; change it there')
    const input = args[0] as { discoverable?: unknown } | null
    // A client that predates discovery leaves the choice out; that keeps the saved one rather than switching it off.
    const next = validateNetworkSetting(
      input && typeof input === 'object' && input.discoverable === undefined
        ? { ...input, discoverable: network.discoverable }
        : args[0],
      Boolean(config.tls),
    )
    writeNetworkSetting(config.networkPath, next)
    const moved = next.enabled !== network.enabled || next.host !== network.host || next.port !== network.port
    network = next
    if (moved || (next.enabled && !remote)) {
      stopRemote()
      startRemote()
    } else syncDiscovery()
    // Turning access off also drops every connected device: their tokens stay valid but nothing is listening for them.
    return networkStatus()
  }
  if (method === 'network.pair') {
    if (!network.enabled) throw new Error('Turn on network access first')
    const role = args[0] ?? 'owner'
    if (role !== 'owner' && role !== 'viewer') throw new Error('Invalid device role')
    const owner = typeof args[1] === 'string' && args[1].length > 0 && args[1].length <= 80 ? args[1] : undefined
    const { code, expiresAt, offerId } = devices.createCode(Date.now(), role, owner)
    return { offerId, code, expiresAt, urls: candidateUrls(network.host, network.port, Boolean(config.tls)) }
  }
  if (method === 'network.cancelOffer') {
    if (typeof args[0] !== 'string') throw new Error('Invalid offer')
    return devices.cancelOffer(args[0])
  }
  if (method === 'network.offer') {
    if (typeof args[0] !== 'string') throw new Error('Invalid offer')
    return devices.offerStatus(args[0])
  }
  if (method === 'network.setDeviceLifetime') {
    const days = args[0]
    if (days !== null && !validLifetime(days)) throw new Error('Choose 1 to 3650 days, or never')
    devices.setLifetime(days)
    return networkStatus()
  }
  if (method === 'network.revoke') {
    if (typeof args[0] !== 'string') throw new Error('Invalid device')
    devices.revoke(args[0])
    dropRevoked()
    return networkStatus()
  }
  throw new Error(`Unknown method ${method}`)
}
startRemote()
// Proxies and mobile networks drop idle event streams; a comment line every 20 s keeps them open.
const pushReceipts = setInterval(() => {
  void mobilePush.checkReceipts().catch(() => {})
}, 15 * 60_000)
const heartbeat = setInterval(() => {
  dropRevoked()
  try {
    mobilePush.prune()
    void mobileLiveActivities.flush().catch(() => {})
  } catch {
    /* Push cleanup must not interrupt host agents. */
  }
  for (const client of clients) client.write(': ping\n\n')
}, 20000)
const tick = setInterval(() => {
  void agents.resumeInterruptedChats().catch(console.error)
  void schedules.tick().catch(console.error)
  void pullRequestWatches.tick().catch(console.error)
  void recaps.tick().catch(console.error)
  void memory.tick().catch(console.error)
  void learning.tick().catch(console.error)
  void summaries.tick().catch(console.error)
}, 5000)
// Restore helpers, resume interrupted chats and re-arm goals and usage-limit waits; tests pin this one call.
threadTitles.recover()
await agents.recoverOnBoot()
void schedules.tick().catch(console.error)
void recaps.tick().catch(console.error)
process.on('SIGTERM', () => void stop())
process.on('SIGINT', () => void stop())
