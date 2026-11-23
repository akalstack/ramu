// This host's plugins, skills and Shared MCP servers as setup another host can install, what other hosts sent here, and
// which hosts each tool is kept on. Nothing here installs: a tool another host sent waits for the same review an
// install from Customize has, on this host.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { remoteKey } from '@ramu/shared/continuation'
import type { SharedMcpManagement, SharedMcpToolChoice } from '@ramu/shared/mcp'
import type { InstalledPlugin } from '@ramu/shared/plugins'
import {
  connectionAddress,
  keptOn,
  rehosted,
  removedToolsSchema,
  toolKey,
  toolState,
  waitingToolsSchema,
  type PortableTool,
  type SkippedTool,
  type ToolAvailability,
  type ToolHost,
  type ToolKind,
  type ToolOffer,
  type ToolSyncStatus,
  type ToolsHere,
  type WaitingTool,
} from '@ramu/shared/toolSync'
import type { AgentEvent, ManagedSkill } from '@ramu/shared/types'
import { skillExportName } from './memory/skillFiles'
import { findExecutable } from './providers/providerBinaries'
import type { Workspace } from './workspace/workspace'
import { hostDisplayName } from './remote/hostName'

const WAITING_KEY = 'tool-sync-waiting'
const AVAILABILITY_KEY = 'tool-sync-availability'
const HOST_KEY = 'tool-sync-host'
const DISMISSED_KEY = 'tool-sync-dismissed'
const CHOICES_KEY = 'tool-sync-choices'
const REMOVED_KEY = 'tool-sync-removed'
/** A tool sent here and never reviewed is dropped after this long, so the list stays about what people still want. */
const WAITING_MS = 30 * 24 * 60 * 60_000

export interface ToolSources {
  workspace: Workspace
  plugins?: { list(): InstalledPlugin[] }
  getSharedMcp?: () => { list(): SharedMcpManagement }
  learning?: { skills(): ManagedSkill[] }
  identities?: { settings(): { identities: { id: string }[] } }
}

/** A login's grant as the three choices Customize shows: run without asking, ask each time, or (absent) off. */
const choicesOf = (entry: SharedMcpManagement['connections'][number] | undefined) =>
  Object.fromEntries(
    (entry?.granted?.[0]?.tools ?? []).map((tool) => [
      tool.name,
      (tool.approval === 'connection' ? 'allow' : 'ask') as SharedMcpToolChoice,
    ]),
  )

/** Skills people installed or wrote; learned ones stay with the host that learned them, and a plugin's go with it. */
const sharedSkill = (skill: ManagedSkill) =>
  skill.status === 'active' &&
  (skill.installation
    ? !skill.installation.source.startsWith('plugin:')
    : skill.changedBy === 'user' && !skill.sourceSessionId)

/** A folder under the home folder as `~/…`, or null for any other folder. */
const homeRelative = (folder: string) => {
  const home = process.env.HOME
  if (!home) return null
  if (folder === home) return '~'
  return folder.startsWith(`${home}/`) ? `~/${folder.slice(home.length + 1)}` : null
}

const REMOTES_MS = 60_000
const remoteCache = new Map<string, { at: number; keys: string[] }>()

/** A repository's remotes by `remoteKey`, read from Git and kept for a minute; never with a token in the address. */
function remotesOf(root: string) {
  const cached = remoteCache.get(root)
  if (cached && cached.at > Date.now() - REMOTES_MS) return cached.keys
  let keys: string[] = []
  try {
    keys = execFileSync('git', ['-C', root, 'config', '--get-regexp', '^remote\\..*\\.url$'], {
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line) => line.split(' ').slice(1).join(' ').trim())
      .filter(Boolean)
      .map((url) => remoteKey(url.replace(/\/\/[^/@\s]+@/, '//')))
  } catch {
    // Not a repository, or no remote: the project's tools stay on this host.
  }
  remoteCache.set(root, { at: Date.now(), keys })
  return keys
}

/** Each project with a single repository and the remotes it has, the way Continue on another host matches projects. */
function projectRemotes(workspace: Workspace) {
  return workspace.listProjects().flatMap((project) => {
    const repositories = workspace.listRepositories(project.id)
    const keys = repositories.length === 1 ? remotesOf(repositories[0]!.root) : []
    return keys.length ? [{ id: project.id, name: project.name, root: project.root, keys }] : []
  })
}

