import { MEDIA_SERVICES } from '@ramu/shared/types/media'
import { ServiceGrants } from './interactive/serviceGrants'
import { DASHBOARD_ROWS_MAX } from '@ramu/shared/artifactSource'
import { LastingAddresses } from './workspace/deploy/namedTunnel'
import { ShellPushes } from './agent/shellPushes'
import { followPush } from './workspace/followPush'
import { productionAddress } from './workspace/forge'
import { terminalThreadRequest } from './background/agentThreads'
import { NO_PROJECT_GUIDE, projectFactsText } from './workspace/projectCreate'
import { HELPER_ROLES } from '@ramu/shared/chat/helperRoles'
import { CustomAgentStore } from './agent/customAgents'
import { TEST_DEVICE_GUIDE, TestDevices } from './testDevice/testDevices'
import { currentBranch } from './workspace/git'
import { TEST_DEVICE_ORIENTATIONS } from '@ramu/shared/testDevices'
import { customAgentList } from '@ramu/shared/customAgents'
import { ResourceService } from './background/resources'
import { ServerService } from './background/servers'
import type { ProcessRoot } from '@ramu/shared/resources'
import { processRoots } from './agent/processOwners'
import { writeEvent } from './remote/eventStream'
import { DEFAULT_AGENT_BROWSER_PREFERENCES } from '@ramu/shared/browser'
import { providerAdapter } from './providers/adapters'
import { claudeConfigHome } from './providers/adapters/claude-code'
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
  type AgentSettings,
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
import { registerScriptTools } from './agent/scriptTools'
import { SettingsChanges } from './settings/settingsChanges'
import { registerSettingsTools } from './settings/settingsTools'
import type { SettingsSnapshot } from '@ramu/shared/settingsCompatibility'
import { registerBackgroundTerminalTools } from './agent/backgroundTerminalTools'
import { registerUserTerminalTools } from './agent/userTerminalTools'
import { UptimeWatches } from './workspace/deploy/uptime'
import { ProjectWake } from './workspace/deploy/wake'
import { MediaAccounts } from './media/mediaAccounts'
import { LocalApps, type SavedApp } from './workspace/deploy/localApp'
import { LiveDashboards, dataSourceTable, watchDashboards } from './interactive/liveDashboard'
import { tableFromFile } from './interactive/dashboardFile'
import { readText } from './workspace/files'
import { appliedDesignSystem, designTokensOf } from '@ramu/shared/artifacts'
import { ProductionMigrations } from './workspace/deploy/migrations'
import { registerPluginCliTools } from './plugins/cli'
import { draftPluginsFolder, registerPluginTools } from './plugins/tools'
import { acceptOffer, setToolAvailability } from './toolSync'
import { startToolDelivery } from './toolDelivery'
import { toolOfferSchema } from '@ramu/shared/toolSync'
import { toolKey } from '@ramu/shared/toolSync'
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
import { homedir } from 'node:os'
import { NoticeInbox } from './background/notices'
import { join } from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerQuestionTools } from './agent/questionTools'
import { registerInlineUiTools } from './agent/inlineUiTools'
import { registerSecretTools } from './agent/secretTools'
import { SecretFiles } from './agent/secretFiles'
import { usesRamuQuestionTools, usesRamuToolScripts, usesRamuToolSearch } from './agent/nativeFeatures'
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
import { DeviceStore, isHostAccess, validLifetime, type DeviceInfo, type DeviceRole } from './remote/devices'
import { RemoteAccess, accessOf, deviceMayInvoke } from './remote/access'
import { PermissionRequests } from './remote/permissionRequests'
import { PairBackInvites } from './remote/pairBackInvites'
import { deviceOsSchema, readHostOs } from './remote/hostOs'
import {
  DEVICE_PERMISSIONS,
  PERMISSION_ANSWERS,
  PERMISSION_SETTINGS,
  grantFor,
  isDevicePermission,
  permissionFor,
  permissionRefusal,
} from '@ramu/shared/devicePermissions'
import { PairingError, PairingRequests } from './remote/pairingRequests'
import { createPairingNotice } from './remote/pairingNotice'
import { clientAddress, type PublicTunnel } from './remote/clientAddress'
import { PhoneForwards, phoneForwardPeer, phoneForwardTarget } from './remote/phoneForward'
import { parseTunnelChoice, TunnelManager } from './remote/tunnel'
import { LinkClient } from './remote/ramuLink'
import { LINK_URL } from '@ramu/shared/ramuLink'
import { HostAdvertiser, advertisedInterfaces, discoveryName, readDiscoveryHostId } from './remote/discovery'
import { HostName, hostNameInput, useHostName } from './remote/hostName'
import { cleanDiscoveryName } from '@ramu/shared/discovery/contract'
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
import { PullRequestWrites } from './background/pullRequestWrites'
import { registerPullRequestTools } from './background/pullRequestTools'
import { guardForge } from './ipc/identityGuard'
import { AgentThreadService, hostThreadRequest } from './background/agentThreads'
import { describeValidationError } from './validation'
import { RemoteThreads } from './background/remoteThreads'
import { AgentHostService } from './remote/agentHosts'
import { runtimeBuild, runtimeVersion } from './build'
import { ReviewService } from './review/reviews'
import { RecapService } from './memory/recaps'
import { MemoryService, registerMemoryTools } from './memory/memory'
import { RuleStore } from './rules/rules'
import { RuleFiles } from './rules/ruleFiles'
import { PluginService } from './plugins/service'
import { AccountService } from './account/service'
import { exportSettings } from './ipc/handlers/settingsTransfer'
import { TRANSFER_GROUP_IDS } from '@ramu/shared/settingsTransfer'
import { PAIR_REQUEST_PATH, PAIR_REVEAL_PATH } from '@ramu/shared/pairRequest'
import { githubToken } from './workspace/forge/github'
import { IdentityService } from './identities/service'
import { ProjectPlaces } from './identities/places'
import { setFolderEnvironment } from './userEnvironment'
import { execFileSync } from 'node:child_process'
import { providerVariable, setAccountRestriction } from './providers/providerBinaries'
import { accountKey } from '@ramu/shared/identities'
import { setConnectionIdentityScope } from './mcp/policy'
import { RAMU_INDEX_KEY } from '@ramu/shared/plugins'
import { SummaryService, registerLibraryTools, withoutTools } from './memory/summaries'
import { discoverSkills } from './context'
import { NO_PROJECT, type AgentSessionInfo, type ScheduleInput, type SetupOmission } from '@ramu/shared/types'

