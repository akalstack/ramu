import { terminalThreadRequest } from './background/agentThreads'
import { NO_PROJECT_GUIDE, projectFactsText } from './workspace/projectCreate'
import { HELPER_ROLES } from '@ramu/shared/chat/helperRoles'
import { CustomAgentStore } from './agent/customAgents'
import { TEST_DEVICE_GUIDE, TestDevices } from './testDevice/testDevices'
import { customAgentList } from '@ramu/shared/customAgents'
import { ResourceService } from './background/resources'
import { processRoots } from './agent/processOwners'
import { writeEvent } from './remote/eventStream'
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
import {
  DEFAULT_AGENT_SETTINGS,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_FALLBACK_PREFERENCES,
  type AppPreferences,
  type ModelPreferences,
} from '@ramu/shared/types'
import { InteractiveStore } from './interactive/store'
import { ABILITIES, DEFAULT_ABILITY_PREFERENCES } from '@ramu/shared/providers/abilities'
import { AbilityService } from './agent/abilities'
import { abilityRunner } from './agent/abilityRuns'
import { registerAbilityTools } from './agent/abilityTools'
import { providerLogin } from './providers/abilityChecks'
import { AttachmentStore } from './attachments'
import { registerInteractiveTools } from './interactive/tools'
import { PageStore } from './interactive/pages'
import { ArtifactExports } from './interactive/exports'
import { PageAi, webSearch, type PageExternal, type PageExternalTool } from './interactive/pageAi'
import type { JsonValue } from '@ramu/shared/interactive'
import { PublicPages } from './interactive/publicPages'
import { PageAutomation, recheckLibraries } from './interactive/pageAutomation'
import { compileInteractive, pinnedLibraries } from './interactive/compile'
import { resolveInteractiveKit } from './interactive/kit'
import { previewInteractive } from './interactive/preview'
import { openHeadlessPage } from './interactive/pageHeadless'
import type { ArtifactInfo } from '@ramu/shared/artifacts'
import type { TunnelChoice } from '@ramu/shared/types'
import { registerThemeTools } from './themeTools'
import { registerBackgroundTerminalTools } from './agent/backgroundTerminalTools'
import { createDeploys } from './workspace/deploy/deploys'
import { LocalApps } from './workspace/deploy/localApp'
import { LiveDashboards, watchDashboards } from './interactive/liveDashboard'
import { tableFromFile } from './interactive/dashboardFile'
import { readText } from './workspace/files'
import { appliedDesignSystem, designTokensOf } from '@ramu/shared/artifacts'
import { registerDeployTools, registerReleaseTools } from './workspace/deploy/tools'
import { registerCiTools } from './workspace/ci/tools'
import { setAcpTerminalService } from './providers/acpTerminals'
import { SqliteBackgroundTerminalHistory } from './workspace/backgroundTerminalHistory'
import { ToolRegistry } from './agent/toolRegistry'
import { ExternalSkills } from './memory/externalSkills'
import { crossedSwitchAt, LearningService } from './memory/learning'
import { SettingsStore } from './settings/settingsStore'
import { SharedMcpStorage } from './mcp/storage'
import { SharedMcpService } from './mcp/service'
import { ExternalSessionTools, hasExternalConnections, type ExternalSessionSource } from './mcp/sessionTools'
import { allowedConnections, DUPLICATE_CHOICE_KEY, type DuplicateChoices } from './mcp/duplicates'
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
import { registerSecretTools } from './agent/secretTools'
import { SecretFiles } from './agent/secretFiles'
import { usesRamuQuestionTools } from './agent/nativeFeatures'
import { registerAdvisorTools } from './agent/advisor'
import { registerGoalTools } from './agent/goals'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { runtimeInvoke, runtimeNetwork } from '@ramu/client-runtime'
import { HostPresence } from './remote/presence'
import { completeOAuthCallback, HOSTED_CALLBACK_PATH, oauthPage } from './mcp/oauth'
import { serveSockets, type EventSink, type SocketHost } from './remote/socket'
import {
  CAPABILITIES,
  MAX_REQUEST_BYTES,
  OPERATION_KEY_PATTERN,
  PROTOCOL_VERSION,
  decodeInvoke,
  type Capability,
  type InvokeRequest,
} from '@ramu/contracts'
import { loadConfig } from './config'
import { DeviceStore, isHostAccess, validLifetime, type DeviceInfo } from './remote/devices'
import { RemoteAccess, accessOf, deviceMayInvoke } from './remote/access'
import { PermissionRequests } from './remote/permissionRequests'
import { PairBackInvites } from './remote/pairBackInvites'
import { deviceOsSchema, readHostOs } from './remote/hostOs'
import {
  DEVICE_PERMISSIONS,
  PERMISSION_DURATIONS,
  grantFor,
  isDevicePermission,
  permissionFor,
  permissionRefusal,
  type PermissionDuration,
} from '@ramu/shared/devicePermissions'
import { PairingRequests } from './remote/pairingRequests'
import { createPairingNotice } from './remote/pairingNotice'
import { clientAddress } from './remote/clientAddress'
import { parseTunnelChoice, TunnelManager } from './remote/tunnel'
import { HostAdvertiser, advertisedInterfaces, discoveryName, readDiscoveryHostId } from './remote/discovery'
import {
  candidateUrls,
  localAddresses,
  parsePublicUrl,
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
import { RtcViewers } from './computer/rtc'
import { VideoFeed } from './computer/video'
import { ComputerRouter } from './computer/router'
import { ComputerService } from './computer/service'
import { COMPUTER_GUIDE, registerComputerTools } from './computer/tools'
import { TerminalService } from './workspace/pty'
import { createDispatcher } from './ipc'
import { OperationLog, runOnce } from './ipc/operationLog'
import { ScheduleService, scheduleSchema } from './background/schedules'
import { WEBHOOK_PATH, WebhookReceiver, readWebhookBody } from './background/webhookReceiver'
import { PullRequestWatchService } from './background/pullRequestWatches'
import { PullRequestIndex } from './background/pullRequestIndex'
import { PullRequestDrafts } from './background/pullRequestDrafts'
import { AgentThreadService, hostThreadRequest } from './background/agentThreads'
import { describeValidationError } from './validation'
import { RemoteThreads } from './background/remoteThreads'
import { AgentHostService } from './remote/agentHosts'
import { runtimeBuild, runtimeVersion } from './build'
import { ReviewService } from './review/reviews'
import { RecapService } from './memory/recaps'
import { MemoryService, registerMemoryTools } from './memory/memory'
import { RuleStore } from './rules/rules'
import { SummaryService, registerLibraryTools, withoutTools } from './memory/summaries'
import { discoverSkills } from './context'
import { NO_PROJECT, type AgentSessionInfo, type ScheduleInput, type SetupOmission } from '@ramu/shared/types'

const config = loadConfig()
const { userData, socketPath } = config
mkdirSync(userData, { recursive: true })
// Network clients present either their own device token (see `ramu pair`) or the older shared token.
const devices = new DeviceStore(config.devicesPath, config.deviceLifetimeMs)
const hostId = readDiscoveryHostId(join(userData, 'discovery.json'))
const pairingRequests = new PairingRequests({
  devices,
  hostId,
  // Nearby devices may ask while this host lets itself be found, or while Pair a device is open.
  accepting: () => network.discoverable || devices.offers().length > 0,
  changed: () => pairingNotice(pairingRequests.list()),
})
// Only the desktop apps on this machine answer permission requests, like pairing; paired devices never see them.
/** What this host runs on; it does not change while the service runs. */
const hostOs = readHostOs()
const permissionRequests = new PermissionRequests(Date.now, (requests) => {
  const message = `data: ${JSON.stringify({ channel: 'permission:requests', payload: { requests } })}\n\n`
  for (const client of hostClients) if (!client.destroyed) writeEvent(client, message)
})
const pairBackInvites = new PairBackInvites(Date.now, (invites) => {
  const message = `data: ${JSON.stringify({ channel: 'pairBack:invites', payload: { invites } })}\n\n`
  for (const client of hostClients) if (!client.destroyed) writeEvent(client, message)
})
const remoteAccess = new RemoteAccess({
  devices,
  hostId,
  pairing: pairingRequests,
  paired: () => syncDiscovery(),
  peer: (req) => clientAddress(req, publicUrl() !== null).address,
  // The addresses the listener really serves, for a paired device to try when its saved one stops answering.
  routes: () => [
    ...publicCandidates().map((candidate) => candidate.url),
    ...(network.enabled
      ? advertisedInterfaces(network.host).flatMap((entry) =>
          entry.addresses.map(
            (address) =>
              `${config.tls ? 'https' : 'http'}://${address.includes(':') ? `[${address}]` : address}:${network.port}`,
          ),
        )
      : []),
  ],
  browserOrigins: config.browserOrigins,
})
const presence = new HostPresence(join(userData, 'presence.json'), (id) => devices.presenceKey(id))
const stopPresenceNetwork = runtimeNetwork.subscribe(() => {
  if (network.enabled) presence.announce()
  // A changed network or a wake may add or remove an interface to advertise on.
  void advertiser.refresh().catch(() => {})
})
// Nearby discovery: advertises the bound listener only while access and Discoverable are both on.
const advertiser = new HostAdvertiser({ hostId })
// `--listen` / RAMU_LISTEN wins and cannot be changed from Settings. Otherwise Settings decides, and applies without a restart.
let network: NetworkSetting = config.listen
  ? {
      enabled: true,
      host: config.listen.host,
      port: config.listen.port,
      acceptUnencrypted: true,
      discoverable: config.discoverable,
      publicUrl: null,
      tunnel: null,
    }
  : readNetworkSetting(config.networkPath, Boolean(config.tls))
// A tunnel Ramu runs itself (Cloudflare quick tunnel, Tailscale Funnel, ngrok), while the listener is up.
const tunnels = new TunnelManager()
/** Where a tunnel reaches this host's listener on this computer. */
const tunnelTarget = () => {
  const scheme = config.tls ? 'https' : 'http'
  const local = network.host === '0.0.0.0' || network.host === '::' || /^127\.|^::1$/.test(network.host)
  return `${scheme}://${local ? '127.0.0.1' : network.host.includes(':') ? `[${network.host}]` : network.host}:${network.port}`
}
const syncTunnel = () => tunnels.use(network.tunnel, network.enabled && remote?.listening ? tunnelTarget() : null)
/** A tunnel's address from the command line wins over the one saved in Settings. */
const publicUrl = () => config.publicUrl ?? (network.tunnel ? tunnels.address() : network.publicUrl)
/** The tunnel's address, first: it answers from anywhere, while the listener's own addresses answer only nearby. */
const publicCandidates = () => (network.enabled && publicUrl() ? [{ url: publicUrl()!, interface: 'tunnel' }] : [])
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
const clients = new Set<EventSink>()
// Only clients on the local socket can answer native dialogs; a remote client's folder picker would open on the wrong machine.
const hostClients = new Set<EventSink>()
const desktopClients = new Map<string, EventSink>()
const hostBrowser = new HostBrowser(
  join(userData, 'host-browser'),
  () => {
    for (const client of clients)
      if (!client.destroyed && client.writableLength < 1024 * 1024)
        writeEvent(client, `data: ${JSON.stringify({ channel: 'hostBrowser:changed', payload: {} })}\n\n`)
  },
  (tab) => {
    for (const client of clients)
      if (!client.destroyed && client.writableLength < 1024 * 1024)
        writeEvent(client, `data: ${JSON.stringify({ channel: 'hostBrowser:present', payload: tab })}\n\n`)
  },
  (id) => devices.list().some((device) => device.id === id && device.role !== 'viewer'),
)
const browserBroker = new DesktopBrowserBroker(
  (clientId, request) => {
    const client = desktopClients.get(clientId)
    if (!client || client.destroyed || client.writableLength > 1024 * 1024) return false
    return writeEvent(client, `data: ${JSON.stringify({ channel: 'browser:operation', payload: request })}\n\n`)
  },
  30000,
  hostBrowser,
  () => hostBrowser.announce(),
)
hostBrowser.useNativeWhen(() => browserBroker.isReady())
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
    } else writeEvent(client, message)
  }
}
const changed = () => send('automation:changed', {})
const db = openDb(join(userData, 'ramu.db'))
const root = process.env.RAMU_WORKTREES ?? join(homedir(), '.ramu', 'worktrees')
mkdirSync(root, { recursive: true })
const workspace = new Workspace(db, root)
configureMcpSharing(() => workspace.getAppState<McpSharing>(MCP_SHARING_KEY, {}))
workspace.settingsStore = new SettingsStore(userData)
const fake = process.env.RAMU_FAKE_AGENT === '1' ? await import('./providers/fakeAgent') : null
const browserAccessEpochs = new Map<string, number>()
let reviews!: ReviewService
const mobilePush = new MobilePush(
  join(userData, 'mobile-push.json'),
  () => devices.list(),
  fetch,
  (sessionId) => schedules.hasSession(sessionId),
)
// Video goes to the host itself, or to a paired owner device holding Computer use, as every other computer call does.
const computerVideo = new RtcViewers(new VideoFeed(), async (threadId, deviceId) => {
  const session = computer.session(threadId)
  const allowed =
    !!session &&
    (deviceId === 'local' ||
      (devices.list().some((device) => device.id === deviceId && device.role !== 'viewer') &&
        devices.allows(deviceId, 'computer')))
  // A window's video goes blank behind the lock screen; ending it sends the viewer back to snapshots, which still work.
  if (!allowed || (session.target.kind === 'app' && (await computer.backend.locked?.()))) return false
  // With the login window on the screen, display video would show this session's hidden desktop, which takes no input.
  return session.target.kind !== 'display' || !(await computer.backend.awayFromScreen?.())
})
const ocuBackend = new OcuBackend(
  undefined,
  undefined,
  () => workspace.getAppState<boolean>('computer:globalPointer', false) === true,
)
const computer = new ComputerService(new ComputerRouter(new SckDisplayBackend(new MacosComputerBackend()), ocuBackend))
// With computer use on, the native helpers are ready before the first frame or click needs them.
if (workspace.getAppState<boolean>('computer:enabled', false) === true) computer.backend.warm?.()
const agents = new AgentService(
  db,
  (sessionId, event, seq, revision) => {
    send('agent:event', { sessionId, event, seq, revision })
    // A stopped or failed chat (deletion stops it first) keeps no external MCP session or local server running.
    if (event.kind === 'state' && ['failed', 'stopped'].includes(event.state))
      void externalTools.closeSession(sessionId)
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
        const session = agents.get(sessionId)
        const goal = agents.getGoal(sessionId)
        // Only a state change can finish a thread, so the helper lookup is skipped for every other event.
        const helpers =
          event.kind === 'state' ? (agents.helperSummaries(session.taskId).get(session.taskId)?.active ?? 0) : 0
        inbox.observe(session, event, { goal, helpers })
        mobilePush.observe(session, event, goal, helpers)
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
agents.onProviderTitle = agents.providerTitle
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
setAcpTerminalService(terminals)
const customAgents = new CustomAgentStore(workspace)
const testDevices = new TestDevices(() => workspace.getAppState<boolean>('test-devices:enabled', false) === true)
testDevices.start()
const refreshTestPlatforms = () =>
  void testDevices.readyPlatforms().then(
    (platforms) => (resources.testDevices = platforms),
    () => {},
  )
setTimeout(refreshTestPlatforms, 5000).unref?.()
setInterval(refreshTestPlatforms, 10 * 60_000).unref?.()
agents.customAgents = () => customAgents.list()
const resources = new ResourceService(
  {
    roots: () => {
      const sessions = new Map(agents.all().map((session) => [session.id, session]))
      return [
        ...terminals.processes().map(({ pid, taskId, id, kind, name }) => ({ pid, taskId, item: { kind, id, name } })),
        ...testDevices
          .processes()
          .map(({ pid, taskId, id, name }) => ({ pid, taskId, item: { kind: 'device' as const, id, name } })),
        ...[...processRoots()].flatMap(([pid, sessionId]) => {
          const session = sessions.get(sessionId)
          return session
            ? [
                {
                  pid,
                  taskId: session.taskId,
                  item: { kind: 'agent' as const, id: sessionId, name: session.title || session.provider },
                },
              ]
            : []
        }),
      ]
    },
    idleThreads: () => {
      const sessions = agents.all()
      const busy = new Set(
        sessions
          .filter(({ state }) => ['starting', 'running', 'needs-input'].includes(state))
          .map(({ taskId }) => taskId),
      )
      return new Set(sessions.map(({ taskId }) => taskId).filter((taskId) => !busy.has(taskId)))
    },
  },
  undefined,
  undefined,
  () => workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).hostDescription ?? '',
)
resources.start()
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
const webhooks = new WebhookReceiver(schedules)
// Where a sender can reach this host: every address the listener serves.
schedules.webhookBases = () =>
  [
    ...publicCandidates(),
    ...(network.enabled ? candidateUrls(network.host, network.port, Boolean(config.tls)) : []),
  ].map((candidate) => ({ url: candidate.url, via: candidate.interface }))
const pullRequestWatches = new PullRequestWatchService(db, workspace, agents, changed)
const deploys = createDeploys(workspace, db, agents, {
  incidentOpened(thread) {
    send('workspace:changed', {})
    void mobilePush.deliverIncident(thread).catch(() => {})
  },
  notice: (notice) => inbox.raise(notice),
})
// Thread rows show their pull request, so a change there refreshes the thread lists.
const pullRequestIndex = new PullRequestIndex(workspace, agents, () => send('workspace:changed', {}))
const pullRequestDrafts = new PullRequestDrafts(
  workspace,
  agents,
  () => send('workspace:changed', {}),
  (repoId) => pullRequestIndex.viewer(repoId),
)
pullRequestIndex.drafts = () => pullRequestDrafts.list()
pullRequestWatches.drafts = pullRequestDrafts
pullRequestWatches.index = pullRequestIndex
const secretFiles = new SecretFiles(join(userData, 'secret-files'))
agents.secretFiles = secretFiles
secretFiles.start()
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
  return sharedSessionSkills([...new Set(dirs)], provider, accountEnvironment(provider, accountId), sharing, {
    projectId,
  })
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
// The person's rules, then what the project's ramu.json says about its stack, or how to start one from No project.
agents.rulesInstructions = (session) => {
  const project = projectOf(session)
  const facts =
    !project || session.parentId
      ? undefined
      : project === NO_PROJECT
        ? NO_PROJECT_GUIDE
        : projectFactsText(workspace.projectConfiguration(project).config)
  return [rules.instructions(project, session.provider), facts].filter(Boolean).join('\n\n') || undefined
}
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
/** The model a page's AI uses: the maintenance model for fast work, the default model for smart work. */
const pageSettings = (quality: 'fast' | 'smart') => {
  const preferences = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
  const models = workspace.getAppState<ModelPreferences | null>('model-preferences', null)
  const step = models?.sets
    .find((set) => set.id === models.defaultSetId)
    ?.steps.find((entry) => entry.id === models.defaultStepId)
  const chosen = quality === 'fast' ? (preferences.intelligence?.maintenanceModel ?? step) : step
  return { ...DEFAULT_AGENT_SETTINGS, ...chosen }
}
const pages = new PageStore(db, interactive, (artifactId, run) =>
  send('artifacts:changed', { artifactId, ...(run ? { run } : {}) }),
)
/**
 * Page runs reach the web through a keyless search and Shared MCP servers through their own gateway, bound to the
 * page's model login and project and limited to the servers the person granted the page by name. Each call is also
 * confirmed in the page before it is made.
 */
const pageExternal: PageExternal = {
  search: (query, signal) => webSearch(query, signal),
  open: async (page, settings, servers, signal) => {
    const service = getSharedMcp()
    const connections = service.policy
      .snapshot()
      .connections.filter((item) => item.enabled && servers.includes(item.name))
    const gateway = service.gateway(
      `artifact:${page.id}`,
      {
        hostId: service.storage.hostId,
        provider: settings.provider,
        accountId: settings.accountId ?? 'default',
        projectId: page.projectId,
        role: 'background',
        externalToolsAllowed: true,
        connectionIds: connections.map((item) => item.id),
      },
      // The run already asked the person in the page before this call.
      async () => true,
    )
    const tools: PageExternalTool[] = []
    for (const connection of connections) {
      try {
        const found = await gateway.discover(connection.id, signal)
        for (const tool of found.tools)
          tools.push({
            name: tool.name,
            server: connection.name,
            description: tool.description ?? tool.name,
            inputSchema: tool.inputSchema,
            call: async (args, callSignal) => {
              const result = await gateway.invoke(connection.id, found.catalogRevision, tool.name, args, callSignal)
              return JSON.parse(JSON.stringify(result.content ?? [])).slice(0, 20) as JsonValue
            },
          })
      } catch {
        // A server not approved for this login or project offers nothing.
      }
    }
    return { tools, close: () => gateway.close() }
  },
}
const pageAi = new PageAi(pages, (...args) => agents.analyze(...args), pageSettings, pageExternal)
const abilityPreferences = (): AppPreferences => {
  const stored = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {})
  return { ...DEFAULT_APP_PREFERENCES, ...stored, abilities: { ...DEFAULT_ABILITY_PREFERENCES, ...stored.abilities } }
}
const abilityAttachments = new AttachmentStore(join(userData, 'attachments'))
const abilities = new AbilityService(
  {
    preferences: abilityPreferences,
    catalog: () => agents.catalog(),
    session: (sessionId) => agents.get(sessionId),
    events: (sessionId) => agents.events(sessionId),
    record: (sessionId, event) => event.kind === 'ability' && agents.abilityCalled(sessionId, event.call),
    requestPermission: (sessionId, subject, detail, signal) =>
      agents.requestPermission(sessionId, subject, detail, signal),
    attachments: abilityAttachments,
    search: (query, signal) => webSearch(query, signal),
    login: (provider) => providerLogin(provider, abilityPreferences().providerBinaries),
    // Defined below; an ability call only reaches these after start-up.
    mcp: (sessionId, connectionId, tool, build, signal) =>
      externalTools.callTool(externalSource(agents.get(sessionId)), connectionId, tool, build, signal),
    mcpTools: () => {
      const { connections, grants } = getSharedMcp().policy.snapshot()
      const seen = new Set<string>()
      return grants.flatMap((grant) => {
        const connection = connections.find((entry) => entry.id === grant.connectionId && entry.enabled)
        if (!connection) return []
        return grant.tools.flatMap((tool) => {
          const key = `${connection.id}\u0000${tool.name}`
          if (seen.has(key)) return []
          seen.add(key)
          return [{ connectionId: connection.id, tool: tool.name, server: connection.name }]
        })
      })
    },
    readChecks: () => workspace.getAppState<unknown>('ability-checks', []),
    writeChecks: (checks) => workspace.setAppState('ability-checks', checks),
  },
  abilityRunner(fake?.fakeQuery ?? query),
)
agents.abilities = abilities
// Checks run once per provider version and sign-in, a little after start so they never delay it.
setTimeout(() => void abilities.refresh(), 60_000).unref()
const notifyPage = (page: ArtifactInfo, title: string, body: string) => {
  send('artifacts:changed', { artifactId: page.id, notice: { title: title.slice(0, 80), body: body.slice(0, 240) } })
  void mobilePush.deliverArtifact(page.id, title, body).catch(() => {})
}
const pageAutomation = new PageAutomation(
  pages,
  pageAi,
  (page, title, body) => notifyPage(page, title, body),
  {
    read: () => workspace.getAppState<Record<string, number>>('artifact-schedule-marks', {}),
    write: (marks) => workspace.setAppState('artifact-schedule-marks', marks),
  },
  (page) => openHeadlessPage(page, pages),
  {
    pinned: pinnedLibraries,
    check: (page) =>
      recheckLibraries(
        pages,
        page.id,
        interactive.media(page.id, page.version).checks,
        async (files, entry) => resolveInteractiveKit(await compileInteractive(files, entry)),
        (html, checks, network) => previewInteractive(html, checks, undefined, network),
      ),
    seen: {
      read: () => workspace.getAppState<Record<string, string>>('artifact-library-checks', {}),
      write: (seen) => workspace.setAppState('artifact-library-checks', seen),
    },
  },
)
pages.onRecord = (artifactId, record) => pageAutomation.recordChanged(artifactId, record)
/** The tunnel a public page uses: the host's ngrok when it has no fixed domain, else a Cloudflare quick tunnel. */
const publicPageTunnel = (): TunnelChoice =>
  network.tunnel?.kind === 'ngrok' && !network.tunnel.domain ? { kind: 'ngrok' } : { kind: 'quick' }
