// The same tools on several hosts: a plugin, a skill or a Shared MCP server travels as its setup (where it comes from,
// which tools are on and which ask) and each host installs it from there after its own review. Keys, sign-ins, OAuth
// clients, local paths and workspace state never travel.
import { z } from 'zod'
import { AGENT_PROVIDERS, providerAccountRows, providerEnabled } from './providers/providers'
import type { AgentProvider, AppPreferences } from './types'

export const TOOL_KINDS = ['plugin', 'skill', 'mcp'] as const
export type ToolKind = (typeof TOOL_KINDS)[number]

const name = z.string().min(1).max(200)
const toolChoice = z.enum(['ask', 'allow', 'off'])
/** Tool choices by tool name: what the source host turned on, and whether each asks before it runs. */
const toolChoices = z.record(z.string().max(200), toolChoice).refine((value) => Object.keys(value).length <= 500)
const providers = z.array(z.enum(AGENT_PROVIDERS)).max(AGENT_PROVIDERS.length)

const portablePlugin = z.object({
  kind: z.literal('plugin'),
  name,
  /** The index it was installed from; null when it came straight from a Git address. */
  index: z.string().max(2000).nullable(),
  /** The Git address, for a plugin installed from one or to find it when the index is not on the receiving host. */
  location: z.string().max(2000),
  path: z.string().max(500),
  commit: z
    .string()
    .regex(/^[0-9a-f]{7,64}$/)
    .nullable(),
  /** An identity's plugin reaches only that identity's projects; null is every project. */
  identityId: z.string().max(100).nullable(),
  /** Tool choices for each of its MCP servers, by the server's name in the plugin. */
  servers: z.record(z.string().max(200), toolChoices).refine((value) => Object.keys(value).length <= 20),
})

const portableSkill = z.object({
  kind: z.literal('skill'),
  name: z.string().min(1).max(64),
  description: z.string().max(4000),
  /** Where an installed skill comes from (a skills.sh name, repository or address); null for one written by hand. */
  source: z.string().max(2000).nullable(),
  /** A written skill's instructions; an installed one is fetched from its source again. */
  content: z.string().max(24_000).nullable(),
})

const portableMcp = z.object({
  kind: z.literal('mcp'),
  name,
  transport: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('http'),
      url: z
        .string()
        .regex(/^https?:\/\//i)
        .max(2000),
      /** Header names the server needs a secret for; their values stay on the host they were entered on. */
      headers: z.array(z.string().max(128)).max(20),
      allowPrivateNetwork: z.boolean().optional(),
    }),
    z.object({
      type: z.literal('stdio'),
      command: z.string().min(1).max(500),
      args: z.array(z.string().max(2000)).max(50),
      /** The working folder under the home folder, as `~` or `~/…`; it resolves in the receiving host's home. */
      cwd: z
        .string()
        .regex(/^~(?:\/[^\0]*)?$/)
        .max(1000)
        .refine((folder) => !folder.split('/').includes('..'), 'Choose a folder inside the home folder'),
      /** Environment variable names the server needs a secret for. */
      env: z.array(z.string().max(128)).max(20),
    }),
  ]),
  providers,
  tools: toolChoices,
})

export const portableToolSchema = z.discriminatedUnion('kind', [portablePlugin, portableSkill, portableMcp])
export type PortableTool = z.infer<typeof portableToolSchema>
export type PortablePlugin = z.infer<typeof portablePlugin>
export type PortableSkill = z.infer<typeof portableSkill>
export type PortableMcpServer = z.infer<typeof portableMcp>

/** A tool that stays on its host, with why, so a review can say so instead of leaving it out silently. */
export const skippedToolSchema = z.object({
  kind: z.enum(TOOL_KINDS),
  name,
  reason: z.enum(['folder', 'project']),
})
export type SkippedTool = z.infer<typeof skippedToolSchema>

export const toolKey = (tool: Pick<PortableTool, 'kind' | 'name'>) => `${tool.kind}:${tool.name}`

/** Which hosts a tool is kept on, by the host it was installed on: this host only, chosen hosts, or every host. */
export const toolAvailabilitySchema = z.union([
  z.object({ all: z.literal(true) }),
  z.object({ hosts: z.array(z.string().min(1).max(200)).max(50) }),
])
export type ToolAvailability = z.infer<typeof toolAvailabilitySchema>