const config = loadConfig()
const { userData, socketPath } = config
mkdirSync(userData, { recursive: true })
// Network clients present their own device token (see `ramu pair`).
const devices = new DeviceStore(config.devicesPath, config.deviceLifetimeMs)
const hostId = readDiscoveryHostId(join(userData, 'discovery.json'))
const hostNames = new HostName(join(userData, 'host-name.json'))
useHostName(hostNames)
const pairingRequests: PairingRequests = new PairingRequests({
  devices,
  hostId,
  // Nearby devices may ask while this host lets itself be found, or while Pair a device is open. A request the Ramu
  // account relayed comes from the same person's signed-in device, to a host they listed; it needs approval here unless
  // the person here chose to let the account's devices in.
  accepting: (peer) => peer.startsWith('account:') || network.discoverable || devices.offers().length > 0,
  addresses: () =>
    [
      ...publicCandidates(),
      ...(network.enabled ? candidateUrls(network.host, network.port, Boolean(config.tls)) : []),
    ].map((candidate) => candidate.url),
  // The person here can let devices signed in to this host's own Ramu account pair without asking (Settings → Account).
  autoApprove: (peer): DeviceRole | null =>
    account.trustFor(peer, (id: string) => devices.list().some((device) => device.id === id)),
  joined: (device, peer) => {
    account.pairedOnItsOwn(peer, device.id)
    const email = account.email() ?? ''
    console.log(`${device.name} connected through the Ramu account ${email} with ${device.role} access.`)
    const message = `data: ${JSON.stringify({
      channel: 'pairing:joined',
      payload: { deviceId: device.id, name: device.name, role: device.role, email },
    })}\n\n`
    for (const client of hostClients) if (!client.destroyed) writeEvent(client, message)
    syncDiscovery()
  },
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
  peer: (req) => clientAddress(req, publicTunnel()),
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
const advertiser = new HostAdvertiser({ hostId, name: () => hostNames.display() })
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
// Ramu Link's client, made once the account is ready; the tunnel asks it for the relay's token.
let ramuLink: LinkClient | null = null
// A tunnel Ramu runs itself (Ramu Link, Cloudflare quick tunnel, Tailscale Funnel, ngrok), while the listener is up.
const tunnels = new TunnelManager({
  lease: (relay, target) => ramuLink?.lease(relay ?? LINK_URL, target) ?? Promise.resolve(null),
  link: () => ({ status: ramuLink?.status() ?? null, pool: ramuLink?.cachedPool() ?? null }),
})
/** Tells the relay this host is going away, briefly: shutting down never waits long on the network. */
const linkOffline = () =>
  network.tunnel?.kind === 'link' && ramuLink
    ? Promise.race([ramuLink.offline(), new Promise<void>((resolve) => setTimeout(resolve, 3_000).unref())])
    : Promise.resolve()
/** Where a tunnel reaches this host's listener on this computer. */
const tunnelTarget = () => {
  const scheme = config.tls ? 'https' : 'http'
  const local = network.host === '0.0.0.0' || network.host === '::' || /^127\.|^::1$/.test(network.host)
  return `${scheme}://${local ? '127.0.0.1' : network.host.includes(':') ? `[${network.host}]` : network.host}:${network.port}`
}
const syncTunnel = () => tunnels.use(network.tunnel, network.enabled && remote?.listening ? tunnelTarget() : null)
/** A tunnel's address from the command line wins over the one saved in Settings. */
const publicUrl = () => config.publicUrl ?? (network.tunnel ? tunnels.address() : network.publicUrl)
/** What delivers requests to the public address, which decides the header that names a visitor (see `clientAddress`). */
const publicTunnel = (): PublicTunnel =>
  publicUrl() === null
    ? null
    : !config.publicUrl && (network.tunnel?.kind === 'link' || network.tunnel?.kind === 'quick')
      ? 'cloudflare'
      : 'proxy'
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
/** Changes that alter which tools travel to the hosts this host added for agents. */
const TOOL_CHANNELS = new Set(['toolSync:changed', 'plugins:changed', 'mcp:changed', 'memory:changed'])
const toolDelivery: { changed?: () => void } = {}
const send = (channel: string, payload: unknown) => {
  if (TOOL_CHANNELS.has(channel)) toolDelivery.changed?.()
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
const places = new ProjectPlaces(workspace, join(root, '..', 'chats'))
const identities = new IdentityService({
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  places: () => places.places(),
  changed: () => send('identities:changed', null),
  mismatched: (mismatch) => send('identities:mismatch', mismatch),
  gitUser: (() => {
    const read = (key: string) => {
      try {
        return execFileSync('git', ['config', '--global', key], { encoding: 'utf8', timeout: 3000 }).trim() || null
      } catch {
        // Unset keys exit non-zero, and a host without Git has no user to offer.
        return null
      }
    }
    let cached: { name: string | null; email: string | null } | undefined
    return () => (cached ??= { name: read('user.name'), email: read('user.email') })
  })(),
})
void places.refresh().catch(() => {})
// A Shared MCP server or plugin put in one identity reaches only that identity's projects.
setConnectionIdentityScope((connectionId, projectId) => {
  const connections = getSharedMcp().policy.snapshot().connections
  const connection = connections.find((entry) => entry.id === connectionId)
  const identity = identities.settings().identities.length >= 2 ? identities.forProject(projectId)?.id : undefined
  // One identity's own account on a server reaches only that identity's projects, in place of the base connection.
  if (connection?.split) return connection.split.identityId === identity
  if (
    identity &&
    connections.some((entry) => entry.split?.base === connectionId && entry.split.identityId === identity)
  )
    return false
  if (!identities.allowed(projectId, accountKey('mcp', connectionId))) return false
  // A plugin's servers follow the identity the plugin was put in.
  const account = connection?.serviceAccountId
  return (
    !account?.startsWith('plugin-') ||
    identities.allowed(projectId, accountKey('plugin', account.slice(7).split('@')[0]!))
  )
})
/** The project a task acts in, or null for No project, whose threads use the default identity. */
const identityProject = (taskId: string) => {
  try {
    const projectId = workspace.getTask(taskId).projectId
    return projectId === NO_PROJECT ? null : projectId
  } catch {
    return null
  }
}
// A thread uses its identity's own logins of a provider, else those for every identity; never another identity's.
setAccountRestriction((provider, accountId, taskId) => {
  const config =
    workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).providerBinaries?.[provider] ?? undefined
  const keys = [
    ...(config?.defaultAccountEnabled === false ? [] : ['default']),
    ...(config?.accounts ?? []).map((account) => account.id),
  ].map((id) => accountKey('provider', provider, id))
  return identities
    .choose(identityProject(taskId), keys, (key) => key)
    .includes(accountKey('provider', provider, accountId))
})
// Agents, terminals and Ramu's own Git calls in a project commit as its identity.
setFolderEnvironment((cwd) => {
  const projectId = places.projectOf(cwd)
  return projectId ? identities.environment(projectId) : {}
})
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
    // A thread keeps its test device across turns; stopping it gives the device back.
    if (event.kind === 'state' && ['failed', 'stopped'].includes(event.state))
      try {
        const session = agents.get(sessionId)
        if (!session.parentId) void testDevices.releaseThread(session.taskId)
      } catch {}
    threadTitles?.observe(sessionId, event)
    shellPushes?.observe(sessionId, event)
    if (event.kind === 'state') void adoptClones(sessionId, event.state)
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
// A repository added to a project (cloned into its folder, or added by hand) is reached by threads already working
// there, so their pull request, review and checkout tools see it without starting a new thread.
workspace.repositoryAdded = (repo) => {
  for (const task of workspace.listTasks(repo.projectId)) agents.coverRepository(task.id, repo.root)
}
// Threads that were already open when one of their project's repositories was added catch up once at startup.
for (const project of workspace.listProjects())
  for (const repo of workspace.listRepositories(project.id)) workspace.repositoryAdded(repo)
/**
 * A repository an agent clones straight into its project's folder joins the project when the turn ends. Repositories
 * already there when the turn began stay as the person arranged them, so one they removed is not added back.
 */
const cloneBaselines = new Map<string, Set<string>>()
async function adoptClones(sessionId: string, state: string) {
  try {
    const session = agents.get(sessionId)
    if (session.parentId) return
    const projectId = workspace.projectIdOf(session.taskId)
    if (projectId === NO_PROJECT) return
    if (state === 'starting' || state === 'running') {
      if (!cloneBaselines.has(sessionId))
        cloneBaselines.set(sessionId, new Set(workspace.unregisteredChildRepositories(projectId)))
      return
    }
    if (state === 'needs-input') return
    const before = cloneBaselines.get(sessionId)
    cloneBaselines.delete(sessionId)
    if (!before) return
    const cloned = workspace.unregisteredChildRepositories(projectId).filter((root) => !before.has(root))
    for (const root of cloned) await workspace.addRepository(projectId, root)
    if (cloned.length) send('workspace:changed', {})
  } catch {
    // A thread or project removed mid-turn has nothing to join.
  }
}
// A `git push` an agent runs itself is followed from the checkout it ran in, as Source Control's push is.
const shellPushes = new ShellPushes((sessionId) => {
  const session = agents.get(sessionId)
  for (const binding of workspace.listBindings(session.taskId))
    if (!binding.folderOnly && binding.cwd === session.cwd)
      followPush(pullRequestWatches, session.taskId, binding.cwd, binding.repoId)
})
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
const testDevices = new TestDevices(() => workspace.getAppState<boolean>('test-devices:enabled', false) === true, {
  defaults: () => {
    const chosen = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).testDevices
    return {
      ...(chosen?.iosModel ? { ios: chosen.iosModel } : {}),
      ...(chosen?.androidModel ? { android: chosen.androidModel } : {}),
    }
  },
  choices: () => {
    const chosen = workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).testDevices
    return { keepWarm: chosen?.keepWarm === true, maxRunning: chosen?.maxRunning ?? null, slim: chosen?.slim === true }
  },
  waiting: (taskId, platform) => {
    const session = agents.list(taskId).findLast((entry) => !entry.parentId && entry.state !== 'stopped')
    if (session) agents.testDeviceWaiting(session.id, platform)
  },
  // A restarted or lost device reaches the thread's lead through its durable queue, so the agent relaunches the app.
  notify: (taskId, text) =>
    void (async () => {
      const session = agents.list(taskId).findLast((entry) => !entry.parentId && entry.state !== 'stopped')
      const branch = session ? await currentBranch(session.cwd).catch(() => null) : null
      if (session && branch) agents.enqueueBackground(session.id, text, { cwd: session.cwd, branch })
    })(),
})
testDevices.start()
const refreshTestPlatforms = () =>
  void testDevices.readyPlatforms().then(
    (platforms) => (resources.testDevices = platforms),
    () => {},
  )
