import { mcpServerDetails } from './mcpStatus'
import { toolDescription, toolInput } from '../providers/acpEvents'
import { agentContent } from '@ramu/shared/chat/agentContent'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { AgentTaskStatus, AgentEvent } from '@ramu/shared/types'
import { claudeReadings, type ClaudeRateLimitInfo } from '../providers/usage'
import { ClaudeTextStream } from '../providers/claudeTextStream'
import { latestTasks } from '@ramu/shared/chat/agentTasks'
import { str } from './util'
import { summarizeInput, summarizeToolResult, subagentOf, serverToolUse, serverToolResult } from './toolSummaries'
import { classifyLimit } from '../providers/limitClassifier'
import type { ContextUsageTracker } from './contextUsage'
import type { SessionProcess } from './sessionProcess'
import type { SessionRecorder } from './sessionRecorder'
import type { SessionRegistry } from './sessionRegistry'
import type { FallbackRouter } from './fallbackRouter'
import type { SessionStore } from './sessionStore'
import type { AgentTasks } from './agentTasks'
import type { AgentService } from '../agent'
import type { Db } from '../db'

/** What ClaudeStreamPump needs from the rest of the service. */
export interface ClaudeStreamPumpHost
  extends
    Pick<ContextUsageTracker, 'refreshContext' | 'context' | 'setContext'>,
    Pick<SessionProcess, 'fail'>,
    Pick<SessionRecorder, 'record' | 'setState'>,
    Pick<SessionRegistry, 'live'>,
    Pick<FallbackRouter, 'fallback'>,
    Pick<SessionStore, 'events' | 'get'>,
    Pick<AgentTasks, 'settleTasks' | 'updateTask'> {
  usage(): AgentService['usage']
}

/** Reads a Claude SDK query to its end and turns its messages into recorded events. */
export class ClaudeStreamPump {
  constructor(
    private readonly host: ClaudeStreamPumpHost,
    private readonly db: Db,
  ) {}

  /** Agent tool calls in flight, by session and tool use id: what the main agent asked for, so the task it starts gets a name. */
  readonly agentCalls = new Map<
    string,
    Map<string, { name?: string; description?: string; prompt?: string; subagentType?: string }>
  >()

  async pump(id: string, query: Query): Promise<void> {
    const textStream = new ClaudeTextStream()
    const partials = new Map<string, Extract<AgentEvent, { kind: 'text' | 'thinking' }>>()
    let timer: ReturnType<typeof setTimeout> | undefined
    const flush = () => {
      if (timer) clearTimeout(timer)
      timer = undefined
      if (this.host.live.get(id)?.query === query) for (const event of partials.values()) this.host.record(id, event)
      partials.clear()
    }
    const streamText = (event: Extract<AgentEvent, { kind: 'text' | 'thinking' }>) => {
      partials.set(event.messageId!, event)
      // Keep token bursts from causing a database write and renderer update per token.
      timer ??= setTimeout(flush, 50)
    }
    try {
      for await (const msg of query) {
        if (this.host.live.get(id)?.query !== query) return
        if (msg.type !== 'stream_event') flush()
        const wire = msg as SDKMessage & { rate_limit_info?: { status?: string }; api_error?: string }
        if (wire.type === 'rate_limit_event' && wire.rate_limit_info) {
          const account = this.host.get(id).settings.accountId ?? 'default'
          const readings = claudeReadings(
            wire.rate_limit_info as ClaudeRateLimitInfo,
            this.host.usage()?.list({ 'claude-code': account }),
          ).map((reading) => (account === 'default' ? reading : { ...reading, accountId: account }))
          if (readings.length) this.host.usage()?.update(readings)
        }
        if (wire.type === 'rate_limit_event' && wire.rate_limit_info?.status === 'rejected') continue
        const limit =
          wire.api_error === 'usage_limit_reached'
            ? ({ confidence: 'high' } as const)
            : msg.type === 'result' && msg.is_error
              ? classifyLimit(msg, { provider: 'claude-code', channel: 'error' })
              : null
        if (limit) {
          this.host.record(id, {
            kind: 'error',
            message:
              limit.confidence === 'high' ? 'Claude usage limit reached.' : 'Claude may have reached a usage limit.',
          })
          // Queue after this pump exits so teardown never waits on itself.
          queueMicrotask(() => void this.host.fallback(id, limit.confidence))
          return
        }
        this.handle(id, msg, textStream, streamText)
      }
      if (this.host.live.get(id)?.query === query) {
        flush()
        this.host.settleTasks(id)
        this.host.live.delete(id)
        this.host.setState(id, 'stopped')
      }
    } catch (err) {
      if (this.host.live.get(id)?.query !== query) return // stopped or replaced
      flush()
      this.host.live.delete(id)
      const limit = classifyLimit(err, { provider: 'claude-code', channel: 'error' })
      if (limit) queueMicrotask(() => void this.host.fallback(id, limit.confidence))
      else this.host.fail(id, err)
    } finally {
      flush()
    }
  }

