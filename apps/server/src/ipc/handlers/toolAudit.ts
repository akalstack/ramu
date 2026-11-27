import { z } from 'zod'
import { resolveWorkModel, withWorkModel } from '@ramu/shared/providers/workModel'
import { DEFAULT_AGENT_SETTINGS, type ModelPreferences } from '@ramu/shared/types'
import {
  auditBudget,
  auditPrompt,
  readToolAudit,
  type ToolAudit,
  type ToolAuditFile,
  type ToolAuditKind,
} from '@ramu/shared/toolAudit'
import { need } from '../helpers'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const target = z.union([
  z.object({ kind: z.literal('skill'), stageId: id }),
  z.object({ kind: z.literal('skill'), skillId: id }),
  z.object({ kind: z.literal('plugin'), stageId: id }),
  z.object({ kind: z.literal('plugin'), pluginId: id }),
  z.object({
    kind: z.literal('mcp'),
    connectionId: z.string().min(1).max(200),
    /** The tools the server listed when it was last checked; their descriptions are what agents read. */
    tools: z
      .array(z.object({ name: z.string().min(1).max(200), description: z.string().max(4000).optional() }))
      .max(300)
      .optional(),
  }),
])
export type ToolAuditTarget = z.infer<typeof target>

/**
 * A safety read of a skill, plugin or MCP server by the host's maintenance model, before or after it is installed. The
 * model runs isolated in an empty folder with every tool request refused, so what it reads cannot act through it.
 */
export const registerToolAuditHandlers: RegisterHandlers = ({
  workspace,
  agents,
  storedPreferences,
  externalSkills,
  plugins,
  getSharedMcp,
}) => {
  const settings = () =>
    withWorkModel(
      DEFAULT_AGENT_SETTINGS,
      resolveWorkModel(storedPreferences().intelligence?.maintenanceModel ?? null, {
        models: workspace.getAppState<ModelPreferences | null>('model-preferences', null),
      }),
    )
  const material = (input: ToolAuditTarget): { kind: ToolAuditKind; name: string; files: ToolAuditFile[] } => {
    if (input.kind === 'skill')
      return {
        kind: 'skill',
        ...need(externalSkills).auditFiles(
          'stageId' in input ? { stageId: input.stageId } : { skillId: input.skillId },
        ),
      }
    if (input.kind === 'plugin') {
      if (!plugins) throw new Error('Update this host for plugins')
      return {
        kind: 'plugin',
        ...plugins.auditFiles('stageId' in input ? { stageId: input.stageId } : { pluginId: input.pluginId }),
      }
    }
    if (!getSharedMcp) throw new Error('Update this host for MCP servers')
    const connection = getSharedMcp()
      .policy.snapshot()
      .connections.find((entry) => entry.id === input.connectionId)
    if (!connection) throw new Error('That MCP server is no longer here.')
    const { transport } = connection
    return {
      kind: 'mcp',
      name: connection.name,
      files: [
        {
          path: transport.type === 'http' ? 'Address' : 'Command',
          text:
            transport.type === 'http'
              ? transport.url
              : [`${[transport.command, ...transport.args].join(' ')}`, `Runs in ${transport.cwd}`].join('\n'),
        },
        ...(input.tools ?? []).map((tool) => ({ path: `Tool ${tool.name}`, text: tool.description ?? '' })),
      ],
    }
  }
  return {
    'tools.audit': {
      args: z.tuple([target]),
      run: async (input: ToolAuditTarget): Promise<ToolAudit> => {
        const { kind, name, files } = material(input)
        const { files: kept, skipped } = auditBudget(files)
        const reply = await agents.analyze(auditPrompt(kind, name, kept), settings(), 20_000, {
          timeoutMs: 120_000,
          defer: false,
        })
        return readToolAudit(reply.message, reply.model, skipped)
      },
    },
  }
}