setTimeout(refreshTestPlatforms, 5000).unref?.()
setInterval(refreshTestPlatforms, 10 * 60_000).unref?.()
agents.customAgents = () => customAgents.list()
/** Everything still running that this service started and a thread owns: agents, terminals, commands and test devices. */
const threadRoots = (): ProcessRoot[] => {
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
}
const servers = new ServerService(threadRoots)
const resources = new ResourceService(
  {
    roots: threadRoots,
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
const projectWake = new ProjectWake(db, workspace, agents)
const uptime = new UptimeWatches(
  {
    getState: (key, fallback) => workspace.getAppState(key, fallback),
    setState: (key, value) => workspace.setAppState(key, value),
    projectIds: () => workspace.listProjects().map((project) => project.id),
    healthPath: (projectId) => workspace.projectConfiguration(projectId).config.stack?.healthPath ?? null,
    async openThread(projectId, title, brief, requestId) {
      const task = await workspace.createTask({ projectId, title, mode: 'current', requestId })
      // The project's latest thread's model, with no more than Auto access: nobody asked for this thread, and its
      // one consequential action, a rollback, asks the person whatever the access.
      const latest = projectWake.latestThread(projectId)
      const settings: AgentSettings = latest ? agents.get(latest).settings : DEFAULT_AGENT_SETTINGS
      const session = await agents.startReviewed(task.id, workspace.agentScope(task.id), brief, {
        ...settings,
        access: settings.access === 'full' ? 'auto' : settings.access,
      })
      return { taskId: task.id, sessionId: session.id }
    },
    notify(thread) {
      send('workspace:changed', {})
      void mobilePush.deliverIncident(thread).catch(() => {})
    },
    // The uptime watch follows an app published from this computer at its lasting address.
    localAddress: (projectId) => localApps.lastingUrl(projectId),
    async productionAddress(projectId) {
      for (const repository of workspace.listRepositories(projectId)) {
        const url = await productionAddress(repository.root)
        if (url) return url
      }
      return null
    },
    // Any answer, even a refusal, shows this host reaches the internet.
    online: () =>
      fetch('https://github.com', { method: 'HEAD', signal: AbortSignal.timeout(5000) }).then(
        () => true,
        () => false,
      ),
  },
  projectWake,
)
const mediaAccounts = new MediaAccounts(
  (key, fallback) => workspace.getAppState(key, fallback),
  (key, value) => workspace.setAppState(key, value),
  undefined,
  undefined,
  (service) => {
    const token = service === 'gemini' ? providerVariable('antigravity', 'GEMINI_API_KEY') : null
    return token ? { token, from: 'Antigravity' } : null
  },
)
// Thread rows show their pull request, so a change there refreshes the thread lists.
const pullRequestIndex = new PullRequestIndex(workspace, agents, () => send('workspace:changed', {}))
const pullRequestDrafts = new PullRequestDrafts(
  workspace,
  agents,
  () => send('workspace:changed', {}),
  (repoId) => pullRequestIndex.viewer(repoId),
)
const pullRequestWrites = new PullRequestWrites(
  workspace,
  agents,
  () => send('workspace:changed', {}),
  (taskId, cwd, action) => guardForge({ identities, workspace, agents }, taskId, cwd, action),
)
const settingsChanges = new SettingsChanges(
  workspace,
  agents,
  {
    snapshot: () =>
      origin.run({ network: false }, () => dispatcher.invoke('settings.app.snapshot', [])) as Promise<SettingsSnapshot>,
    patch: (edits) =>
      origin.run({ network: false }, () =>
        dispatcher.invoke('settings.app.patch', [edits]),
      ) as Promise<SettingsSnapshot>,
  },
  (taskId) => workspace.getTask(taskId).title,
  () => send('workspace:changed', {}),
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
  observe: (sessionId, event) => reviews!.observe(sessionId, event),
  commandTurn: (sessionId, toolUseId, signal) => reviews!.commandTurn(sessionId, toolUseId, signal),
}
const recaps = new RecapService(db, workspace, agents, changed, () => void mobilePush.deliverDigest().catch(() => {}))
const memory = new MemoryService(db, workspace, agents, () => send('memory:changed', {}), join(userData, 'memory'))
// Once a second identity exists, notes also have an identity level between a project and everywhere.
memory.identityOf = (projectId) =>
  identities.settings().identities.length >= 2 ? (identities.forProject(projectId)?.id ?? null) : null
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
learning.identityOf = memory.identityOf
learning.sameIdentity = (projectId) => {
  if (identities.settings().identities.length < 2) return null
  const identity = identities.forProject(projectId)?.id
  return identities
    .projects()
    .filter((entry) => entry.identityId === identity)
    .map((entry) => entry.projectId)
}
const externalSkills = new ExternalSkills(learning, workspace)
externalSkills.toolsChanged = () => send('toolSync:changed', null)
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
const ruleFiles = new RuleFiles({
  rules: () => rules.list(),
  repositories: () =>
    workspace
      .listProjects()
      .flatMap((project) =>
        workspace.listRepositories(project.id).map((repo) => ({ projectId: project.id, root: repo.root })),
      ),
  claudeHome: claudeConfigHome,
  identityOf: (projectId) => identities.forProject(projectId)?.id ?? null,
})
rules.identityOf = (projectId) =>
  identities.settings().identities.length >= 2 ? (identities.forProject(projectId)?.id ?? null) : null
// Brings Claude's path-rule files in line with rules saved or repositories changed while Ramu was not running.
ruleFiles.sync()
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
            readOnly: tool.annotations?.readOnlyHint === true,
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
    media: {
      connected: () => MEDIA_SERVICES.filter((service) => mediaAccounts.connected(service)),
      auth: (service) => mediaAccounts.auth(service),
    },
    readChecks: () => workspace.getAppState<unknown>('ability-checks', []),
    writeChecks: (checks) => workspace.setAppState('ability-checks', checks),
    readMcpChecks: () => workspace.getAppState<unknown>('ability-mcp-checks', []),
    writeMcpChecks: (checks) => workspace.setAppState('ability-mcp-checks', checks),
    inProject: (sessionId) => workspace.getTask(agents.get(sessionId).taskId).projectId !== NO_PROJECT,
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
// A dashboard's live tables, read from its own project: its live address checks or threads in each source's fixed
// column order, or a file in its folder, read only.
const isoTime = (at: number) => new Date(at).toISOString()
const serviceGrants = new ServiceGrants(
  (key, fallback) => workspace.getAppState(key, fallback),
  (key, value) => workspace.setAppState(key, value),
)
const liveDashboards = new LiveDashboards(
  async (projectId, { source, file, records, mcp, service, columns }, artifactId) => {
    if (service) {
      // A plugin's data source is read only for a kept dashboard the person allowed to read it, with the credential
      // saved for that plugin.
      if (!artifactId || !serviceGrants.allowed(artifactId).includes(service.id)) return []
      return dataSourceTable(await plugins.query(service.id, service, columns, DASHBOARD_ROWS_MAX, projectId), columns)
    }
    if (mcp && projectId) {
      // Only a tool the server marks read-only, on a server Shared MCP approved for this project, is called.
      const signal = AbortSignal.timeout(30_000)
      const opened = await pageExternal.open(
        { id: `dashboard-${projectId}`, projectId } as ArtifactInfo,
        pageSettings('fast'),
        [mcp.server],
        signal,
      )
      try {
        const tool = opened.tools.find((entry) => entry.name === mcp.tool && entry.readOnly)
        if (!tool) return []
        const content = (await tool.call(mcp.arguments ?? {}, signal)) as { type?: string; text?: string }[]
        const text = content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join('')
        return tableFromFile('result.json', text, columns)
      } finally {
        await opened.close()
      }
    }
    if (records) {
      // Only an App in the dashboard's own project (or, for a dashboard in no project, an App in none) is read.
      if (!pages.has(records.artifact) || (pages.get(records.artifact).projectId ?? null) !== projectId) return []
      return pages.records(records.artifact, records.collection).map((record) =>
        columns.map((column) => {
          if (column === 'createdAt') return isoTime(record.createdAt)
          const value = column === 'id' ? record.id : record.data[column]
          if (value === undefined || value === null) return null
          if (typeof value === 'number' || typeof value === 'string')
            return typeof value === 'string' ? value.slice(0, 200) : value
          return JSON.stringify(value).slice(0, 200)
        }),
      )
    }
    if (source === 'activity') {
      const since = new Date()
      since.setHours(0, 0, 0, 0)
      since.setDate(since.getDate() - 29)
      return agents
        .activity(since.getTime())
        .map((row) => [row.day, row.provider, row.turns, row.costUsd, row.tokens ?? null])
    }
    if (!projectId) return []
    if (source === 'threads' || source === 'pullRequests') {
      const tasks = workspace.listTasks(projectId).slice(0, 500)
      if (source === 'threads')
        return tasks.map((task) => [task.title, task.status, task.doneAt ? 1 : 0, isoTime(task.lastActiveAt)])
      return tasks.flatMap((task) => {
        const pull = pullRequestIndex.forTask(task)
        return pull ? [[task.title, pull.number, pull.title, pull.state, pull.stage, pull.url]] : []
      })
    }
    if (file) {
      const root = workspace.listProjects().find((project) => project.id === projectId)?.root
      if (!root) return []
      return tableFromFile(file, (await readText(root, file)).content, columns)
    }
    const last = uptime.status(projectId).last
    return last ? [[isoTime(last.at), last.result, last.status, last.ms]] : []
  },
)
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
// A lasting address: a named Cloudflare Tunnel that never reaches Ramu's own port.
const lastingAddresses = new LastingAddresses({
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  reserved: () => [network.port],
})
const localApps = new LocalApps({
  addresses: lastingAddresses,
  saved: {
    read: () => workspace.getAppState<Record<string, SavedApp>>('local-apps', {}),
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
const plugins = new PluginService({
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  dir: join(userData, 'plugins'),
  ramuVersion: serviceVersion,
  skills: {
    list: () => learning.skills(),
    write: (skill) => learning.write(skill),
    remove: (id) => learning.remove(id),
  },
  mcp: {
    connections: () => getSharedMcp().policy.snapshot().connections,
    save: (input, id) => getSharedMcp().save(input, id),
    remove: (id) => getSharedMcp().remove(id),
    setSecret: (id, kind, name, value) => getSharedMcp().setSecret(id, kind, name, value),
    splitFor: (id, identity) => getSharedMcp().splitFor(id, identity),
  },
  identityOf: (projectId) =>
    identities.settings().identities.length >= 2 && projectId ? (identities.forProject(projectId)?.id ?? null) : null,
  agents: customAgents,
  rules: {
    save: (input) => {
      const rule = rules.save(input)
      ruleFiles.sync()
      send('rules:changed', {})
      return rule
    },
    remove: (id) => {
      rules.remove(id)
      ruleFiles.sync()
      send('rules:changed', {})
    },
  },
  projects: () => workspace.listProjects(),
  preferences: {
    load: () => workspace.getAppState<AppPreferences>('app-preferences', DEFAULT_APP_PREFERENCES),
    save: (preferences) => workspace.setAppState('app-preferences', preferences),
  },
  changed: () => {
    send('memory:changed', {})
    send('plugins:changed', null)
  },
  indexKey: RAMU_INDEX_KEY,
  identityAllows: (pluginId, projectId) => identities.allowed(projectId, accountKey('plugin', pluginId)),
})
plugins.start()
const account: AccountService = new AccountService({
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  hostName: () => hostNames.display(),
  hostId,
  // A backup carries every portable group but the notes, which stay where they were written.
  exportSettings: () =>
    exportSettings(
      {
        loadPreferences: abilityPreferences,
        workspace,
        rules,
        identities,
        memory,
        mediaAccounts,
        getSharedMcp,
        plugins,
        hostBrowser,
        learning,
      },
      TRANSFER_GROUP_IDS.filter((group) => group !== 'memories'),
    ),
  githubToken,
  pairing: async (peer, path, body) => {
    try {
      if (path === PAIR_REQUEST_PATH) return { status: 200, body: pairingRequests.begin(peer, body) }
      if (path === PAIR_REVEAL_PATH) {
        pairingRequests.reveal(peer, body)
        return { status: 200, body: { ok: true } }
      }
      return { status: 200, body: await pairingRequests.wait(peer, body) }
    } catch (error) {
      return {
        status: error instanceof PairingError ? error.status : 400,
        body: { error: error instanceof Error ? error.message : 'Invalid pairing request' },
      }
    }
  },
  changed: () => {
    send('account:changed', null)
    ramuLink?.accountChanged()
  },
})
account.start()
ramuLink = new LinkClient({
  hostId,
  hostName: () => hostNames.display(),
  bearer: () => account.bearer(),
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  changed: () => {},
  wanted: () => network.enabled && network.tunnel?.kind === 'link',
})
ramuLink.onLease = (lease) => tunnels.relinked(lease)
workspace.settingsStore?.subscribe(() => account.settingsChanged())
/** Migrations every production deploy runs first, against the database address saved for the project. */
const productionMigrations = new ProductionMigrations({
  getState: (key, fallback) => workspace.getAppState(key, fallback),
  setState: (key, value) => workspace.setAppState(key, value),
  migrate: (projectId) => workspace.projectConfiguration(projectId).config.stack?.migrate ?? null,
})
agents.beforeProduction = (session) => {
  const project = projectOf(session)
  return productionMigrations.beforeProduction(project && project !== NO_PROJECT ? project : null, session.cwd)
}
const externalTools = new ExternalSessionTools(
  getSharedMcp,
  (sessionId, title, detail, signal, options) => agents.requestPermission(sessionId, title, detail, signal, options),
  (sessionId, title, detail, signal) => agents.approveProductionDeploy(sessionId, title, detail, signal),
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
toolDelivery.changed = startToolDelivery({ workspace, plugins, getSharedMcp, learning, identities }, agentHosts, () =>
  send('toolSync:changed', null),
).changed
const agentThreads = new AgentThreadService(
  db,
  workspace,
  agents,
  async (method, args) => await origin.run({ network: false }, () => dispatcher.invoke(method, args)),
  changed,
  new RemoteThreads(db, agents, agentHosts, changed),
)
agentThreads.gitEmail = (place) =>
  place.projectId !== undefined
    ? identities.email(place.projectId === NO_PROJECT ? null : place.projectId)
    : identities.email({
        id: 'new',
        folders: place.folder ? [place.folder] : [],
        remotes: place.remote ? [place.remote] : [],
      })
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
    callerName: () => {
      const caller = origin.getStore()
      if (!caller?.network) return hostNames.display()
      return devices.list().find((device) => device.id === caller.deviceId)?.name
    },
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
    plugins,
    identities,
    account,
    browser: browserBroker,
    hostBrowser,
    computer,
    computerVideo,
    terminals,
    resources,
    servers,
    customAgents,
    testDevices,
    agents,
    threadTitles,
    interactive,
    pages,
    artifactExports: new ArtifactExports(db),
    liveDashboards,
    serviceGrants,
    pageAi,
    abilities,
    notifyPage,
    publicPages,
    publicPageTunnel,
    artifactWebhookBases: () => schedules.webhookBases?.().map((base) => base.url.replace(/\/$/, '')) ?? [],
    schedules,
    pullRequestWatches,
    uptime,
    mediaAccounts,
    localApps,
    migrations: productionMigrations,
    pullRequestIndex,
    pullRequestDrafts,
    pullRequestWrites,
    settingsChanges,
    recaps,
    reviews,
    memory,
    learning,
    externalSkills,
    diagnostics,
    summaries,
    rules,
    ruleFiles,
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
  await linkOffline()
  tunnels.stop()
  publicPages.close()
  phoneForwards.closeAll()
  await schedules.stop()
  await pullRequestWatches.stop()
  localApps.close()
  await uptime.stop()
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
// A phone's dev-server forwards: one listener each, closed by its viewer, after 30 minutes or when the device goes.
const phoneForwards = new PhoneForwards()
const dropRevoked = () => {
  for (const [stream, header] of remoteStreams) if (!stillAuthorized(header)) stream.end()
  phoneForwards.keepOnly((id) => devices.list().some((device) => device.id === id && device.role !== 'viewer'))
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
  /** The connection the call arrived on, for calls that answer the device where it is. */
  req?: import('node:http').IncomingMessage,
): Promise<{ value: unknown; after?: () => void }> {
  const deviceId = device?.id
  if (operationKey !== undefined && !(typeof operationKey === 'string' && OPERATION_KEY_PATTERN.test(operationKey)))
    throw new Error('Invalid operation key.')
  if (remote && !deviceMayInvoke(device, method))
    throw new InvokeRefused(
      device?.kind === 'host'
        ? 'A paired host may only start, check and message the threads it starts here, and offer its tools.'
        : method.startsWith('hostThreads.') || method.startsWith('hostTools.')
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
  } else if (method === 'device.rename') {
    // A paired device names itself as this host lists it; this computer has its own name instead.
    if (!device) throw new Error('Rename this host under Settings → Remote access.')
    devices.rename(device.id, hostNameInput.parse(args?.[0] ?? null))
    value = undefined
  } else if (method === 'host.name') {
    const self = device ? devices.list().find((entry) => entry.id === device.id) : undefined
    value = { ...hostNames.info(), ...(self ? { device: { name: self.name, renamed: !!self.pairedName } } : {}) }
  } else if (method === 'device.describe') {
    // This computer itself needs no description; a paired device tells what it runs on, bounded and checked.
    if (device) devices.describe(device.id, deviceOsSchema.parse(args?.[0]))
    value = undefined
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
  } else if (method === 'hostBrowser.phoneForward') {
    // A dev server listening only on loopback, opened in this phone's own browser through a port only it can use.
    if (!remote || !device || device.kind === 'host' || device.role === 'viewer' || !req)
      throw new InvokeRefused('Only a paired owner phone can open a page from the host this way.')
    const [page] = z.tuple([z.string().min(1).max(4000)]).parse(args)
    const target = phoneForwardTarget(page, [network.port, address.port])
    const from = clientAddress(req, publicTunnel())
    const peer = phoneForwardPeer(req.socket.remoteAddress, req.socket.localAddress, from.tunneled)
    value = await phoneForwards.open({ deviceId: device.id, ...peer, target })
  } else if (method === 'hostBrowser.phoneForwardClose') {
    if (!remote || !device) throw new InvokeRefused('Only the phone that opened a forward can close it.')
    phoneForwards.close(device.id, z.tuple([z.string().uuid()]).parse(args)[0])
    value = undefined
  } else if (method === 'hostTools.offer') {
    // Another host's tools only wait here for a review by the person on this host; nothing installs or is removed.
    if (!remote || device?.kind !== 'host') throw new InvokeRefused('Only a paired host can make this call.')
    const parsed = toolOfferSchema.safeParse(args?.[0])
    if (!parsed.success) throw new Error(describeValidationError(parsed.error))
    const accepted = acceptOffer({ workspace, plugins, getSharedMcp, learning, identities }, parsed.data)
    if (accepted.received) send('toolSync:changed', null)
    value = accepted
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
    else if (method === 'hostThreads.stop')
      value = await agentThreads.stopForHost(device, z.string().min(1).max(100).parse(args?.[0]))
    else if (method === 'hostThreads.message') {
      const [taskId, text, mode] = z
        .tuple([z.string().min(1).max(100), z.string().min(1).max(20_000), z.enum(['queue', 'steer'])])
        .parse(args)
      value = await agentThreads.messageForHost(device, taskId, text, mode)
    } else throw new Error(`Unknown method ${method}`)
  } else if (method === 'background.status')
    value = {
      running: true,
      hostname: hostNames.display(),
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
  // A paired phone may see how this host is reached from anywhere and turn on Ramu Link (with the settings permission);
  // the rest of network access, with its devices and pairing codes, stays on the host.
  else if (method === 'network.link') value = { tunnel: networkStatus().tunnel ?? null }
  else if (method === 'network.useLink') {
    await networkMethod('network.setTunnel', [{ kind: 'link' }])
    value = { tunnel: networkStatus().tunnel ?? null }
  } else if (method.startsWith('network.')) {
    if (remote) throw new Error('Network access is managed from the host running Ramu')
    value = await networkMethod(method, args)
  } else if (method === 'background.stop') {
    return { value: undefined, after: () => void stop(true) }
  } else if (method === 'background.restart') {
    return { value: undefined, after: () => void stop() }
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
  const [mcpPath, mcpQuery] = (req.url ?? '').split('?')
  if (!source || (mcpPath !== '/mcp' && mcpPath !== '/mcp/external') || stopping) {
    res.writeHead(401).end()
    return
  }
  if (req.method !== 'POST') {
    res.writeHead(405).end()
    return
  }
  if (mcpPath === '/mcp/external') {
    // External tools stay off the trusted Ramu registry: a separate endpoint and server name, gated by Shared MCP policy.
    try {
      await externalTools.serve(externalSource(source), req, res, await body(req))
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
    return
  }
  const target = new McpServer({ name: 'ramu', version: '0.1.0' })
  // OpenCode lists the always-loaded tools from one entry and reaches the rest through execute from another.
  const subset = new URLSearchParams(mcpQuery ?? '').get('tools')
  const registry = new ToolRegistry(
    target,
    connection!.toolSearch,
    subset === 'always' || subset === 'deferred' ? subset : undefined,
  )
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
      attachment: async (id) => readFileSync(abilities.heldFile(source.id, id).path),
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
  if (!review) registerUserTerminalTools(server, terminals, source, () => agents.get(source.id))
  if (!review) registerThemeTools(server, (theme) => agents.themeProposed(source.id, theme))
  if (!review) registerSettingsTools(server, source.id, settingsChanges)
  if (!review) registerAbilityTools(server, abilities, source)
  // Only where a script has something to call: Shared MCP tools this chat may use, on a provider without its own scripts.
  if (!review && usesRamuToolScripts(source) && hasExternalConnections(getSharedMcp(), externalSource(source)))
    registerScriptTools(server, (name, args, signal) =>
      externalTools.invokeByName(externalSource(source), name, args, signal),
    )
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
  if (!review) registerPullRequestTools(server, source.id, pullRequestWrites, agents, workspace)
  if (!review) agentThreads.register(server, source.id)
  const deployProject = workspace.getTask(source.taskId).projectId
  if (!review) {
    const pluginProject = deployProject && deployProject !== NO_PROJECT ? deployProject : null
    registerPluginCliTools(
      server,
      { clis: () => plugins.clis(pluginProject), secret: (id, slot) => plugins.secret(id, slot, pluginProject) },
      source,
      () => agents.get(source.id),
      (detail, signal) => agents.requestPermission(source.id, 'Platform CLI', detail, signal),
      (detail, signal) => agents.approveProductionDeploy(source.id, 'Platform CLI', detail, signal),
    )
    registerPluginTools(
      server,
      plugins,
      (detail, signal) => agents.requestPermission(source.id, 'Plugin', detail, signal),
      () => send('plugins:changed', null),
      draftPluginsFolder,
      (name) => {
        setToolAvailability(workspace, toolKey({ kind: 'plugin', name }), { all: true })
        send('toolSync:changed', null)
      },
    )
  }
  if (!review) registerCiTools(server, source, () => agents.get(source.id))
  if (!review && !source.parentId) registerSecretTools(server, agents, source.id)
  // Cards belong to the thread the person reads, not to a helper's own transcript.
  if (!review && !source.parentId) registerInlineUiTools(server, agents, source.id)
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
    'change_review_reply',
    {
      description:
        'Reply to a selected review discussion of Ramu’s change review (the reviewId given with the comments) after fixing or investigating it. Pull request threads use review_reply instead. Explain the change and any remaining limitations. suggestResolved only suggests closure; the human must resolve the thread. Never edit human comments.',
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
          host: z
            .string()
            .min(1)
            .max(100)
            .optional()
            .describe(
              'Run the helper on another host your agents can use (project_list with host), as a thread there. It always runs in the background; project is then required, and that host decides its model.',
            ),
          project: z.string().min(1).max(200).optional(),
        },
      },
      async ({ host, project, ...value }, extra) => {
        try {
          if (host)
            return result(
              await agentThreads.startHelperOnHost(
                source.id,
                { description: value.description, prompt: value.prompt, name: value.name, host, project },
                extra.signal,
              ),
            )
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
          "List this host's providers and their current models with the handles ramu_agent's model takes, at most eight per provider (the default first), and its abilities: which provider can make images, search the web or read very long documents, and the tool that calls each (generate_image, edit_image, web_search, read_long). Check it before planning work that needs one. query narrows models by name, handle or provider. A provider marked unavailable cannot run a helper now.",
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
          return result(
            agent.startsWith('remote:')
              ? await agentThreads.stopHelperOnHost(source.id, agent)
              : await agents.stopHelper(source.id, agent),
          )
        } catch (error) {
          return {
            isError: true,
            content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
          }
        }
      },
    )
  }
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
  // An agent browsing in a work project opens the browser profile put in Work, with its sign-ins.
  const identityProfile = identities.ownAccount(identityProject(session.taskId), accountKey('browser', 'default'))
  if (identityProfile) browserPreferences.defaultProfileId = identityProfile.slice('browser:'.length)
  sessions.set(token, {
    session,
    browser: browserPreferences,
    toolSearch:
      !summaries.isReviewChat(session.taskId) &&
      usesRamuToolSearch(
        workspace.getAppState<Partial<AppPreferences>>('app-preferences', {}).intelligence?.toolSearch ?? true,
        session,
      ),
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
/** Streams that arrived through Ramu Link, and their device, for the count Settings shows. */
const linkStreams = new Map<object, string>()
const socketHost: SocketHost = {
  accept: async (req, res) => {
    const device = await remoteAccess.accept(req, res)
    if (device && ramuLink?.routed(req.headers.host)) ramuLink.arrived(device.id)
    return device
  },
  invoke: async (device, request, req) => {
    try {
      const result = await performInvoke(true, device, request, req)
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
    const from = clientAddress(req, publicTunnel())
    if (device && req.socket.remoteAddress && !from.tunneled)
      presence.register(device.id, from.address, Number(req.headers['x-ramu-presence-port']))
    clients.add(sink)
    remoteStreams.set(sink, req.headers.authorization)
    if (device) streamDevices.set(sink, device.id)
    if (device && ramuLink?.routed(req.headers.host)) linkStreams.set(sink, device.id)
  },
  detach: (sink) => {
    clients.delete(sink)
    remoteStreams.delete(sink)
    // A device's last connection closing ends what it was allowed "this time".
    const id = streamDevices.get(sink)
    streamDevices.delete(sink)
    const linked = linkStreams.get(sink)
    linkStreams.delete(sink)
    if (linked && ![...linkStreams.values()].includes(linked)) ramuLink?.leave(linked)
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
  void linkOffline()
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
      name: cleanDiscoveryName(hostNames.display()) || discoveryName(),
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
  if (method === 'network.status') {
    // The pool is cached for minutes; asking here keeps Settings' "a slot is free" fresh without a timer.
    if (ramuLink) void ramuLink.pool(network.tunnel?.relay ?? LINK_URL)
    return networkStatus()
  }
  if (method === 'network.releaseLink') {
    await ramuLink?.release()
    if (network.tunnel?.kind === 'link') {
      network = { ...network, tunnel: null }
      writeNetworkSetting(config.networkPath, network)
      syncTunnel()
    }
    return networkStatus()
  }
  if (method === 'network.releaseOtherLink') {
    const hostId = z.string().min(1).max(100).parse(args[0])
    await ramuLink?.releaseOther(hostId)
    return networkStatus()
  }
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
    const [deviceId, permission, setting] = z
      .tuple([z.string().min(1).max(100), z.enum(DEVICE_PERMISSIONS), z.enum(PERMISSION_SETTINGS)])
      .parse(args)
    devices.setState(deviceId, permission, setting)
    permissionRequests.clear(deviceId, permission)
    send('device:permissions', {})
    return networkStatus()
  }
  if (method === 'network.decidePermission') {
    const [requestId, answer] = z.tuple([z.string().min(1).max(100), z.enum(PERMISSION_ANSWERS)]).parse(args)
    const request = permissionRequests.take(requestId)
    if (!request) throw new Error('That request was already answered or expired.')
    if (answer === 'never') devices.block(request.deviceId, request.permission)
    else if (answer !== 'deny')
      devices.setPermission(request.deviceId, request.permission, grantFor(answer, Date.now()))
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
    // Leaving Ramu Link frees its tunnel at once; the address stays reserved until released or unused.
    if (network.tunnel?.kind === 'link' && tunnel?.kind !== 'link') void linkOffline()
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
  if (method === 'network.renameDevice') {
    const deviceId = z.string().min(1).max(100).parse(args[0])
    devices.rename(deviceId, hostNameInput.parse(args[1] ?? null))
    return networkStatus()
  }
  if (method === 'network.renameHost') {
    hostNames.set(hostNameInput.parse(args[0] ?? null))
    // Devices nearby and the Ramu account learn the new name at once.
    void advertiser.refresh().catch(() => {})
    void account
      .status()
      .then((listing) => (listing.listed ? account.setListed(true, listing.trust) : undefined))
      .catch(() => {})
    return hostNames.info()
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
  void uptime.tick().catch(console.error)
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
  const platform = z.enum(['ios', 'android'])
  server.registerTool(
    'test_device_list',
    {
      description:
        'Which platforms this host can run, the models and systems a device can be opened with (each model lists the systems it pairs with), the model a thread gets when it names none, and whether this thread holds a device.',
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const status = await testDevices.status()
        const taskId = live().taskId
        return {
          ios: { ready: status.ios.ready, unsupported: status.ios.unsupported, models: status.models.ios },
          android: {
            ready: status.android.ready,
            unsupported: status.android.unsupported,
            models: status.models.android,
          },
          defaults: status.defaults,
          held: status.inUse.find((entry) => entry.taskId === taskId) ?? null,
        }
      }),
  )
  server.registerTool(
    'test_device_open',
    {
      description:
        "Give this thread a fresh test device of its own and make it the thread's computer, so computer_observe and the action tools work on it. Waits in line while the host is full. Name a model and system from test_device_list only when one matters. The first opening may ask the person.",
      inputSchema: {
        platform,
        model: z.string().min(1).max(120).optional(),
        os: z.string().min(1).max(40).optional(),
        reason: z.string().max(1000).optional(),
      },
    },
    ({ platform: chosen, model, os, reason }) =>
      guard(async () => {
        const session = live()
        const automatic = !session.parentId && workspace.getAppState<boolean>('test-devices:enabled', false) === true
        const what = model ?? (chosen === 'ios' ? 'an iPhone' : 'an Android phone')
        if (
          !automatic &&
          !(await agents.requestPermission(
            source.id,
            'Test device',
            `Allow this thread to start and control ${what} as a test device?${reason ? `\n\n${reason}` : ''}`,
          ))
        )
          throw new Error('Test device access was denied for this run. Respect that decision.')
        const opened = await testDevices.open(session.taskId, {
          platform: chosen,
          ...(model ? { model } : {}),
          ...(os ? { os } : {}),
        })
        computer.grant(
          session.taskId,
          { target: testDevices.target(session.taskId), observe: true, input: true },
          {
            id: `test-device:${session.taskId}`,
            name: opened.name,
            backend: testDevices.backend(session.taskId),
          },
        )
        computer.rememberAccessRun(session.taskId, session.id)
        return { opened: true, ...opened, next: 'Call computer_observe to see the screen and its elements.' }
      }),
  )
  server.registerTool(
    'test_device_install',
    {
      description:
        "Install a built app on this thread's test device. path is relative to the workspace: a .app bundle for iOS, an .apk for Android.",
      inputSchema: { path: z.string().min(1).max(1000) },
    },
    ({ path }) => guard(() => testDevices.install(live().taskId, workspace.agentScope(live().taskId).cwd, path)),
  )
  server.registerTool(
    'test_device_launch',
    {
      description:
        "Start an installed app on this thread's test device by bundle identifier (iOS) or package name (Android), relaunching it when it runs.",
      inputSchema: { app: z.string().min(1).max(200) },
    },
    ({ app }) => guard(() => testDevices.launch(live().taskId, app)),
  )
  server.registerTool(
    'test_device_open_link',
    {
      description: "Open a deep link or web address on this thread's test device.",
      inputSchema: { url: z.string().min(3).max(2000) },
    },
    ({ url }) => guard(() => testDevices.openUrl(live().taskId, url)),
  )
  server.registerTool(
    'test_device_logs',
    {
      description: "Read the launched app's recent log lines, filtered to that app, with known secrets removed.",
      inputSchema: { app: z.string().min(1).max(200), lines: z.number().int().min(1).max(500).optional() },
    },
    ({ app, lines }) => guard(() => testDevices.logs(live().taskId, app, lines)),
  )
  server.registerTool(
    'test_device_rotate',
    {
      description: "Turn this thread's iOS Simulator. An Android emulator does not turn.",
      inputSchema: { orientation: z.enum(TEST_DEVICE_ORIENTATIONS) },
    },
    ({ orientation }) => guard(() => testDevices.rotate(live().taskId, orientation)),
  )
  server.registerTool(
    'test_device_stop',
    {
      description: "Give this thread's test device back. It is deleted, and the next one is fresh.",
      inputSchema: {},
    },
    () =>
      guard(async () => {
        const session = live()
        await testDevices.releaseThread(session.taskId)
        computer.revoke(session.taskId)
        return { stopped: true }
      }),
  )
}