  private handle(
    id: string,
    msg: SDKMessage,
    textStream: ClaudeTextStream,
    streamText: (event: Extract<AgentEvent, { kind: 'text' | 'thinking' }>) => void,
  ): void {
    switch (msg.type) {
      case 'stream_event': {
        const block = textStream.partial(msg)
        if (block) {
          const agentId = msg.parent_tool_use_id ? this.claudeAgentId(id, msg) : undefined
          streamText(
            block.kind === 'thinking'
              ? { kind: 'thinking', text: block.text, messageId: block.messageId, ...(agentId ? { agentId } : {}) }
              : {
                  kind: 'text',
                  text: block.text,
                  messageId: block.messageId,
                  nativeMessageId: block.nativeMessageId,
                  ...(agentId ? { agentId } : {}),
                },
          )
        }
        return
      }
      case 'system':
        if (msg.subtype === 'status' && msg.status === 'compacting') {
          const context = this.host.context(id)
          this.host.record(id, {
            kind: 'compaction',
            state: 'started',
            ...(context ? { beforeTokens: context.used, contextWindow: context.max } : {}),
          })
        } else if (msg.subtype === 'status' && msg.compact_result === 'failed')
          this.host.record(id, { kind: 'compaction', state: 'failed' })
        else if (msg.subtype === 'compact_boundary') {
          const context = this.host.context(id)
          const event: Extract<AgentEvent, { kind: 'compaction' }> = {
            kind: 'compaction',
            state: 'completed',
            compactionId: msg.uuid,
            beforeTokens: msg.compact_metadata.pre_tokens,
            afterTokens: msg.compact_metadata.post_tokens,
            ...(context ? { contextWindow: context.max } : {}),
          }
          this.host.record(id, event)
          const query = this.host.live.get(id)?.query
          // Some SDK versions omit post_tokens. Read the provider's context at the boundary.
          if (event.afterTokens === undefined && query)
            void query
              .getContextUsage?.({ detail: 'summary' })
              .then((usage) => {
                if (this.host.live.get(id)?.query !== query) return
                this.host.setContext(id, usage.totalTokens, usage.maxTokens)
                this.host.record(id, { ...event, afterTokens: usage.totalTokens, contextWindow: usage.maxTokens })
              })
              .catch(() => {})
          else if (event.afterTokens !== undefined && context) this.host.setContext(id, event.afterTokens, context.max)
        }
        this.handleTask(id, msg)
        if (msg.subtype === 'init') {
          this.db.prepare('UPDATE agent_sessions SET provider_session_id = ? WHERE id = ?').run(msg.session_id, id)
          this.host.record(id, {
            kind: 'init',
            provider: 'claude-code',
            model: msg.model,
            cwd: msg.cwd,
            providerSessionId: msg.session_id,
            mcpServers: mcpServerDetails(msg.mcp_servers ?? []),
          })
          this.host.setState(id, 'running')
        }
        return
      case 'assistant': {
        const replacements = textStream.complete(msg)
        // Sub-agent output is kept, marked with its agent, for that agent's own transcript.
        const agentId = msg.parent_tool_use_id ? this.claudeAgentId(id, msg) : undefined
        const tag = agentId ? { agentId } : {}
        for (const [index, block] of msg.message.content.entries()) {
          if (block.type === 'text' && block.text.trim())
            this.host.record(
              id,
              {
                kind: 'text',
                text: block.text,
                ...(msg.message.id ? { nativeMessageId: msg.message.id } : {}),
                ...(msg.uuid ? { messageId: `claude:${msg.uuid}:${index}` } : {}),
                ...tag,
              },
              replacements.get(index),
            )
          else if (['image', 'audio', 'resource', 'resource_link'].includes((block as { type: string }).type))
            this.host.record(id, {
              kind: 'content',
              content: agentContent(block),
              messageId: `claude:${msg.uuid}:${index}`,
              ...tag,
            })
          else if (
            (block as { type: string }).type === 'thinking' &&
            (block as { thinking?: string }).thinking?.trim()
          ) {
            this.host.record(
              id,
              {
                kind: 'thinking',
                text: (block as { thinking: string }).thinking.trim(),
                messageId: `claude:${msg.uuid}:${index}`,
                ...tag,
              },
              replacements.get(index),
            )
          } else if (
            (block as { type: string }).type === 'server_tool_use' ||
            (block as { type: string }).type === 'mcp_tool_use'
          ) {
            const call = serverToolUse(block as unknown as Record<string, unknown>)
            if (call) this.host.record(id, { kind: 'tool-use', ...call })
          } else if (/_tool_result$/.test((block as { type: string }).type)) {
            const result = serverToolResult(block as unknown as Record<string, unknown>)
            if (result) this.host.record(id, { kind: 'tool-result', ...result })
          } else if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown>
            if (block.name === 'Agent' || block.name === 'Task') {
              const calls = this.agentCalls.get(id) ?? new Map()
              calls.set(block.id, {
                name: str(input.name),
                description: str(input.description),
                prompt: str(input.prompt),
                subagentType: str(input.subagent_type),
              })
              this.agentCalls.set(id, calls)
            }
            this.host.record(id, {
              kind: 'tool-use',
              toolUseId: block.id,
              name: block.name,
              summary: summarizeInput(input),
              title: toolDescription(input),
              input: toolInput(input),
              ...tag,
            })
          }
        }
        return
      }
      case 'user': {
        const agentId = msg.parent_tool_use_id ? this.claudeAgentId(id, msg) : undefined
        const content = msg.message.content
        if (typeof content === 'string') return
        for (const block of content) {
          if (block.type === 'tool_result') {
            this.host.record(id, {
              kind: 'tool-result',
              toolUseId: block.tool_use_id,
              isError: Boolean(block.is_error),
              summary: summarizeToolResult(block.content),
              ...(block.content ? { content: agentContent(block.content) } : {}),
              ...(agentId ? { agentId } : {}),
            })
          }
        }
        return
      }
      case 'result': {
        textStream.finishMainTurn()
        this.host.record(id, {
          kind: 'result',
          isError: msg.is_error,
          text: msg.subtype === 'success' ? msg.result : msg.subtype,
          costUsd: msg.total_cost_usd ?? null,
        })
        const current = this.host.live.get(id)?.query
        if (current) this.host.refreshContext(id, current)
        // The agent's claim that it finished; checks and review decide readiness.
        this.host.setState(id, msg.is_error ? 'failed' : 'idle')
        return
      }
      default:
        return
    }
  }

  /** Claude's task lifecycle messages: sub-agents and background commands, which may outlive the turn. */
  private claudeAgentId(id: string, msg: { parent_tool_use_id: string | null }): string {
    const tagged = msg as { agent_id?: string }
    return (
      tagged.agent_id ??
      latestTasks(this.host.events(id)).find((task) => task.toolUseId === msg.parent_tool_use_id)?.agentId ??
      subagentOf(msg)
    )
  }

  private handleTask(id: string, msg: SDKMessage): void {
    const m = msg as unknown as Record<string, any>
    if (m.type !== 'system' || typeof m.task_id !== 'string') return
    const agentId: string = m.task_id
    const usage = m.usage
      ? { tokens: m.usage.total_tokens, toolUses: m.usage.tool_uses, durationMs: m.usage.duration_ms }
      : {}
    if (m.subtype === 'task_started') {
      const call = m.tool_use_id ? this.agentCalls.get(id)?.get(m.tool_use_id) : undefined
      const agent = m.task_type === undefined || m.task_type === 'local_agent' || m.task_type === 'remote_agent'
      this.host.updateTask(id, agentId, {
        toolUseId: m.tool_use_id,
        name: m.description || call?.description || (agent ? 'Agent' : 'Background task'),
        agentType: m.subagent_type ?? call?.subagentType,
        taskType: m.task_type,
        status: 'running',
        background: !!m.is_backgrounded,
        prompt: m.prompt ?? call?.prompt,
        startedAt: Date.now(),
        address: call?.name ?? agentId,
        canStop: true,
        canMessage: agent,
        recovered: false,
        recoveryError: '',
      })
    } else if (m.subtype === 'task_progress') {
      this.host.updateTask(id, agentId, { summary: m.summary, lastTool: m.last_tool_name, ...usage })
    } else if (m.subtype === 'task_updated') {
      const patch = m.patch ?? {}
      const status: AgentTaskStatus | undefined =
        patch.status === 'completed'
          ? 'completed'
          : patch.status === 'failed'
            ? 'failed'
            : patch.status === 'killed'
              ? 'stopped'
              : patch.status
                ? 'running'
                : undefined
      this.host.updateTask(id, agentId, {
        status,
        name: patch.description,
        background: patch.is_backgrounded,
        error: patch.error,
        endedAt: patch.end_time,
      })
    } else if (m.subtype === 'task_notification') {
      const status: AgentTaskStatus =
        m.status === 'completed' ? 'completed' : m.status === 'failed' ? 'failed' : 'stopped'
      this.host.updateTask(id, agentId, { status, summary: m.summary || undefined, endedAt: Date.now(), ...usage })
    }
  }
}