/**
 * How a tool from another host compares with this host: not here, here at another commit or source, the same, or here
 * only once something on this host is fixed (a server command this host does not have).
 */
export type ToolState = 'new' | 'update' | 'same' | 'connect-here'

/** What a host has, by what it means on any host, to compare a tool from another host with. */
export interface ToolsHere {
  plugins: { name: string; commit: string | null }[]
  skills: { name: string; source: string | null; content: string }[]
  mcp: { name: string; address: string }[]
  /** Whether a server's command can run here: on the PATH, or an existing absolute path. */
  hasCommand: (command: string) => boolean
}

export function toolState(tool: PortableTool, here: ToolsHere): ToolState {
  if (tool.kind === 'plugin') {
    const installed = here.plugins.find((plugin) => plugin.name === tool.name)
    if (!installed) return 'new'
    return tool.commit && installed.commit !== tool.commit ? 'update' : 'same'
  }
  if (tool.kind === 'skill') {
    const installed = here.skills.find((skill) => skill.name === tool.name)
    if (!installed) return 'new'
    if (tool.source !== null) return installed.source === tool.source ? 'same' : 'update'
    return installed.content.trim() === (tool.content ?? '').trim() ? 'same' : 'update'
  }
  const address = connectionAddress(tool.transport)
  if (here.mcp.some((server) => server.address === address)) return 'same'
  if (tool.transport.type === 'stdio' && !here.hasCommand(tool.transport.command)) return 'connect-here'
  return here.mcp.some((server) => server.name === tool.name) ? 'update' : 'new'
}

/** A server's address as Shared MCP compares it, for a connection already on this host. */
export const connectionAddress = (
  transport: { type: 'http'; url: string } | { type: 'stdio'; command: string; args: string[] },
) =>
  transport.type === 'http'
    ? transport.url.split('?')[0]!.replace(/\/$/, '')
    : [transport.command, ...transport.args].join(' ')

/** A tool another host sent here, waiting for someone to review it on this host. */
export interface WaitingTool {
  key: string
  tool: PortableTool
  /** The host it came from, by name. */
  from: string
  receivedAt: number
  /** `remove`: its other host removed it and asks this one to remove it too. */
  state: Exclude<ToolState, 'same'> | 'remove'
  remove?: boolean
}

export const waitingToolsSchema = z
  .array(
    z.object({
      key: z.string().max(400),
      tool: portableToolSchema,
      from: z.string().max(200),
      receivedAt: z.number().int(),
      remove: z.boolean().optional(),
    }),
  )
  .max(300)

/** Tools this host removed and asked its other hosts to remove too, kept while those hosts catch up. */
export const removedToolsSchema = z.array(z.object({ tool: portableToolSchema, at: z.number().int() })).max(300)

export interface ToolSyncStatus {
  /** This host's id in tool choices, the same whichever device asks. */
  hostId: string
  hostName: string
  /** Tools other hosts sent, waiting for a review here; ones this host already has the same are left out. */
  waiting: WaitingTool[]
  /** The hosts each of this host's tools is kept on, by `toolKey`; absent is this host only. */
  availability: Record<string, ToolAvailability>
  /** Every tool on this host that can travel, by `toolKey`, for sending to another host. */
  portable: Record<string, PortableTool>
  /** Tools removed here that other hosts are asked to remove too, by `toolKey`. */
  removed: Record<string, PortableTool>
  /** Tool choices of servers copied from another host and not turned on here yet, by connection id. */
  asThere: Record<string, Record<string, 'ask' | 'allow' | 'off'>>
  /** This host's tools that stay here, with why. */
  skipped: SkippedTool[]
}

/** Whether a tool kept on these hosts should be on `hostId`. */
export const availableOn = (availability: ToolAvailability | undefined, hostId: string) =>
  !!availability && ('all' in availability || availability.hosts.includes(hostId))

/** Every signed-in login of each agent a server is offered to: who a server is turned on for in one step. */
export const mcpLogins = (
  preferences: Pick<AppPreferences, 'providerBinaries'>,
  connection: { providers: AgentProvider[] },
) =>
  connection.providers
    .filter((provider) => providerEnabled(preferences.providerBinaries, provider))
    .flatMap((provider) =>
      providerAccountRows(preferences.providerBinaries, provider).map((accountId) => ({ provider, accountId })),
    )
