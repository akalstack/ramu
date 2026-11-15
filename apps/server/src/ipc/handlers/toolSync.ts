import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import {
  portableToolSchema,
  toolAvailabilitySchema,
  toolKey,
  toolState,
  type PortableTool,
  type ToolAvailability,
} from '@ramu/shared/toolSync'
import {
  dismissTool,
  portableTools,
  receiveTools,
  setToolAvailability,
  toolSyncStatus,
  toolsHere,
  waitingTools,
} from '../../toolSync'
import type { RegisterHandlers } from '../types'

const key = z.string().min(1).max(400)
const tools = z.array(portableToolSchema).min(1).max(300)

/**
 * The same tools on several hosts. Another host's tools only wait here; installing one is the same review Customize
 * runs, on this host. Sending needs the settings permission, as any settings change from a paired device does.
 */
export const registerToolSyncHandlers: RegisterHandlers = (ctx) => {
  const changed = () => ctx.host.send('toolSync:changed', null)
  return {
    'toolSync.status': { args: z.tuple([]), run: () => toolSyncStatus(ctx) },
    'toolSync.receive': {
      args: z.tuple([tools, z.string().min(1).max(200)]),
      run: (incoming: PortableTool[], from: string) => {
        const waiting = receiveTools(ctx, incoming, from)
        if (waiting) changed()
        return { waiting }
      },
    },
    'toolSync.dismiss': {
      args: z.tuple([key]),
      run: (dismissed: string) => {
        dismissTool(ctx.workspace, dismissed)
        changed()
      },
    },
    'toolSync.setAvailability': {
      args: z.tuple([key, toolAvailabilitySchema.nullable()]),
      run: (chosen: string, availability: ToolAvailability | null) => {
        setToolAvailability(ctx.workspace, chosen, availability)
        changed()
      },
    },
    /**
     * Adds a server another host sent, as it is there but with no secret: a header or variable it needs is entered
     * here next. A command this host does not have leaves it off until someone fixes it.
     */
    'toolSync.addServer': {
      args: z.tuple([key]),
      run: (chosen: string) => {
        if (ctx.host.canAdministerIntegrations?.() !== true)
          throw new Error('Add MCP servers on the computer running Ramu')
        if (!ctx.getSharedMcp) throw new Error('Update this host for Shared MCP management')
        const entry = waitingTools(ctx).find((waiting) => waiting.key === chosen)
        if (!entry || entry.tool.kind !== 'mcp') throw new Error('That server is no longer waiting here.')
        const { tool } = entry
        const transport = tool.transport
        const saved = ctx.getSharedMcp().save({
          name: tool.name,
          serviceAccountId: 'public',
          enabled: entry.state !== 'connect-here',
          scope: { hostWide: true, projectIds: [] },
          providers: tool.providers,
          transport:
            transport.type === 'http'
              ? {
                  type: 'http',
                  url: transport.url,
                  headerSecretRefs: {},
                  ...(transport.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
                }
              : {
                  type: 'stdio',
                  command: transport.command,
                  args: transport.args,
                  cwd: transport.cwd === '~' ? homedir() : join(homedir(), transport.cwd.slice(2)),
                  envSecretRefs: {},
                },
        })
        changed()
        return {
          connection: saved,
          choices: tool.tools,
          secrets: transport.type === 'http' ? transport.headers : transport.env,
          connectHere: entry.state === 'connect-here',
        }
      },
    },
    /** How tools from another host compare with this one, for **Continue on ‹host›** before the thread moves. */
    'toolSync.compare': {
      args: z.tuple([tools]),
      run: (incoming: PortableTool[]) => {
        const here = toolsHere(ctx)
        return incoming.map((tool) => ({ key: toolKey(tool), state: toolState(tool, here) }))
      },
    },
    /** The plugins and MCP servers a thread here called, its helpers included, as setup another host can install. */
    'toolSync.usedBy': {
      args: z.tuple([z.string().min(1).max(200)]),
      run: (taskId: string) => {
        const mcp = ctx.getSharedMcp?.()
        const used = new Set(
          ctx.agents
            .all()
            .filter((session) => session.taskId === taskId)
            .flatMap((session) => mcp?.connectionsUsedBy(session.id) ?? []),
        )
        if (!used.size) return []
        const plugins = new Set(
          (ctx.plugins?.list() ?? [])
            .filter((plugin) => plugin.mcpConnections.some((server) => used.has(server.id)))
            .map((plugin) => plugin.name),
        )
        const servers = new Set(
          (ctx.getSharedMcp?.().list().connections ?? [])
            .filter((entry) => used.has(entry.connection.id))
            .map((entry) => entry.connection.name),
        )
        return portableTools(ctx, ['plugin', 'mcp']).tools.filter((tool) =>
          tool.kind === 'plugin' ? plugins.has(tool.name) : servers.has(tool.name),
        )
      },
    },
  }
}