const publicPages = new PublicPages(
  pages,
  {
    read: () => workspace.getAppState<string[]>('public-artifacts', []),
    write: (ids) => workspace.setAppState('public-artifacts', ids),
  },
  undefined,
  (artifactId) => send('artifacts:changed', { artifactId }),
)
void publicPages.restore(publicPageTunnel())
// A dashboard's live tables, read from its own project: its deploys in each source's fixed column order, or a file in
// its folder, read only.
const isoTime = (at: number) => new Date(at).toISOString()
const liveDashboards = new LiveDashboards(async (projectId, { source, file, columns }) => {
  if (file) {
    const root = workspace.listProjects().find((project) => project.id === projectId)?.root
    if (!root) return []
    return tableFromFile(file, (await readText(root, file)).content, columns)
  }
  if (source === 'deployments')
    return (await deploys.service.project(projectId)).deployments.map((deployment) => [
      isoTime(deployment.createdAt),
      deployment.state,
      deployment.production ? 'production' : 'preview',
      deployment.ref,
      deployment.message,
      deployment.url,
    ])
  if (source === 'usage')
    return (await deploys.usage(projectId)).flatMap((report) =>
      report.figures.map((figure) => [
        report.platform,
        figure.metric,
        figure.service,
        figure.used,
        figure.limit,
        figure.unit,
      ]),
    )
  const last = deploys.uptime.status(projectId).last
  return last ? [[isoTime(last.at), last.result, last.status, last.ms]] : []
})
// Dashboards with watched figures are read again every ten minutes; a change is told to the person's devices.
const dashboardWatch = setInterval(
  () =>
    void watchDashboards({
      dashboards: () => pages.list().filter((page) => page.kind === 'dashboard'),
      document: (artifactId) => pages.document(artifactId),
      live: liveDashboards,
      memory: {
        read: () => workspace.getAppState('dashboard-watch', {}),
        write: (values) => workspace.setAppState('dashboard-watch', values),
      },
      notify: (artifactId, body) => notifyPage(pages.get(artifactId), pages.get(artifactId).title, body),
    }).catch(() => {}),
  10 * 60_000,
)
dashboardWatch.unref()
// New Design, Slides and Dashboard artifacts are drawn with the host's design system, when one is chosen.
interactive.designSystem = (sessionId) => {
  let projectId: string | null = null
  try {
    projectId = workspace.getTask(agents.get(sessionId).taskId).projectId
  } catch {
    // A thread without a project follows the host's design system.
  }
  const artifactId = appliedDesignSystem(
    (key) => workspace.getAppState<string | null>(key, null),
    projectId && projectId !== NO_PROJECT ? projectId : null,
  )
  return artifactId && pages.has(artifactId) ? designTokensOf(pages.document(artifactId)) : null
}
// Apps published from this computer get tunnels of their own, of the same kind as pages opened to anyone.
const localApps = new LocalApps({
  saved: {
    read: () => workspace.getAppState<Record<string, string>>('local-apps', {}),
    write: (apps) => workspace.setAppState('local-apps', apps),
  },
  choice: publicPageTunnel,
  changed: () => send('workspace:changed', {}),
})
pageAutomation.start()
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
    // A connection the thread chose to take from the provider's own copy is not offered a second time.
    connectionIds: allowedConnections(
      workspace.getAppState<DuplicateChoices>(DUPLICATE_CHOICE_KEY, {}),
      session.id,
      getSharedMcp().policy.snapshot().connections,
    ),
  }
}
// Before a switch or fallback launches, say what the destination login lacks from the thread's setup.
// Helpers are sub-agents of a chat and never inherit Shared MCP: name what they start without.
agents.helperSetupNote = (helper) => {
  const names = getSharedMcp()
    .sessionConnections(helper.provider, helper.settings.accountId ?? 'default', projectOf(helper))
    .map((connection) => connection.name)
  return names.length
    ? `This helper starts without Shared MCP tools (${names.join(', ')}); helpers do not inherit external access. Use the chat for work that needs them.`
    : null
}
agents.setupOmissions = (session, settings) => {
  const projectId = projectOf(session)
  const omitted: SetupOmission[] = []
  try {
    for (const connection of getSharedMcp().sessionConnections(
      settings.provider,
      settings.accountId ?? 'default',
      projectId,
    ))
      if (connection.status !== 'ready')
        omitted.push({ kind: 'shared-mcp', name: connection.name, status: connection.status })
  } catch {
    // Unreadable Shared MCP configuration is reported in Settings; it must not stop a switch.
  }
  try {
    rules.instructions(projectId, settings.provider)
  } catch {
    omitted.push({ kind: 'rule', name: 'Rules', status: 'too-large' })
  }
  return omitted
}
// Agent-started threads go through the same methods a person's client calls, with the host's own authority. The
// dispatcher is read only when a thread starts, after it exists.
const agentHosts = new AgentHostService(workspace)
const agentThreads = new AgentThreadService(
  db,
  workspace,
  agents,
  async (method, args) => await origin.run({ network: false }, () => dispatcher.invoke(method, args)),
  changed,
  new RemoteThreads(db, agents, agentHosts, changed),
)
/** Asks this host's own desktop app to do something only it can: a native dialog, or installing an update. */
function askDesktop(method: string, path?: string): Promise<unknown> {
  if (!hostClients.size) return Promise.reject(new Error('Open Ramu on this host to use this desktop action'))
  const requestId = randomUUID()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      nativeRequests.delete(requestId)
      reject(new Error('Desktop action timed out'))
    }, 120000)
    nativeRequests.set(requestId, { resolve, reject, timer })
    // Exactly one UI owns a desktop dialog/action.
    const client = hostClients.values().next().value
    if (
      !client ||
      !writeEvent(
        client,
        `data: ${JSON.stringify({ channel: 'host:request', payload: { requestId, method, path } })}\n\n`,
      )
    ) {
      clearTimeout(timer)
      nativeRequests.delete(requestId)
      reject(new Error('Open Ramu on this host to use this desktop action'))
    }
  })
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
      return askDesktop(method, path)
    },
    // Installing an update the person asked for from any device; the desktop app itself checks the build may install.
    desktopApp: {
      attached: () => hostClients.size > 0,
      installUpdate: async (version) => void (await askDesktop('installUpdate', version)),
    },
    // 75 (try again): a service manager set to restart only on failure still starts the new build.
    restartService: () => void stop(false, 75),
  },
  {
    workspace,
    getSharedMcp,
    browser: browserBroker,
    hostBrowser,
    computer,
    computerVideo,
    terminals,
    resources,
    customAgents,
    testDevices,
    agents,
    threadTitles,
    interactive,
    pages,
    artifactExports: new ArtifactExports(db),
    liveDashboards,
    pageAi,
    abilities,
    notifyPage,
    publicPages,
    publicPageTunnel,
    artifactWebhookBases: () => schedules.webhookBases?.().map((base) => base.url.replace(/\/$/, '')) ?? [],
    schedules,
    pullRequestWatches,
    deploys,
    localApps,
    pullRequestIndex,
    pullRequestDrafts,
    recaps,
    reviews,
    memory,
    learning,
    externalSkills,
    diagnostics,
    summaries,
    rules,
    notices: inbox,
    agentThreads,
  },
)
const startedAt = Date.now()
let stopping = false
async function stop(intentional = false, exitCode = 0) {
  if (intentional) writeFileSync(stoppedPath, String(Date.now()))
  if (stopping) return
  stopping = true
  clearInterval(tick)
  tunnels.stop()
  publicPages.close()
  await schedules.stop()
  await pullRequestWatches.stop()
  await deploys.domains.stop()
  localApps.close()
  await deploys.deployWatch.stop()
  await deploys.uptime.stop()
  await deploys.usageNotices.stop()
  await pullRequestIndex.stop()
  secretFiles.stop()
  abilities.stop()
  await agentThreads.stop()
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
  localSockets.close()
  runtime.close()
  sockets?.close()
  try {
    remote?.close()
  } catch {}
  db.close()
  try {
    unlinkSync(socketPath)
  } catch {}
  process.exit(exitCode)
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
// An MCP request body as JSON; its own transport validates it.
const body = async (req: import('node:http').IncomingMessage): Promise<unknown> => decodeInvoke(await rawBody(req))
const capabilities = (): Capability[] => [
  CAPABILITIES.invoke,
  CAPABILITIES.events,
  CAPABILITIES.mobileCompanion,
  CAPABILITIES.liveActivities,
  CAPABILITIES.hostBrowser,
  CAPABILITIES.hostRequests,
  CAPABILITIES.operationKeys,
  ...(reachable() ? [CAPABILITIES.remote, CAPABILITIES.pairing, CAPABILITIES.renewal, CAPABILITIES.webSocket] : []),
]
// Event streams of network clients stay open, so a revoked device must be cut off here, not only refused on its next request.
const remoteStreams = new Map<EventSink, string | undefined>()
const stillAuthorized = (header: string | undefined) => remoteAccess.authorized(header)
const dropRevoked = () => {
  for (const [stream, header] of remoteStreams) if (!stillAuthorized(header)) stream.end()
}
const json = { 'Content-Type': 'application/json' }
// Results of keyed mutations, kept briefly so a retry after a lost reply returns the first outcome instead of running twice.
const operations = new OperationLog<unknown>(10 * 60_000, 500)
// Identifies this server run; a client that sees it change knows the host restarted and every cursor it held is void.
const runEpoch = randomUUID()
/** A call the device may not make: answered as a refusal, not as a failure of the call. */
class InvokeRefused extends Error {}
/**
 * Runs one named call for a client of either transport. `after` is work to start once the answer has been sent, for a
 * call that stops this process. Both the HTTP route and the WebSocket go through here, so they share authorization,
 * local-only restrictions and keyed-mutation recovery.
 */
async function performInvoke(
  remote: boolean,
  device: DeviceInfo | undefined,
  { method, args, operationKey }: InvokeRequest,
): Promise<{ value: unknown; after?: () => void }> {
  const deviceId = device?.id
  if (operationKey !== undefined && !(typeof operationKey === 'string' && OPERATION_KEY_PATTERN.test(operationKey)))
    throw new Error('Invalid operation key.')
  if (remote && !deviceMayInvoke(device, method))
    throw new InvokeRefused(
      device?.kind === 'host'
        ? 'A paired host may only start, check and message the threads it starts here.'
        : method.startsWith('hostThreads.')
          ? 'Only a paired host can make this call.'
          : 'This device is a viewer. This action requires full access.',
    )
  if (remote && device?.kind === 'host' && !devices.hostPairingActive(device))
    throw new InvokeRefused('The person on this host turned off Agents for that computer.')
  // Computer use, the browser, terminals, settings changes and agents each need their own grant on this host.
  const needed = remote && device ? permissionFor(method) : null
  if (needed && !devices.allows(device!.id, needed)) throw new InvokeRefused(permissionRefusal(needed))
  let value: unknown
  if (method === 'device.permissions') {
    value = device
      ? {
          permissions: devices.permissionsOf(device.id),
          pending: permissionRequests.pendingFor(device.id),
          blocked: devices.blocked(device.id),
        }
      : {
          permissions: Object.fromEntries(DEVICE_PERMISSIONS.map((permission) => [permission, { until: null }])),
          pending: [],
        }
  } else if (method === 'device.agentPairing') {
    if (!device) throw new Error('This computer’s agents are already here.')
    value = { code: devices.agentPairingCode(device.id) }
    // The earlier agent pairing it replaced must not keep an open connection.
    dropRevoked()
  } else if (method === 'device.describe') {
    // This computer itself needs no description; a paired device tells what it runs on, bounded and checked.
    if (device) devices.describe(device.id, deviceOsSchema.parse(args?.[0]))
    value = {}
  } else if (method === 'device.requestPermission') {
    if (!device) throw new Error('This computer already has every permission.')
    if (!isDevicePermission(args?.[0])) throw new Error('Invalid permission')
    if (devices.allows(device.id, args[0])) throw new Error('This device already has that permission.')
    if (devices.blocked(device.id).includes(args[0]))
      throw new Error(
        'The host declined this permission. Ask the person there to allow it in Settings → Remote access.',
      )
    permissionRequests.ask(device, args[0])
  } else if (method === 'device.inviteBack') {
    if (!device) throw new Error('This computer is already here.')
    pairBackInvites.invite(device, args?.[0])
  } else if (method === 'browser.bridge.attach') {
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
    const [clientId, token, requestId] = args as [string, string, string]
    browserBroker.reply(clientId, token, requestId, args[3], typeof args[4] === 'string' ? args[4] : undefined)
  } else if (method === 'host.reply') {
    if (remote) throw new Error('Desktop actions are only available on this host')
    const requestId = args[0]
    const request = typeof requestId === 'string' ? nativeRequests.get(requestId) : undefined
    if (request) {
      clearTimeout(request.timer)
      nativeRequests.delete(requestId as string)
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
  } else if (method.startsWith('terminalThreads.')) {
    // Any process of this OS user can reach the local socket and is trusted like the person; nothing else can.
    if (remote) throw new InvokeRefused('Only a terminal on this host can make this call.')
    if (method === 'terminalThreads.start')
      value = await agentThreads.startForTerminal(terminalThreadRequest.parse(args?.[0]))
    else if (method === 'terminalThreads.status')
      value = agentThreads.statusForTerminal(z.string().max(100).nullish().parse(args?.[0]))
    else if (method === 'terminalThreads.message') {
      const [taskId, text] = z.tuple([z.string().min(1).max(100), z.string().min(1).max(20_000)]).parse(args)
      value = await agentThreads.messageForTerminal(taskId, text)
    } else throw new Error(`Unknown method ${method}`)
  } else if (method.startsWith('hostThreads.')) {
    // A paired host's calls reach the thread service directly, with that host's own identity and limits; they never
    // run with this host's local authority.
    if (!remote || device?.kind !== 'host') throw new InvokeRefused('Only a paired host can make this call.')
    if (method === 'hostThreads.start') {
      const parsed = hostThreadRequest.safeParse(args?.[0])
      if (!parsed.success) throw new Error(describeValidationError(parsed.error))
      const request = parsed.data
      const start = () => agentThreads.startForHost(device, request, operationKey)
      value = operationKey ? await runOnce(operations, device.id, operationKey, method, args, start) : await start()
    } else if (method === 'hostThreads.status')
      value = agentThreads.statusForHost(device, z.string().max(100).nullish().parse(args?.[0]))
    else if (method === 'hostThreads.projects') value = agentThreads.projectsForHost(device)
    else if (method === 'hostThreads.message') {
      const [taskId, text, mode] = z
        .tuple([z.string().min(1).max(100), z.string().min(1).max(20_000), z.enum(['queue', 'steer'])])
        .parse(args)
      value = await agentThreads.messageForHost(device, taskId, text, mode)
    } else throw new Error(`Unknown method ${method}`)
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
      os: hostOs,
      ...(network.enabled ? { listening: `${network.host}:${network.port}`, tls: Boolean(config.tls) } : {}),
    }
  else if (method.startsWith('network.')) {
    if (remote) throw new Error('Network access is managed from the host running Ramu')
    value = await networkMethod(method, args)
  } else if (method === 'background.stop') {
    return { value: {}, after: () => void stop(true) }
  } else if (method === 'background.restart') {
    return { value: {}, after: () => void stop() }
  } else {
    const dispatch = async () => await origin.run({ network: remote, deviceId }, () => dispatcher.invoke(method, args))
    value = operationKey
      ? await runOnce(operations, deviceId ?? 'local', operationKey, method, args, dispatch)
      : await dispatch()
  }
  return { value }
}
// Requests over TCP must present the bearer token.
const handle = () => async (req: import('node:http').IncomingMessage, res: ServerResponse) => {
  try {
    // A service's redirect after sign-in arrives from a browser with no device token; the transaction's state is the proof.
    if (req.method === 'GET' && (req.url ?? '').split('?')[0] === HOSTED_CALLBACK_PATH) {
      const outcome = await completeOAuthCallback(new URL(req.url ?? '/', 'http://host'))
      res
        .writeHead(outcome.ok ? 200 : 400, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        .end(oauthPage(outcome.message))
      return
    }
    // A webhook carries no device token: its unguessable address and the schedule's signature check stand in for one.
    const hookPath = (req.url ?? '').split('?')[0] ?? ''
    if (req.method === 'POST' && hookPath.startsWith(`${WEBHOOK_PATH}artifact/`)) {
      const raw = await readWebhookBody(req)
      const answer = raw
        ? pageAutomation.receive(decodeURIComponent(hookPath.slice(`${WEBHOOK_PATH}artifact/`.length)), raw)
        : { status: 413, body: { error: 'The request is too large' } }
      res.writeHead(answer.status, json).end(JSON.stringify(answer.body))
      return
    }
    if (req.method === 'POST' && hookPath.startsWith(WEBHOOK_PATH)) {
      const raw = await readWebhookBody(req)
      const answer = raw
        ? webhooks.receive(decodeURIComponent(hookPath.slice(WEBHOOK_PATH.length)), req.headers, raw)
        : ({ status: 413, error: 'The request is too large' } as const)
      res
        .writeHead(answer.status, json)
        .end(JSON.stringify('delivery' in answer ? { outcome: answer.delivery.outcome } : { error: answer.error }))
      return
    }
    const authenticated = await remoteAccess.accept(req, res)
    if (authenticated === undefined) return
    const device = authenticated ?? undefined
    const path = (req.url ?? '/').split('?')[0]
    // Calls and events travel only on the WebSocket (`/socket`); HTTP here is for pairing, renewal and health, which
    // happen before a socket can be authenticated, and for this one check that a token is still accepted.
    if (path === '/session' && req.method === 'GET') {
      res
        .writeHead(200, { ...json, 'Cache-Control': 'no-store' })
        .end(JSON.stringify({ access: accessOf(device), protocol: PROTOCOL_VERSION }))
      return
    }
    res.writeHead(404).end()
  } catch (error) {
    if (!res.headersSent) res.writeHead(400, json)
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  }
}
// The local service speaks only the WebSocket, over its unix socket: every other request is refused.
const runtime = createServer((_req, res) => res.writeHead(404).end())
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
  if (!review)
    registerInteractiveTools(server, interactive, source.id, {
      pages,
      ai: pageAi,
      projectId: () => {
        const projectId = workspace.getTask(source.taskId).projectId
        return projectId === NO_PROJECT ? null : projectId
      },
    })
  if (!review)
    registerBackgroundTerminalTools(
      server,
      terminals,
      source,
      () => agents.get(source.id),
      (detail, signal) => agents.requestPermission(source.id, 'Background command', detail, signal),
    )
  if (!review) registerThemeTools(server, (theme) => agents.themeProposed(source.id, theme))
  if (!review) registerAbilityTools(server, abilities, source)
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
  if (!review)
    registerComputerTools(
      server,
      computer,
      source,
      () => agents.get(source.id),
      () => browserTokens.get(source.id) === token,
      {
        enabled: () => workspace.getAppState<boolean>('computer:enabled', false) === true,
        request: (detail, signal) => agents.requestPermission(source.id, 'Computer use', detail, signal),
        grant: async (app) => {
          await origin.run({ network: false }, () => dispatcher.invoke('computer.setEnabled', [true]))
          await origin.run({ network: false }, () =>
            dispatcher.invoke('computer.grant', [
              source.taskId,
              { observe: true, input: true, ...(app ? { app } : {}) },
            ]),
          )
        },
      },
    )
  if (!review) registerTestDeviceTools(server, source, () => agents.get(source.id))
  if (!review) externalSkills.register(server, agents, source.id)
  if (!review) pullRequestWatches.register(server, source.id)
  if (!review) agentThreads.register(server, source.id)
  const deployProject = workspace.getTask(source.taskId).projectId
  if (!review && deployProject && deployProject !== NO_PROJECT)
    registerDeployTools(
      server,
      deploys.service,
      { domains: deploys.domains, deploys: deploys.deployWatch },
      deploys.usage,
      source,
      deployProject,
      () => agents.get(source.id),
      () => workspace.listProjects().find((project) => project.id === deployProject)?.name ?? 'this project',
      (detail, signal) => agents.requestPermission(source.id, 'Deploy', detail, signal),
    )
  if (!review && deployProject && deployProject !== NO_PROJECT && deploys.releases.root(deployProject))
    registerReleaseTools(server, deploys.releases, deploys.deployWatch, source, deployProject, (detail, signal) =>
      agents.requestPermission(source.id, 'Release', detail, signal),
    )
  if (!review) registerCiTools(server, source, () => agents.get(source.id))
  if (!review && !source.parentId) registerSecretTools(server, agents, source.id)
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
    async () => {
      // Every Codex sub-agent gets the same answer, so the hook's tool input is not needed.
      const decision = await agents.codexSpawnDecision(source.id).catch(() => null)
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
        description: `Start a sub-agent through Ramu, which may run it on a different provider or model than you. Use it when told to, or when the Agent tool is refused. It takes a description, a prompt and optionally a type, a name and background. Without background it waits and returns the sub-agent's report; with background it returns at once and the report arrives later as a message. model picks the helper's model by handle (agent_models lists them); without it, the person's Sub-agents routing decides. needs lists abilities the helper's whole job requires (such as image_generation); Ramu starts it on a provider that has all of them, or refuses naming what is missing. isolation: worktree gives it its own copy of the checkout (with your uncommitted changes), shared keeps it in yours unless another helper is writing there. role: research and review read and report and never edit; implementation and test may edit. A helper never gets more access than you. requestId: any unique string; sending the same call again returns the first result instead of starting a second helper.${customAgentList(customAgents.list())}`,
        inputSchema: {
          description: z.string().min(1).max(200),
          prompt: z.string().min(1).max(100000),
          type: z.string().max(80).optional(),
          name: z.string().max(80).optional(),
          background: z.boolean().optional(),
          model: z.string().min(1).max(80).optional(),
          needs: z.array(z.enum(ABILITIES)).min(1).max(ABILITIES.length).optional(),
          isolation: z.enum(['shared', 'worktree']).optional(),
          role: z.enum(HELPER_ROLES).optional(),
          requestId: z.string().min(1).max(120).optional(),
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
  if (!agents.get(source.id).parentId) {
    server.registerTool(
      'agent_models',
      {
        description:
          "List this host's providers and their current models with the handles ramu_agent's model and teammate_suggest take, at most eight per provider (the default first), and its abilities: which provider can make images, search the web or read very long documents, and the tool that calls each (generate_image, edit_image, web_search, read_long). Check it before planning work that needs one. query narrows models by name, handle or provider. A provider marked unavailable cannot run a helper now.",
        inputSchema: { query: z.string().max(80).optional() },
      },
      async ({ query }) => result(await agents.agentModels(query)),
    )
    server.registerTool(
      'ramu_agent_status',
      {
        description:
          'Your own ramu_agent helpers with their status, model and latest summary, or one by agent id. Reports arrive as messages on their own; check status only when the person asks or before stopping one, never in a loop.',
        inputSchema: { agent: z.string().max(200).optional() },
      },
      async ({ agent }) => {
        try {
          return result(agents.helperStatus(source.id, agent))
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
    server.registerTool(
      'ramu_agent_stop',
      {
        description:
          'Stop one of your own ramu_agent helpers that has gone off track, by agent id. Its partial work stays as it is; say in your reply what you stopped and why.',
        inputSchema: { agent: z.string().min(1).max(200) },
      },
      async ({ agent }) => {
        try {
          return result(await agents.stopHelper(source.id, agent))
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  }
  // The lead and a teammate the person added address each other by name. A lead may gain a teammate mid-thread, so it always has the tool.
  const teammateSession = agents.events(source.id).some((event) => event.kind === 'teammate')
  if (!agents.get(source.id).parentId || teammateSession)
    server.registerTool(
      'teammate_message',
      {
        description: teammateSession
          ? 'Send the lead (to "lead") a short note before your report: a finding it should act on now, or a question. It does not wait for a reply; finish with your report as usual.'
          : 'Message a teammate the person added to this thread, by its name as in @name ("teammate" works while there is one). It wakes the teammate, which also sees what the thread said since it last took part, and its next report comes back to you as a message. Use it only when the thread has teammates; for your own sub-agents use their tools.',
        inputSchema: { to: z.string().min(1).max(80), text: z.string().min(1).max(20000) },
      },
      async ({ to, text }) => {
        try {
          return result(await agents.teammateMessage(source.id, to, text))
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  if (!agents.get(source.id).parentId)
    server.registerTool(
      'teammate_suggest',
      {
        description:
          'Suggest bringing another model into this thread as a teammate, when a second opinion would help: a review of risky changes, or a model better suited to part of the work. The person approves or declines first and pays for it with their login, so suggest only when it clearly helps, at most once per request. It joins in Review (reads and reports, never edits) with your request; its report arrives as a message. model is a handle such as opus-5.5.',
        inputSchema: {
          model: z.string().min(1).max(80),
          reason: z.string().min(1).max(600),
          request: z.string().min(1).max(20000),
        },
      },
      async (value, extra) => {
        try {
          return result(await agents.suggestTeammate(source.id, value, extra.signal))
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  if (!agents.get(source.id).parentId)
    server.registerTool(
      'teammate_ask',
      {
        description:
          'Ask a teammate the person added to this thread a quick question, by its name as in @name, and wait for its reply, which comes back as this result. It sees what the thread said since it last took part. Use teammate_message instead when you do not need the answer to continue.',
        inputSchema: { to: z.string().min(1).max(80), question: z.string().min(1).max(20000) },
      },
      async ({ to, question }, extra) => {
        try {
          return result(await agents.teammateAsk(source.id, to, question, extra.signal))
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
      const parts = [
        ...(integrated ? [INTEGRATED_BROWSER_GUIDE] : []),
        COMPUTER_GUIDE,
        ...(workspace.getAppState<boolean>('test-devices:enabled', false) ? [TEST_DEVICE_GUIDE] : []),
      ]
      return parts.length ? { browserInstructions: parts.join('\n\n') } : {}
    })(),
    ...(mcpConfigDirs.length ? { mcpConfigDirs } : {}),
    ...(projectId && projectId !== NO_PROJECT ? { sharingProjectId: projectId } : {}),
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
    syncTunnel()
    console.log(
      `Ramu server listening on ${config.tls ? 'https' : 'http'}://${host}:${port}; pair a device with \`ramu pair\``,
    )
  })
}
let sockets: ReturnType<typeof serveSockets> | null = null
// The WebSocket is one more transport for the same calls and events: it registers for the same broadcast as an SSE
// stream and runs every call through `performInvoke`, so authorization and keyed-mutation recovery are shared.
const streamDevices = new Map<object, string>()
const socketHost: SocketHost = {
  accept: (req, res) => remoteAccess.accept(req, res),
  invoke: async (device, request) => {
    try {
      const result = await performInvoke(true, device, request)
      return { ok: true, value: result.value, ...(result.after ? { after: result.after } : {}) }
    } catch (error) {
      return {
        ok: false,
        status: error instanceof InvokeRefused ? 403 : 400,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  epoch: runEpoch,
  attach: (sink, req, device) => {
    // A device reached through a tunnel is not on this network, so a reconnect announcement could not reach it.
    const from = clientAddress(req, publicUrl() !== null)
    if (device && req.socket.remoteAddress && !from.tunneled)
      presence.register(device.id, from.address, Number(req.headers['x-ramu-presence-port']))
    clients.add(sink)
    remoteStreams.set(sink, req.headers.authorization)
    if (device) streamDevices.set(sink, device.id)
  },
  detach: (sink) => {
    clients.delete(sink)
    remoteStreams.delete(sink)
    // A device's last connection closing ends what it was allowed "this time".
    const id = streamDevices.get(sink)
    streamDevices.delete(sink)
    if (id && ![...streamDevices.values()].includes(id)) devices.endSession(id)
  },
}
// The desktop and the command line reach this service over its unix socket with the same frames a phone uses over the
// network: no token (the socket file is owner-only), and the private desktop identity travels in a header.
const localClientId = (req: import('node:http').IncomingMessage) => {
  const header = req.headers['x-ramu-desktop-client']
  return typeof header === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(header) ? header : null
}
const localSocketHost: SocketHost = {
  accept: async () => null,
  invoke: async (_device, request) => {
    try {
      const result = await performInvoke(false, undefined, request)
      return { ok: true, value: result.value, ...(result.after ? { after: result.after } : {}) }
    } catch (error) {
      return {
        ok: false,
        status: error instanceof InvokeRefused ? 403 : 400,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
  epoch: runEpoch,
  attach: (sink, req) => {
    clients.add(sink)
    // Only a desktop (which names itself) can answer a native dialog; a command-line call must never be chosen for one.
    const clientId = localClientId(req)
    if (clientId) {
      hostClients.add(sink)
      if (desktopClients.has(clientId)) browserBroker.detach(clientId)
      desktopClients.set(clientId, sink)
    }
  },
  detach: (sink) => {
    clients.delete(sink)
    hostClients.delete(sink)
    for (const [clientId, client] of desktopClients)
      if (client === sink) {
        desktopClients.delete(clientId)
        browserBroker.detach(clientId)
      }
  },
}
const localSockets = serveSockets(runtime, localSocketHost)
/** Any way a device can reach this host right now, beyond this computer. */
function reachable() {
  return network.enabled
}
const pairingNotice = createPairingNotice({
  // Only the desktop apps on this machine answer pairing requests; paired devices never see them.
  push: (requests) => {
    const message = `data: ${JSON.stringify({ channel: 'pairing:requests', payload: { requests } })}\n\n`
    for (const client of hostClients) if (!client.destroyed) writeEvent(client, message)
  },
  desktopConnected: () => desktopClients.size > 0,
  desktopApp: process.env.RAMU_DESKTOP_APP,
})
function startRemote() {
  if (!network.enabled || stopping) return
  remoteError = null
  const server = (remote = config.tls
    ? createHttpsServer({ cert: readFileSync(config.tls.cert), key: readFileSync(config.tls.key) }, handle())
    : createServer(handle()))
  sockets = serveSockets(server, socketHost)
  listenRemote(server)
}
/** Advertises the address the listener bound, and only while both settings allow it. Never affects the listener. */
/** While Pair a device is open (an unused offer exists), nearby devices can find this host even if it is not discoverable. */
const pairingOpen = () => devices.offers().length > 0
function syncDiscovery() {
  if (network.enabled && (network.discoverable || pairingOpen()) && remote?.listening)
    void advertiser.start({ host: network.host, port: network.port, tls: Boolean(config.tls) }).catch(() => {})
  else void advertiser.stop()
}
function stopRemote() {
  clearTimeout(remoteRetry)
  tunnels.use(null, null)
  void advertiser.stop()
  const old = remote
  remote = null
  remoteError = null
  sockets?.close()
  sockets = null
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
    devices: devices.panel(),
    deviceLifetime: devices.lifetime(),
    offers: devices.offers(),
    requests: pairingRequests.list(),
    defaultPermissions: devices.defaultPermissions(),
    permissionRequests: permissionRequests.list(),
    reachable: reachable(),
    publicAddress: { url: publicUrl(), source: config.publicUrl ? ('command-line' as const) : ('settings' as const) },
    tunnel: tunnels.status(),
  }
}
async function networkMethod(method: string, args: unknown[]) {
  if (method === 'network.status') return networkStatus()
  if (method === 'network.setHostAccess') {
    const [deviceId, access] = args
    if (typeof deviceId !== 'string' || !isHostAccess(access)) throw new Error('Invalid access')
    devices.setMaxAccess(deviceId, access)
    return networkStatus()
  }
  if (method === 'network.agentHosts') return agentHosts.list()
  if (method === 'network.addAgentHost') {
    const [address, code, name] = z
      .tuple([z.string().min(1).max(500), z.string().min(1).max(40), z.string().max(80).optional()])
      .parse(args)
    await agentHosts.add(address, code, name)
    return agentHosts.list()
  }
  if (method === 'network.forgetAgentHost') {
    await agentHosts.forget(z.string().max(100).parse(args[0]))
    return agentHosts.list()
  }
  if (method === 'network.setDevicePermission') {
    const [deviceId, permission, duration] = args
    if (typeof deviceId !== 'string' || !isDevicePermission(permission)) throw new Error('Invalid permission')
    if (duration !== 'revoke' && duration !== 'never' && !PERMISSION_DURATIONS.includes(duration as PermissionDuration))
      throw new Error('Invalid duration')
    if (duration === 'never') devices.block(deviceId, permission)
    else
      devices.setPermission(
        deviceId,
        permission,
        duration === 'revoke' ? null : grantFor(duration as PermissionDuration, Date.now()),
      )
    permissionRequests.clear(deviceId, permission)
    send('device:permissions', {})
    return networkStatus()
  }
  if (method === 'network.decidePermission') {
    const [requestId, duration] = args
    const request = typeof requestId === 'string' ? permissionRequests.take(requestId) : undefined
    if (!request) throw new Error('That request was already answered or expired.')
    if (duration === 'never') devices.block(request.deviceId, request.permission)
    else if (duration !== 'deny') {
      if (!PERMISSION_DURATIONS.includes(duration as PermissionDuration)) throw new Error('Invalid duration')
      devices.setPermission(request.deviceId, request.permission, grantFor(duration as PermissionDuration, Date.now()))
    }
    send('device:permissions', {})
    return networkStatus()
  }
  if (method === 'network.setDefaultPermissions') {
    if (!Array.isArray(args[0]) || !args[0].every(isDevicePermission)) throw new Error('Invalid permissions')
    devices.setDefaultPermissions(args[0])
    return networkStatus()
  }
  if (method === 'network.configure') {
    if (config.listen) throw new Error('Network access was set with --listen; change it there')
    const input = args[0] as { discoverable?: unknown; publicUrl?: unknown; tunnel?: unknown } | null
    // A request that leaves a choice out keeps the saved one rather than clearing it.
    const next = validateNetworkSetting(
      input && typeof input === 'object'
        ? {
            ...input,
            discoverable: input.discoverable ?? network.discoverable,
            publicUrl: input.publicUrl === undefined ? network.publicUrl : input.publicUrl,
            tunnel: input.tunnel === undefined ? network.tunnel : input.tunnel,
          }
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
  if (method === 'network.setPublicUrl') {
    if (config.publicUrl) throw new Error('The tunnel address was set with --public-url; change it there')
    if (config.listen) throw new Error('Network access was set with --listen; pass --public-url there')
    network = { ...network, publicUrl: parsePublicUrl(args[0]) }
    writeNetworkSetting(config.networkPath, network)
    return networkStatus()
  }
  if (method === 'network.setTunnel') {
    if (config.publicUrl) throw new Error('The tunnel address was set with --public-url; change it there')
    if (config.listen)
      throw new Error('Network access was set with --listen; run the tunnel yourself and pass --public-url')
    const tunnel = parseTunnelChoice(args[0])
    // A tunnel needs the listener; turned on for this computer only, nothing else on the network can reach it.
    const enable = tunnel && !network.enabled ? { enabled: true, host: '127.0.0.1' } : {}
    network = { ...network, ...enable, tunnel }
    writeNetworkSetting(config.networkPath, network)
    if (enable.enabled) startRemote()
    else syncTunnel()
    return networkStatus()
  }
  if (method === 'network.pair') {
    if (!reachable()) throw new Error('Turn on network access first')
    const role = args[0] ?? 'owner'
    if (role !== 'owner' && role !== 'viewer') throw new Error('Invalid device role')
    const owner = typeof args[1] === 'string' && args[1].length > 0 && args[1].length <= 80 ? args[1] : undefined
    const { code, expiresAt, offerId } = devices.createCode(Date.now(), role, owner)
    // Advertise for as long as the offer lasts; closing or using it stops that.
    syncDiscovery()
    setTimeout(syncDiscovery, expiresAt - Date.now() + 1000).unref()
    const direct = [
      ...publicCandidates(),
      ...(network.enabled ? candidateUrls(network.host, network.port, Boolean(config.tls)) : []),
    ]
    return {
      offerId,
      code,
      expiresAt,
      urls: direct,
    }
  }
  if (method === 'network.cancelOffer') {
    if (typeof args[0] !== 'string') throw new Error('Invalid offer')
    const cancelled = devices.cancelOffer(args[0])
    syncDiscovery()
    return cancelled
  }
  if (method === 'network.approveRequest') {
    if (typeof args[0] !== 'string') throw new Error('Invalid pairing request')
    if (args[1] !== 'owner' && args[1] !== 'viewer') throw new Error('Invalid device access')
    pairingRequests.approve(args[0], args[1])
    syncDiscovery()
    return networkStatus()
  }
  if (method === 'network.denyRequest') {
    if (typeof args[0] !== 'string') throw new Error('Invalid pairing request')
    pairingRequests.deny(args[0])
    return networkStatus()
  }
  if (method === 'network.offer') {
    if (typeof args[0] !== 'string') throw new Error('Invalid offer')
    return devices.offerStatus(args[0])
  }
  if (method === 'network.setDeviceExpiry') {
    const [deviceId, days] = args
    if (typeof deviceId !== 'string') throw new Error('Invalid device')
    if (days !== 'default' && !validLifetime(days)) throw new Error('Choose 1 to 3650 days, or never')
    devices.setDeviceLifetime(deviceId, days === 'default' ? undefined : (days as number | 'never'))
    return networkStatus()
  }
  if (method === 'network.setDeviceLifetime') {
    const days = args[0]
    if (days !== null && !validLifetime(days)) throw new Error('Choose 1 to 3650 days, or never')
    devices.setLifetime(days)
    return networkStatus()
  }
  if (method === 'network.pairBackInvites') return pairBackInvites.list()
  if (method === 'network.dismissPairBack') {
    pairBackInvites.dismiss(z.string().max(100).parse(args[0]))
    return
  }
  if (method === 'network.revoke') {
    if (typeof args[0] !== 'string') throw new Error('Invalid device')
    devices.revoke(args[0])
    pairBackInvites.forget(args[0])
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
  try {
    dropRevoked()
    mobilePush.prune()
    void mobileLiveActivities.flush().catch(() => {})
  } catch {
    /* Revocation sweeps and push cleanup must not interrupt host agents. */
  }
  for (const client of clients) writeEvent(client, ': ping\n\n')
}, 20000)
const tick = setInterval(() => {
  void agents.resumeInterruptedChats().catch(console.error)
  void schedules.tick().catch(console.error)
  void pullRequestWatches.tick().catch(console.error)
  void deploys.domains.tick().catch(console.error)
  void deploys.deployWatch.tick().catch(console.error)
  void deploys.uptime.tick().catch(console.error)
  void deploys.usageNotices.tick().catch(console.error)
  void pullRequestIndex.tick().catch(console.error)
  void agentThreads.tick().catch(console.error)
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

/** test_device_* tools for one session. Opening a device follows computer use's approval and then grants it as the thread's computer. */
function registerTestDeviceTools(server: McpServer, source: AgentSessionInfo, current: () => AgentSessionInfo) {
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] })
  const refuse = (error: unknown) => ({
    isError: true,
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
  })
  const live = () => {
    const session = current()
    if (session.id !== source.id || !['starting', 'running'].includes(session.state))
      throw new Error('This run is no longer active.')
    return session
  }
  const guard = (work: () => Promise<unknown>) => work().then(result, refuse)
  const id = z.string().min(1).max(200)
  server.registerTool(
    'test_device_list',
    {
      description:
        'List iOS Simulators and Android emulators on this host, which are running, and which platforms are ready.',
      inputSchema: {},
    },
    () => guard(() => testDevices.status()),
  )
  server.registerTool(
    'test_device_open',
    {
      description:
        "Boot a test device for this thread and make it the thread's computer, so computer_observe and the action tools work on it. The first opening may ask the person.",
      inputSchema: { id, reason: z.string().max(1000).optional() },
    },
    ({ id: deviceId, reason }) =>
      guard(async () => {
        const session = live()
        const automatic = !session.parentId && workspace.getAppState<boolean>('test-devices:enabled', false) === true
        if (
          !automatic &&
          !(await agents.requestPermission(
            source.id,
            'Test device',
            `Allow this thread to boot and control the test device ${deviceId}?${reason ? `\n\n${reason}` : ''}`,
          ))
        )
          throw new Error('Test device access was denied for this run. Respect that decision.')
        const opened = await testDevices.open(deviceId, session.taskId)
        computer.grant(
          session.taskId,
          { target: testDevices.target(deviceId), observe: true, input: true },
          { id: `test-device:${deviceId}`, name: opened.name, backend: testDevices.backend(deviceId) },
        )
        computer.rememberAccessRun(session.taskId, session.id)
        return { opened: true, ...opened, next: 'Call computer_observe to see the screen.' }
      }),
  )
  server.registerTool(
    'test_device_install',
    {
      description:
        'Install a built app on the opened test device. path is relative to the workspace: a .app bundle for iOS, an .apk for Android.',
      inputSchema: { id, path: z.string().min(1).max(1000) },
    },
    ({ id: deviceId, path }) =>
      guard(() => testDevices.install(deviceId, live().taskId, workspace.agentScope(live().taskId).cwd, path)),
  )
  server.registerTool(
    'test_device_launch',
    {
      description:
        'Start an installed app on the opened test device by bundle identifier (iOS) or package name (Android).',
      inputSchema: { id, app: z.string().min(1).max(200) },
    },
    ({ id: deviceId, app }) => guard(() => testDevices.launch(deviceId, live().taskId, app)),
  )
  server.registerTool(
    'test_device_open_link',
    {
      description: 'Open a deep link or web address on the opened test device.',
      inputSchema: { id, url: z.string().min(3).max(2000) },
    },
    ({ id: deviceId, url }) => guard(() => testDevices.openUrl(deviceId, live().taskId, url)),
  )
  server.registerTool(
    'test_device_logs',
    {
      description: "Read the launched app's recent log lines, filtered to that app, with known secrets removed.",
      inputSchema: { id, app: z.string().min(1).max(200), lines: z.number().int().min(1).max(500).optional() },
    },
    ({ id: deviceId, app, lines }) => guard(() => testDevices.logs(deviceId, live().taskId, app, lines)),
  )
  server.registerTool(
    'test_device_stop',
    { description: 'Shut down a test device this thread opened.', inputSchema: { id } },
    ({ id: deviceId }) =>
      guard(async () => {
        const session = live()
        await testDevices.releaseThread(session.taskId)
        computer.revoke(session.taskId)
        return { stopped: deviceId }
      }),
  )
}