/** The project a tool of one project here follows to other hosts: its first remote, or null when it has none. */
function projectRef(workspace: Workspace, projectId: string) {
  const found = projectRemotes(workspace).find((project) => project.id === projectId)
  return found ? { remote: found.keys[0]!, name: found.name } : null
}

/** This host's project on a remote. */
const projectOn = (workspace: Workspace, remote: string) =>
  projectRemotes(workspace).find((project) => project.keys.includes(remote)) ?? null

const localSource = (source: string) => isAbsolute(source) || source.startsWith('.') || source.startsWith('~')

/** Every tool on this host that can travel, and the ones that stay with why. */
export function portableTools(sources: ToolSources, kinds: readonly ToolKind[] = ['plugin', 'skill', 'mcp']) {
  const tools: PortableTool[] = []
  const skipped: SkippedTool[] = []
  const mcp = sources.getSharedMcp?.().list().connections ?? []
  const plugins = sources.plugins?.list() ?? []
  const fromPlugins = new Set(plugins.flatMap((plugin) => plugin.mcpConnections.map((server) => server.id)))
  if (kinds.includes('plugin'))
    for (const plugin of plugins) {
      const project = plugin.scope.kind === 'project' ? projectRef(sources.workspace, plugin.scope.projectId) : null
      if (plugin.source.kind !== 'git') skipped.push({ kind: 'plugin', name: plugin.name, reason: 'folder' })
      else if (plugin.scope.kind === 'project' && !project)
        skipped.push({ kind: 'plugin', name: plugin.name, reason: 'project' })
      else
        tools.push({
          ...(project ? { project } : {}),
          kind: 'plugin',
          name: plugin.name,
          index: plugin.source.index,
          location: plugin.source.location,
          path: plugin.source.path,
          commit: plugin.source.commit,
          identityId: plugin.scope.kind === 'identity' ? plugin.scope.identityId : null,
          servers: Object.fromEntries(
            plugin.mcpConnections
              .map(
                (server) => [server.name, choicesOf(mcp.find((entry) => entry.connection.id === server.id))] as const,
              )
              .filter(([, choices]) => Object.keys(choices).length),
          ),
        })
    }
  if (kinds.includes('skill')) {
    const skills = (sources.learning?.skills() ?? []).filter(sharedSkill)
    const everyProject = new Set(skills.filter((skill) => !skill.projectId).map((skill) => skill.name))
    for (const skill of skills) {
      // A project's skill named like one every project has would be the same tool on another host; it stays here.
      const project =
        skill.projectId && !everyProject.has(skill.name) ? projectRef(sources.workspace, skill.projectId) : null
      if (skill.projectId && !project) skipped.push({ kind: 'skill', name: skill.name, reason: 'project' })
      else if (skill.installation && localSource(skill.installation.source))
        skipped.push({ kind: 'skill', name: skill.name, reason: 'folder' })
      else
        tools.push({
          ...(project ? { project } : {}),
          kind: 'skill',
          name: skill.name,
          description: skill.description,
          source: skill.installation?.source ?? null,
          content: skill.installation ? null : skill.content,
        })
    }
  }
  if (kinds.includes('mcp')) {
    const shared = mcp.filter((entry) => !entry.connection.split && !fromPlugins.has(entry.connection.id))
    const hostWide = new Set(
      shared.filter((entry) => entry.connection.scope.hostWide).map((entry) => entry.connection.name),
    )
    for (const entry of shared) {
      const { connection } = entry
      const projectIds = connection.scope.projectIds
      const project =
        !connection.scope.hostWide && projectIds.length === 1 && !hostWide.has(connection.name)
          ? projectRef(sources.workspace, projectIds[0]!)
          : null
      if (!connection.scope.hostWide && !project) {
        skipped.push({ kind: 'mcp', name: connection.name, reason: 'project' })
        continue
      }
      const { transport } = connection
      // A server started from a file or folder of this host only runs here; one under the home folder runs in the same
      // folder of the other host's home, and a project's runs in that project's folder there.
      const folder = transport.type === 'stdio' ? (project ? '~' : homeRelative(transport.cwd)) : null
      if (transport.type === 'stdio' && (localSource(transport.command) || folder === null)) {
        skipped.push({ kind: 'mcp', name: connection.name, reason: 'folder' })
        continue
      }
      tools.push({
        ...(project ? { project } : {}),
        kind: 'mcp',
        name: connection.name,
        transport:
          transport.type === 'http'
            ? {
                type: 'http',
                url: transport.url,
                headers: Object.keys(transport.headerSecretRefs),
                ...(transport.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
              }
            : {
                type: 'stdio',
                command: transport.command,
                args: transport.args,
                cwd: folder ?? '~',
                env: Object.keys(transport.envSecretRefs),
              },
        providers: connection.providers,
        tools: choicesOf(entry),
      })
    }
  }
  return { tools, skipped }
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The plugins and skills a thread's own tool calls show it used: a skill read from or named by its provider copy, and a
 * plugin's command line run in a shell, or one of its skills. Inputs are read here and never kept.
 */
export function toolsUsedIn(
  events: AgentEvent[],
  plugins: Pick<InstalledPlugin, 'id' | 'name' | 'contents'>[],
  skills: Pick<ManagedSkill, 'name' | 'installation'>[],
) {
  const calls = events.flatMap((event) =>
    event.kind === 'tool-use' && event.input ? [{ input: event.input, shell: event.toolKind === 'execute' }] : [],
  )
  const usedSkills = skills.filter((skill) => {
    const named = new RegExp(`(?:^|[^\\w-])${escaped(skillExportName(skill.name))}(?![\\w-])`)
    return calls.some((call) => named.test(call.input))
  })
  const usedPlugins = new Set(
    usedSkills.flatMap((skill) => {
      const source = skill.installation?.source
      const owner = source?.startsWith('plugin:') ? source.slice('plugin:'.length) : null
      return plugins.filter((plugin) => plugin.name === owner || plugin.id === owner).map((plugin) => plugin.name)
    }),
  )
  for (const plugin of plugins)
    for (const binary of plugin.contents.cli?.binaries ?? []) {
      const run = new RegExp(`(?:^|[\\s;&|(\`"'])${escaped(binary)}(?=$|[\\s;&|)"'])`)
      if (calls.some((call) => call.shell && run.test(call.input))) usedPlugins.add(plugin.name)
    }
  return {
    plugins: usedPlugins,
    skills: new Set(
      usedSkills.filter((skill) => !skill.installation?.source.startsWith('plugin:')).map((skill) => skill.name),
    ),
  }
}

const hasCommand = (command: string) => (isAbsolute(command) ? existsSync(command) : !!findExecutable(command))

/** This host's tools by what they mean on any host, to compare another host's tools with. */
export function toolsHere(sources: ToolSources): ToolsHere {
  return {
    plugins: (sources.plugins?.list() ?? []).map((plugin) => ({ name: plugin.name, commit: plugin.source.commit })),
    skills: (sources.learning?.skills() ?? [])
      .filter((skill) => skill.status !== 'archived')
      .map((skill) => ({
        name: skill.name,
        source: skill.installation?.source ?? null,
        content: skill.content,
        projectId: skill.projectId ?? null,
      })),
    projectFor: (remote) => projectOn(sources.workspace, remote)?.id ?? null,
    mcp: (sources.getSharedMcp?.().list().connections ?? [])
      .filter((entry) => !entry.connection.split)
      .map((entry) => ({ name: entry.connection.name, address: connectionAddress(entry.connection.transport) })),
    hasCommand,
  }
}

type Stored = Omit<WaitingTool, 'state'>

/** What a dismissal remembers: this version of the tool, and whether it was an install or a removal. */
const fingerprint = (tool: PortableTool, remove: boolean) => `${remove ? 'remove:' : ''}${JSON.stringify(tool)}`

const removed = (workspace: Workspace) => {
  const parsed = removedToolsSchema.safeParse(workspace.getAppState<unknown>(REMOVED_KEY, []))
  return parsed.success ? parsed.data.filter((entry) => entry.at > Date.now() - WAITING_MS) : []
}

/**
 * Remembers a tool about to be removed here so this host's other hosts are asked to remove it too, including ones that
 * connect later; it no longer travels to them as one to install.
 */
export function removeEverywhere(sources: ToolSources, key: string) {
  const tool = portableTools(sources).tools.find((entry) => toolKey(entry) === key)
  if (!tool) return false
  const kept = removed(sources.workspace).filter((entry) => toolKey(entry.tool) !== key)
  sources.workspace.setAppState(REMOVED_KEY, [{ tool, at: Date.now() }, ...kept].slice(0, 300))
  setToolAvailability(sources.workspace, key, null)
  return true
}

function stored(workspace: Workspace): Stored[] {
  const parsed = waitingToolsSchema.safeParse(workspace.getAppState<unknown>(WAITING_KEY, []))
  return parsed.success ? parsed.data.filter((entry) => entry.receivedAt > Date.now() - WAITING_MS) : []
}

/** Tools other hosts sent, newest first, each compared with this host; one this host already has is dropped. */
export function waitingTools(sources: ToolSources): WaitingTool[] {
  const here = toolsHere(sources)
  const entries = stored(sources.workspace)
  const waiting = entries.flatMap((entry): WaitingTool[] => {
    // A project's tool waits only while its project is here, and installs for it.
    const projectId = entry.tool.project ? here.projectFor(entry.tool.project.remote) : null
    if (entry.tool.project && !projectId) return []
    const state = toolState(entry.tool, here)
    const placed = projectId ? { ...entry, projectId } : entry
    // A removal asks only while the tool is here; an install waits only while it is not.
    if (entry.remove) return state === 'new' || state === 'connect-here' ? [] : [{ ...placed, state: 'remove' }]
    return state === 'same' ? [] : [{ ...placed, state }]
  })
  if (waiting.length !== entries.length)
    sources.workspace.setAppState(
      WAITING_KEY,
      entries.filter((entry) => waiting.some((kept) => kept.key === entry.key)),
    )
  return waiting.sort((a, b) => b.receivedAt - a.receivedAt)
}

/**
 * Keeps tools another host sent for review here. A tool this host already has the same is not kept; one sent again
 * replaces the earlier copy. Returns how many now wait.
 */
export function receiveTools(sources: ToolSources, tools: PortableTool[], from: string, remove = false): number {
  const here = toolsHere(sources)
  const now = Date.now()
  const dismissed = new Set(sources.workspace.getAppState<string[]>(DISMISSED_KEY, []))
  const wanted = (tool: PortableTool) => {
    if (tool.project && !here.projectFor(tool.project.remote)) return false
    const state = toolState(tool, here)
    return remove ? state !== 'new' && state !== 'connect-here' : state !== 'same'
  }
  const kept = stored(sources.workspace)
  // The same tool sent again while it waits is not news: it keeps its place, and nobody is told twice.
  const waitingAlready = new Set(kept.map((entry) => fingerprint(entry.tool, !!entry.remove)))
  const incoming = tools
    .filter(
      (tool) =>
        wanted(tool) && !dismissed.has(fingerprint(tool, remove)) && !waitingAlready.has(fingerprint(tool, remove)),
    )
    .map((tool) => ({
      key: toolKey(tool),
      tool,
      from: from.slice(0, 200),
      receivedAt: now,
      ...(remove ? { remove: true } : {}),
    }))
  if (!incoming.length) return 0
  const others = kept.filter((entry) => !incoming.some((next) => next.key === entry.key))
  sources.workspace.setAppState(WAITING_KEY, [...incoming, ...others].slice(0, 300))
  return incoming.length
}

/** Drops a tool from the list; the same version sent again stays dropped, and a newer one comes back. */
export function dismissTool(workspace: Workspace, key: string) {
  const entries = stored(workspace)
  const dropped = entries.find((entry) => entry.key === key)
  workspace.setAppState(
    WAITING_KEY,
    entries.filter((entry) => entry.key !== key),
  )
  if (dropped)
    workspace.setAppState(
      DISMISSED_KEY,
      [fingerprint(dropped.tool, !!dropped.remove), ...workspace.getAppState<string[]>(DISMISSED_KEY, [])].slice(
        0,
        300,
      ),
    )
}

/**
 * The tools a received server had on at its other host, kept until it is turned on here: one that needs a secret first
 * is turned on later, from Customize or `ramu tools`, with the same choices.
 */
export function rememberChoices(
  workspace: Workspace,
  connectionId: string,
  choices: Record<string, SharedMcpToolChoice>,
) {
  const saved = workspace.getAppState<Record<string, Record<string, SharedMcpToolChoice>>>(CHOICES_KEY, {})
  workspace.setAppState(CHOICES_KEY, { ...saved, [connectionId]: choices })
}

export function takeChoices(workspace: Workspace, connectionId: string) {
  const { [connectionId]: choices, ...rest } = workspace.getAppState<
    Record<string, Record<string, SharedMcpToolChoice>>
  >(CHOICES_KEY, {})
  if (choices) workspace.setAppState(CHOICES_KEY, rest)
  return choices ?? null
}

export const pendingChoices = (workspace: Workspace, connectionId: string) =>
  workspace.getAppState<Record<string, Record<string, SharedMcpToolChoice>>>(CHOICES_KEY, {})[connectionId] ?? null

export const toolAvailability = (workspace: Workspace) =>
  workspace.getAppState<Record<string, ToolAvailability>>(AVAILABILITY_KEY, {})

/** Which hosts a tool is kept on; null keeps it on this host only. */
export function setToolAvailability(workspace: Workspace, key: string, availability: ToolAvailability | null) {
  const { [key]: _previous, ...rest } = toolAvailability(workspace)
  workspace.setAppState(AVAILABILITY_KEY, availability ? { ...rest, [key]: availability } : rest)
}

/** This host's id in tool choices: the same from every device, unlike the id a device gives a host it connects to. */
function syncHostId(workspace: Workspace) {
  const saved = workspace.getAppState<string | null>(HOST_KEY, null)
  if (saved) return saved
  const created = randomUUID()
  workspace.setAppState(HOST_KEY, created)
  return created
}

/** This host as tool delivery sees it. */
export const toolHost = (sources: ToolSources): ToolHost => ({
  hostId: syncHostId(sources.workspace),
  hostName: hostDisplayName(),
  identities: (sources.identities?.settings().identities ?? []).map((identity) => identity.id),
  remotes: [...new Set(projectRemotes(sources.workspace).flatMap((project) => project.keys))],
})

/** What this host offers a host it has added for agents: the tools it keeps on other hosts, and the ones it removed. */
export function toolOffer(sources: ToolSources): ToolOffer | null {
  const status = toolSyncStatus(sources)
  const tools = Object.entries(status.availability).flatMap(([key, availability]) =>
    status.portable[key] ? [{ tool: status.portable[key], availability }] : [],
  )
  const removedTools = Object.values(status.removed)
  return tools.length || removedTools.length ? { from: status.hostName, tools, removed: removedTools } : null
}

/**
 * Takes what another host offers: the tools meant for this host wait for a review here, and the removals ask here
 * only for tools this host has. Nothing is installed or removed.
 */
export function acceptOffer(sources: ToolSources, offer: ToolOffer) {
  const host = toolHost(sources)
  const meant = offer.tools.filter((entry) => keptOn(entry.tool, entry.availability, host)).map((entry) => entry.tool)
  const received =
    (meant.length ? receiveTools(sources, meant, offer.from) : 0) +
    (offer.removed.length ? receiveTools(sources, offer.removed, offer.from, true) : 0)
  // The other host learns this host's name and id, to keep choosing it; not its identities or projects.
  return { hostId: host.hostId, hostName: host.hostName, received }
}

/** After a chosen host answered under a new id (it was wiped), the tools chosen for it are kept on it under that id. */
export function recogniseHost(workspace: Workspace, host: Pick<ToolHost, 'hostId' | 'hostName'>) {
  let changed = false
  for (const [key, availability] of Object.entries(toolAvailability(workspace))) {
    const next = rehosted(availability, host)
    if (next) {
      setToolAvailability(workspace, key, next)
      changed = true
    }
  }
  return changed
}

export function toolSyncStatus(sources: ToolSources): ToolSyncStatus {
  const { tools, skipped } = portableTools(sources)
  const portable = Object.fromEntries(tools.map((tool) => [toolKey(tool), tool]))
  // A choice for a tool removed since is dropped, so a later install of the same name starts on this host only.
  const availability = Object.fromEntries(
    Object.entries(toolAvailability(sources.workspace)).filter(([key]) => key in portable),
  )
  const host = toolHost(sources)
  return {
    hostId: host.hostId,
    hostName: host.hostName,
    identities: host.identities,
    remotes: host.remotes,
    waiting: waitingTools(sources),
    availability,
    portable,
    skipped,
    removed: Object.fromEntries(
      removed(sources.workspace)
        .filter((entry) => !(toolKey(entry.tool) in portable))
        .map((entry) => [toolKey(entry.tool), entry.tool]),
    ),
    asThere: sources.workspace.getAppState<ToolSyncStatus['asThere']>(CHOICES_KEY, {}),
  }
}
