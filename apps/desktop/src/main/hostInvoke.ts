import type { ComputerStatus } from '@ramu/shared/types'
import { isHostTaskCommand } from '@ramu/shared/hostOverview'

/**
 * Routing for calls that name their host (`invokeOn`, `computers.invoke`, `computers.tasks.invoke`).
 * A call that names no host, or this window's own host, keeps the old path through the main handler. Any other host
 * is reached directly, and only for methods that run purely on that host's server. Everything that touches this
 * machine (dialogs, menus, clipboard, the background service, app updates, pairing) stays out.
 */
const DOMAINS = new Set([
  'device',
  'hostBrowser',
  'interactive',
  'artifacts',
  'tasks',
  'projects',
  'agent',
  'aside',
  'summaries',
  'recaps',
  'schedules',
  'files',
  'git',
  'forge',
  'computer',
  'reviews',
  'skills',
  'plugins',
  'identities',
  'settingsTransfer',
  'memory',
  'learning',
  'notices',
  'notifications',
  'usage',
  'folders',
  'repos',
  'workspaces',
  'ui',
  'liveActivity',
  'activity',
  'term',
  'attachments',
  'advisor',
  'threads',
  'deploy',
  'ci',
  'abilities',
])
/** Methods inside an allowed domain that still open a native dialog or menu on this machine. */
const NATIVE = new Set([
  'repos.pick',
  'files.reveal',
  'term.menu',
  'attachments.pick',
  'attachments.menu',
  'attachments.save',
  'attachments.copy',
  'attachments.reveal',
])

export const isHostInvokeAllowed = (method: unknown): method is string =>
  typeof method === 'string' &&
  !NATIVE.has(method) &&
  ([
    // Read-only; tells this device its own role on that host.
    'background.status',
    'providers.status',
    // Keeping that host current: its own Ramu release and its provider CLIs.
    'updates.status',
    'updates.check',
    'updates.apply',
    'providers.updates',
    'providers.update',
    'mcp.status',
    'settings.app.get',
    'settings.app.set',
    'settings.models.get',
    'settings.models.set',
  ].includes(method) ||
    (DOMAINS.has(method.split('.')[0]!) && method.includes('.')))

/** Operations the Settings window may run on a chosen host through `computers.settings.invoke`. */
export const isSettingsActionAllowed = (operation: unknown): operation is string =>
  typeof operation === 'string' &&
  /^(mcp\.|providers\.|updates\.|background\.|network\.|memory\.|learning\.|skills\.|plugins\.|identities\.|settingsTransfer\.|rules\.|summaries\.|settings\.permissions\.(clear|list|remove)$|codex\.hook\.|advisor\.claude$|projects\.(list|setup)$|forge\.(connections|gitlab|saveGitlab|removeGitlab|bitbucket|saveBitbucket|removeBitbucket|azure|saveAzure|removeAzure|saveConnection|checkConnection|setConnectionEnabled|removeConnection|selectAccount)$|computer\.(status|setEnabled|setGlobalPointer|installApps|lockedUse|lockedUseEnable|lockedUseDisable)$|deploy\.(accounts|signIn|signInStatus|signInMatch|cancelSignIn|saveToken|disconnect)$|abilities\.(check|checks|mcpTools)$|diagnostics\.(export|clear)$)/.test(
    operation,
  )

export interface HostRouting {
  /** The window that sent the call. */
  self: string
  exists(id: string): boolean
  status(id: string): ComputerStatus
  /** Localisation for user-facing failures. */
  text?: (message: string) => string
}

export interface HostRoute {
  host: string
  /** True when the call must run on another host's server instead of through the window's own handler. */
  direct: boolean
}

/** Decides where a call runs. Throws for an invalid, unknown, offline or paused host, or a method that may not leave its window. */
export function routeInvoke(requested: unknown, method: string, routing: HostRouting): HostRoute {
  const say = routing.text ?? ((message: string) => message)
  if (requested === undefined || requested === null) return { host: routing.self, direct: false }
  if (typeof requested !== 'string' || !requested) throw new Error('Invalid host')
  if (requested === routing.self) return { host: requested, direct: false }
  if (!routing.exists(requested)) throw new Error(say('That host is no longer saved'))
  const status = routing.status(requested)
  if (status === 'rejected')
    throw new Error(say('That host no longer accepts this device. Forget it, then pair again.'))
  if (status === 'paused') throw new Error(say('This connection is paused. Resume it in Remote access.'))
  if (status !== 'connected') throw new Error(say('That host is not reachable right now.'))
  if (!isHostInvokeAllowed(method)) throw new Error(say('That action is not available on another host'))
  return { host: requested, direct: true }
}

/** `computers.tasks.invoke` keeps its narrow shape and checks, then runs through the same route. */
export function routeTaskCommand(
  host: unknown,
  method: unknown,
  args: unknown,
  routing: HostRouting,
): { host: string; method: string; args: unknown[] } {
  if (typeof host !== 'string') throw new Error('That host is not connected')
  if (!isHostTaskCommand(method, args)) throw new Error('Invalid host thread action')
  const route = routeInvoke(host, method, { ...routing, self: '' })
  return { host: route.host, method, args: args as unknown[] }
}

/** Which push channel a finished call on a host should signal, so overviews refresh. */
export function activityChannel(method: string): 'workspace:changed' | 'automation:changed' | null {
  const domain = method.split('.')[0]
  if (domain === 'tasks' || domain === 'projects') return 'workspace:changed'
  if (domain === 'recaps' || domain === 'schedules') return 'automation:changed'
  return null
}
