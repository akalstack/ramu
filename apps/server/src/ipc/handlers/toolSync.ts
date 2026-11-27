import { homedir } from 'node:os'
import { ADMINISTER_REFUSAL } from '@ramu/shared/devicePermissions'
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
  toolsUsedIn,
  rememberChoices,
  removeEverywhere,
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
      args: z.tuple([tools, z.string().min(1).max(200), z.boolean().optional()]),
      run: (incoming: PortableTool[], from: string, remove?: boolean) => {
        const waiting = receiveTools(ctx, incoming, from, remove === true)
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
    /** Before a tool is removed here: ask this host's other hosts to remove it too, now and when they connect. */
    'toolSync.removeEverywhere': {
      args: z.tuple([key]),
      run: (removing: string) => {
        if (removeEverywhere(ctx, removing)) changed()
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
        if (ctx.host.canAdministerIntegrations?.() !== true) throw new Error(ADMINISTER_REFUSAL)
        if (!ctx.getSharedMcp) throw new Error('Update this host for Shared MCP management')
        const entry = waitingTools(ctx).find((waiting) => waiting.key === chosen)
        if (!entry || entry.tool.kind !== 'mcp') throw new Error('That server is no longer waiting here.')
        const { tool } = entry
        const transport = tool.transport
        const manager = ctx.getSharedMcp()
        // A project's server is that project's here too, and runs in its folder.
        const project = entry.projectId
          ? ctx.workspace.listProjects().find((item) => item.id === entry.projectId)
          : null
        if (entry.projectId && !project?.root) throw new Error('That project has no folder on this host.')
        // A server of the same name here is the one to change, not a second copy beside it; a plugin's stays its own.
        const fromPlugins = new Set(
          (ctx.plugins?.list() ?? []).flatMap((plugin) => plugin.mcpConnections.map((server) => server.id)),
        )
        const same = manager
          .list()
          .connections.map((item) => item.connection)
          .find(
            (connection) =>
              connection.name === tool.name &&
              !connection.split &&
              !fromPlugins.has(connection.id) &&
              (project ? connection.scope.projectIds.includes(project.id) : connection.scope.hostWide),
          )
        // Secrets this host already holds for that server stay, for the names the server still needs.
        const held: Record<string, string> = !same
          ? {}
          : same.transport.type === 'http'
            ? same.transport.headerSecretRefs
            : same.transport.envSecretRefs
        const kept = (names: string[]) =>
          Object.fromEntries(Object.entries(held).filter(([name]) => names.includes(name)))
        const saved = manager.save(
          {
            name: tool.name,
            serviceAccountId: same?.serviceAccountId ?? 'public',
            enabled: entry.state !== 'connect-here',
            scope: project ? { hostWide: false, projectIds: [project.id] } : { hostWide: true, projectIds: [] },
            providers: tool.providers,
            transport:
              transport.type === 'http'
                ? {
                    type: 'http',
                    url: transport.url,
                    headerSecretRefs: kept(transport.headers),
                    ...(transport.allowPrivateNetwork ? { allowPrivateNetwork: true } : {}),
                  }
                : {
                    type: 'stdio',
                    command: transport.command,
                    args: transport.args,
                    cwd: project?.root
                      ? project.root
                      : transport.cwd === '~'
                        ? homedir()
                        : join(homedir(), transport.cwd.slice(2)),
                    envSecretRefs: kept(transport.env),
                  },
          },
          same?.id,
        )
        if (Object.keys(tool.tools).length) rememberChoices(ctx.workspace, saved.id, tool.tools)
        changed()
        return {
          connection: saved,
          choices: tool.tools,
          secrets: (transport.type === 'http' ? transport.headers : transport.env).filter((name) => !(name in held)),
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
    /**
     * The plugins, skills and MCP servers a thread here used, its helpers included, as setup another host can install:
     * the servers it called, the skills its agent opened and the plugin command lines it ran.
     */
    'toolSync.usedBy': {
      args: z.tuple([z.string().min(1).max(200)]),
      run: (taskId: string) => {
        const mcp = ctx.getSharedMcp?.()
        const sessions = ctx.agents.all().filter((session) => session.taskId === taskId)
        const called = new Set(sessions.flatMap((session) => mcp?.connectionsUsedBy(session.id) ?? []))
        const installed = ctx.plugins?.list() ?? []
        const used = toolsUsedIn(
          sessions.flatMap((session) => ctx.agents.events(session.id)),
          installed,
          ctx.learning?.skills() ?? [],
        )
        for (const plugin of installed)
          if (plugin.mcpConnections.some((server) => called.has(server.id))) used.plugins.add(plugin.name)
        const servers = new Set(
          (mcp?.list().connections ?? [])
            .filter((entry) => called.has(entry.connection.id))
            .map((entry) => entry.connection.name),
        )
        return portableTools(ctx).tools.filter((tool) =>
          tool.kind === 'plugin'
            ? used.plugins.has(tool.name)
            : tool.kind === 'skill'
              ? used.skills.has(tool.name)
              : servers.has(tool.name),
        )
      },
    },
  }
}
