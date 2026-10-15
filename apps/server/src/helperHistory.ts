import { getSubagentMessages, listSubagents, type SessionMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentEvent, AgentSessionInfo, AgentTask } from '@ramu/shared/types'
import { latestTasks } from '@ramu/shared/agentTasks'
import { codexHelperHistory } from './codex'

export interface HelperHistory {
  task: AgentTask
  events: AgentEvent[]
  error?: string
}
export type HelperHistoryLoader = (session: AgentSessionInfo, tasks: AgentTask[]) => Promise<HelperHistory[]>

/** Only reads saved provider history; never resumes a helper or executes its tools. */
export const loadHelperHistory: HelperHistoryLoader = async (session, tasks) => {
  if (!session.providerSessionId) return []
  if (session.provider === 'codex') return codexHelperHistory(session, tasks)
  if (session.provider !== 'claude-code') return []
  const ids = new Set([
    ...tasks
      .filter((task) => !task.taskType || task.taskType === 'local_agent' || task.taskType === 'remote_agent')
      .map((task) => task.agentId),
    ...(await listSubagents(session.providerSessionId, { dir: session.cwd })),
  ])
  const history = new Map<string, HelperHistory>()
  for (const agentId of ids) {
    const task = tasks.find((task) => task.agentId === agentId) ?? {
      agentId,
      name: 'Recovered agent',
      status: 'stopped' as const,
    }
    try {
      const messages = await getSubagentMessages(session.providerSessionId, agentId, { dir: session.cwd })
      const toolUseId = messages.find((message) => message.parent_tool_use_id)?.parent_tool_use_id
      const matched = toolUseId ? (tasks.find((task) => task.toolUseId === toolUseId) ?? task) : task
      if (messages.length || !history.has(matched.agentId))
        history.set(matched.agentId, {
          task: matched,
          events: claudeHelperEvents(matched.agentId, messages),
          ...(!messages.length ? { error: 'The provider has no saved transcript for this helper.' } : {}),
        })
    } catch (error) {
      if (!history.has(task.agentId)) history.set(task.agentId, { task, events: [], error: String(error) })
    }
  }
  return [...history.values()]
}

/** Stable IDs let a second boot merge the same history without duplicate messages. */
export function claudeHelperEvents(agentId: string, messages: SessionMessage[]): AgentEvent[] {
  return messages.flatMap((entry): AgentEvent[] => {
    if (entry.type === 'system' || !entry.message || typeof entry.message !== 'object') return []
    const savedMessage = entry.message as { id?: unknown; content?: unknown }
    const content = savedMessage.content
    const blocks =
      typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    return blocks.flatMap((block, index): AgentEvent[] => {
      if (!block || typeof block !== 'object') return []
      const key = `claude:${entry.uuid}:${index}`
      if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        // The initial user prompt is already shown on the task card. Never import it as a root user message.
        return entry.type === 'assistant'
          ? [
              {
                kind: 'text',
                text: block.text,
                messageId: key,
                ...(typeof savedMessage.id === 'string' ? { nativeMessageId: savedMessage.id } : {}),
                agentId,
              },
            ]
          : []
      }
      if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string')
        return [
          {
            kind: 'tool-use',
            toolUseId: block.id,
            name: block.name,
            summary: JSON.stringify(block.input ?? {}).slice(0, 2000),
            agentId,
          },
        ]
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const summary =
          typeof block.content === 'string'
            ? block.content
            : Array.isArray(block.content)
              ? block.content
                  .filter((part: { type?: string }) => part?.type === 'text')
                  .map((part: { text?: string }) => part.text ?? '')
                  .join('\n')
              : ''
        return [
          {
            kind: 'tool-result',
            toolUseId: block.tool_use_id,
            isError: !!block.is_error,
            summary: summary.slice(0, 2000),
            agentId,
          },
        ]
      }
      return []
    })
  })
}

export interface HelperRecoverySource {
  session: AgentSessionInfo
  tasks: AgentTask[]
}

/** Reconstruct provider ownership from durable events, including chats written before init carried a provider. */
export function helperRecoverySources(
  session: AgentSessionInfo,
  events: AgentEvent[],
  tasks = latestTasks(events),
): HelperRecoverySource[] {
  const sources = new Map<string, HelperRecoverySource>()
  const owners = new Map<string, string>()
  const firstSwitch = events.find((event) => event.kind === 'settings' && event.previous)
  const firstInit = events.find((event) => event.kind === 'init')
  let provider =
    firstInit?.kind === 'init' && firstInit.provider
      ? firstInit.provider
      : firstSwitch?.kind === 'settings'
        ? firstSwitch.previous!.provider
        : session.provider
  let settings = firstSwitch?.kind === 'settings' ? firstSwitch.previous! : { ...session.settings, provider }
  let active: string | null = null
  const source = (id: string, cwd: string) => {
    const key = `${provider}:${id}`
    if (!sources.has(key))
      sources.set(key, {
        session: { ...session, provider, settings: { ...settings, provider }, providerSessionId: id, cwd },
        tasks: [],
      })
    return key
  }
  for (const event of events) {
    if (event.kind === 'settings') {
      if (provider !== event.settings.provider) active = null
      provider = event.settings.provider
      settings = event.settings
    } else if (event.kind === 'init') {
      provider = event.provider ?? provider
      active = source(event.providerSessionId, event.cwd)
    } else if (event.kind === 'agent' && active && !owners.has(event.agentId)) owners.set(event.agentId, active)
  }
  provider = session.provider
  settings = session.settings
  const current = session.providerSessionId ? source(session.providerSessionId, session.cwd) : null
  for (const task of tasks) {
    const recorded = task.providerSessionId && task.provider ? `${task.provider}:${task.providerSessionId}` : null
    if (recorded && !sources.has(recorded))
      sources.set(recorded, {
        session: {
          ...session,
          provider: task.provider!,
          settings: { ...session.settings, provider: task.provider! },
          providerSessionId: task.providerSessionId!,
        },
        tasks: [],
      })
    const owner = recorded ?? owners.get(task.agentId) ?? current
    if (owner) sources.get(owner)!.tasks.push(task)
  }
  return [...sources.values()]
}
