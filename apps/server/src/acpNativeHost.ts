import { randomUUID } from 'node:crypto'
import type { Agent, AgentSideConnection, ContentBlock } from '@agentclientprotocol/sdk'
import type { AgentRunner, AgentRunnerFactory } from './agentRunner'
import type { AgentEvent, Attachment, ElicitationAction, McpConnection } from '@ramu/shared/types'
import { localAcp } from './acpTransport'
import { AcpEventEncoder, AcpEvents } from './acpEvents'

/** Ramu-maintained ACP agents retain native extensions missing from stock adapters.
 * The provider drivers own native processes; the app-facing runner only speaks ACP. */
export function acpHostedRunner(nativeFactory: AgentRunnerFactory): AgentRunnerFactory {
  return (scope, settings, emit, readOnly) => {
    let native: AgentRunner | undefined, started = false, stopped = false
    let sessionId = '', resume: string | null = null, tools: McpConnection | undefined
    let finish: ((reason: 'end_turn' | 'cancelled' | 'refusal') => void) | undefined
    let updates = Promise.resolve()
    const encoder = new AcpEventEncoder(), decoder = new AcpEvents(true)
    const permissions = new Map<string, (allow: boolean | null) => void>()
    const checked = (id: unknown) => { if (id !== sessionId || !sessionId || stopped) throw new Error('ACP session is unavailable') }
    const publish = (server: AgentSideConnection, event: AgentEvent, limit?: boolean) => {
      if (stopped) return
      const update = encoder.encode(event, !!limit)
      updates = updates.then(() => server.sessionUpdate({ sessionId, update })).catch(() => {})
      if (event.kind === 'result' || event.kind === 'error' || (event.kind === 'state' && event.state === 'failed')) {
        const done = finish; finish = undefined
        void updates.then(() => done?.(event.kind === 'result' && !event.isError ? 'end_turn' : 'refusal'))
      }
    }
    const pair = localAcp({
      requestPermission: async (request) => {
        const event = (request._meta?.ramu as { event?: AgentEvent } | undefined)?.event
        if (!event || event.kind !== 'permission-request' || request.sessionId !== sessionId) return { outcome: { outcome: 'cancelled' } }
        const decision = new Promise<boolean | null>((resolve) => permissions.set(event.requestId, resolve))
        emit(event)
        const allow = await decision
        permissions.delete(event.requestId)
        return { outcome: allow === null ? { outcome: 'cancelled' } : { outcome: 'selected', optionId: allow ? 'allow' : 'deny' } }
      },
      sessionUpdate: (notification) => {
        if (notification.sessionId !== sessionId || stopped) return
        for (const event of decoder.consume(notification.update)) emit(event, !!(notification.update._meta?.ramu as { usageLimit?: boolean } | undefined)?.usageLimit)
      },
    }, (server): Agent => ({
      initialize: () => ({ protocolVersion: 1, agentCapabilities: { loadSession: true, promptCapabilities: { image: true }, _meta: { ramu: { nativeEvents: 1, steering: true } } }, authMethods: [] }),
      authenticate: async () => { throw new Error('Use provider Login before starting a chat.') },
      newSession: () => { if (sessionId) throw new Error('A host owns exactly one session'); sessionId = randomUUID(); return { sessionId } },
      loadSession: (request) => { if (sessionId) throw new Error('A host owns exactly one session'); sessionId = request.sessionId; resume = request.sessionId; return {} },
      prompt: async (request) => {
        checked(request.sessionId)
        if (finish) throw new Error('An ACP prompt is already active')
        const text = request.prompt.filter((block): block is ContentBlock & { type: 'text'; text: string } => block.type === 'text').map((block) => block.text).join('\n')
        const attachments = (request._meta?.ramu as { attachments?: Attachment[] } | undefined)?.attachments ?? []
        const result = new Promise<{ stopReason: 'end_turn' | 'cancelled' | 'refusal' }>((resolve) => { finish = (stopReason) => resolve({ stopReason }) })
        try {
          if (!native) {
            native = nativeFactory(scope, settings, (event, limit) => {
              if (event.kind === 'permission-request') {
                void server.requestPermission({ sessionId, toolCall: { toolCallId: event.requestId, title: event.title }, options: [{ optionId: 'allow', name: 'Allow', kind: 'allow_once' }, { optionId: 'deny', name: 'Deny', kind: 'reject_once' }], _meta: { ramu: { event } } }).then((response) => native?.replyPermission(event.requestId, response.outcome.outcome === 'selected' && response.outcome.optionId === 'allow'), () => native?.replyPermission(event.requestId, false)).catch(() => {})
              } else publish(server, event, limit)
            }, readOnly)
            if (tools) native.setTools?.(tools)
          }
          if (!started) { started = true; await native.start(text, resume, attachments) }
          else await native.send(text, attachments)
        } catch (error) { finish = undefined; throw error }
        return result
      },
      cancel: async (request) => { checked(request.sessionId); await native?.interrupt(); finish?.('cancelled'); finish = undefined },
      extMethod: async (method, params) => {
        checked(params.sessionId)
        if (method === '_ramu/steer') { await native?.steer(String(params.text), params.attachments as Attachment[]); return {} }
        if (method === '_ramu/question') { native?.replyQuestion(String(params.id), params.answers as Record<string, string>); return {} }
        if (method === '_ramu/elicitation') { native?.replyElicitation?.(String(params.id), params.action as ElicitationAction, params.answers as Record<string, string>); return {} }
        throw new Error('Unsupported ACP extension')
      },
    }))
    const client = pair.connection
    const fail = (error: unknown) => { if (!stopped) { emit({ kind: 'error', message: String(error) }); emit({ kind: 'state', state: 'failed' }) } }
    const extension = (method: string, params: Record<string, unknown>) => client.extMethod(method, { sessionId, ...params })
    const prompt = async (text: string, attachments: Attachment[] = []) => {
      // The maintained host resolves local image paths itself; external clients can use image blocks.
      void client.prompt({ sessionId, prompt: [{ type: 'text', text }], _meta: { ramu: { attachments } } }).catch(fail)
    }
    return {
      setTools: (connection) => { tools = connection; native?.setTools?.(connection) },
      start: async (text, previous, attachments) => {
        await client.initialize({ protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, subagents: {} } })
        if (previous) await client.loadSession({ sessionId: previous, cwd: scope.cwd, additionalDirectories: scope.additionalDirs, mcpServers: [] })
        else await client.newSession({ cwd: scope.cwd, additionalDirectories: scope.additionalDirs, mcpServers: [] })
        await prompt(text, attachments)
      },
      send: prompt,
      steer: async (text, attachments = []) => { await extension('_ramu/steer', { text, attachments }) },
      interrupt: async () => { await client.cancel({ sessionId }) },
      stop: async () => { if (stopped) return; for (const resolve of permissions.values()) resolve(null); permissions.clear(); await native?.stop(); stopped = true; finish?.('cancelled'); finish = undefined; pair.close() },
      replyPermission: (id, allow) => { const resolve = permissions.get(id); if (!resolve) throw new Error('That permission is no longer pending'); resolve(allow) },
      replyQuestion: (id, answers) => { void extension('_ramu/question', { id, answers }).catch(fail) },
      replyElicitation: (id, action, answers) => { void extension('_ramu/elicitation', { id, action, answers }).catch(fail) },
    }
  }
}
