import { isViewImageTool, toolImageName } from './toolImage'
import { t as translate } from '../../../i18n'
import { toolKind } from '@ramu/shared/chat/agentTools'
import { fileToolLine } from '@ramu/shared/chat/fileTools'
import { summarizeTools, toolFallbackLine, toolLabel } from '@ramu/shared/chat/toolSummary'
import { describeRamuTool, ramuTool } from '@ramu/shared/chat/ramuTools'
import { toolIsRunning } from '@ramu/shared/chat/toolStatus'
import { type ToolResult, type ToolUse } from '../types'

export { toolLabel }

/**
 * The headline for a tool the provider gave no title: tool search says what it looked for, and a tool whose summary is just its
 * JSON input shows its name instead. Null leaves the caller's usual "verb + summary" line.
 */
export function toolFallbackTitle(tool: ToolUse, running: boolean): string | null {
  return tool.title?.trim() ? null : toolFallbackLine(tool, running, translate)
}

/** A one-line summary of tool calls, like "Ran pnpm test, Read 3 files"; the phone builds the same line. */
export function describeTools(tools: ToolUse[], results: Map<string, ToolResult>, active: boolean, cwd = ''): string {
  return summarizeTools(
    tools.map((tool) => {
      const call = ramuTool(tool)
      const row = call ? describeRamuTool(call, results.get(tool.toolUseId)?.summary) : null
      const subject =
        fileToolLine(tool, results.get(tool.toolUseId))?.name ??
        (cwd ? tool.summary.split(`${cwd}/`).join('') : tool.summary)
      return {
        subject,
        name: tool.name,
        running: toolIsRunning(results.get(tool.toolUseId), active),
        ...(call && row
          ? { ramu: { key: call.name, done: row.done, running: row.running, subject: row.subject } }
          : {}),
        ...(isViewImageTool(tool.name) ? { image: { name: toolImageName(tool) } } : {}),
        kind: toolKind(tool),
        ...(tool.title ? { title: tool.title } : {}),
      }
    }),
    translate,
  )
}
