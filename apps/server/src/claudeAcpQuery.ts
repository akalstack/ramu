import { randomUUID } from 'node:crypto'
import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import type { Agent } from '@agentclientprotocol/sdk'
import type { QueryFn } from './agent'
import { localAcp } from './acpTransport'

class Queue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiter?: (value: IteratorResult<T>) => void
  private ended = false
  private error?: Error
  push(value: T) {
    if (this.ended) return
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = undefined
      waiter({ value, done: false })
    } else this.items.push(value)
  }
  close(error?: Error) {
    this.ended = true
    this.error = error
    this.waiter?.({ value: undefined, done: true })
    this.waiter = undefined
  }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      const value = this.items.shift()
      if (value !== undefined) {
        yield value
        continue
      }
      if (this.ended) {
        if (this.error) throw this.error
        return
      }
      const next = await new Promise<IteratorResult<T>>((resolve) => {
        this.waiter = resolve
      })
      if (next.done) {
        if (this.error) throw this.error
        return
      }
      yield next.value
    }
  }
}

/** ACP host for Claude with scoped native SDK-message and owning-Query controls.
 * Keeps hooks on the host and transports prompts, permissions, output, and controls
 * through the official ACP SDK. No second Query is used to control a live session. */
export function claudeAcpQuery(nativeQuery: QueryFn): QueryFn {
  return (args) => {
    const input = new Queue<SDKUserMessage>(),
      output = new Queue<SDKMessage>()
    let native: Query | undefined,
      sessionId = '',
      closed = false,
      active = false
    let complete: (() => void) | undefined
    const permissionAborts = new Map<string, AbortController>()
    const check = (id: unknown) => {
      if (!sessionId || id !== sessionId || closed) throw new Error('Claude ACP session is unavailable')
    }
    const pair = localAcp(
      {
        requestPermission: async () => ({ outcome: { outcome: 'cancelled' } }),
        sessionUpdate: (notification) => {
          if (notification.sessionId !== sessionId || closed) return
          const raw = (notification.update._meta?.ramu as { sdkMessage?: SDKMessage } | undefined)?.sdkMessage
          if (raw) output.push(raw)
        },
        extMethod: async (method, params) => {
          if (method !== '_ramu/canUseTool') throw new Error('Unsupported Claude client extension')
          check(params.sessionId)
          const controller = new AbortController(),
            id = String(params.requestId)
          permissionAborts.set(id, controller)
          try {
            return (
              ((await args.options.canUseTool?.(String(params.toolName), params.input as Record<string, unknown>, {
                signal: controller.signal,
                toolUseID: id,
                requestId: id,
                title: params.title as string | undefined,
                decisionReason: params.decisionReason as string | undefined,
              })) as unknown as Record<string, unknown>) ?? { behavior: 'deny', message: 'No permission handler' }
            )
          } finally {
            permissionAborts.delete(id)
          }
        },
        extNotification: (method, params) => {
          if (method === '_ramu/permissionAbort') permissionAborts.get(String(params.requestId))?.abort()
          if (method === '_ramu/end') output.close(params.error ? new Error(String(params.error)) : undefined)
        },
      },
      (server): Agent => {
        const create = (resume?: string) => {
          if (native) throw new Error('A Claude ACP host owns exactly one Query')
          sessionId = resume || randomUUID()
          native = nativeQuery({
            prompt: input,
            options: {
              ...args.options,
              ...(resume ? { resume } : {}),
              canUseTool: async (toolName, toolInput, options) => {
                const id = options.toolUseID || randomUUID()
                const abort = () => {
                  void server.extNotification('_ramu/permissionAbort', { sessionId, requestId: id }).catch(() => {})
                }
                options.signal.addEventListener('abort', abort, { once: true })
                try {
                  return (await server.extMethod('_ramu/canUseTool', {
                    sessionId,
                    requestId: id,
                    toolName,
                    input: toolInput,
                    title: options.title,
                    decisionReason: options.decisionReason,
                  })) as any
                } finally {
                  options.signal.removeEventListener('abort', abort)
                }
              },
            },
          })
          void (async () => {
            try {
              for await (const message of native!) {
                await server.sessionUpdate({
                  sessionId,
                  update: {
                    sessionUpdate: 'session_info_update',
                    _meta: { ramu: { version: 1, sdkMessage: message } },
                  },
                })
                if (message.type === 'result') {
                  complete?.()
                  complete = undefined
                }
              }
              await server.extNotification('_ramu/end', { sessionId })
            } catch (error) {
              await server.extNotification('_ramu/end', { sessionId, error: String(error) }).catch(() => {})
            } finally {
              complete?.()
              complete = undefined
            }
          })()
          return { sessionId }
        }
        return {
          initialize: () => ({
            protocolVersion: 1,
            agentCapabilities: {
              loadSession: true,
              promptCapabilities: { image: true },
              _meta: { ramu: { sdkMessages: 1, owningQueryControls: 1 } },
            },
            authMethods: [],
          }),
          authenticate: async () => {
            throw new Error('Use Claude Login before starting a chat')
          },
          newSession: () => create(),
          loadSession: (request) => {
            create(request.sessionId)
            return {}
          },
          prompt: async (request) => {
            check(request.sessionId)
            if (complete) throw new Error('A Claude prompt is already active')
            const done = new Promise<void>((resolve) => {
              complete = resolve
            })
            const message = (request._meta?.ramu as { message?: SDKUserMessage } | undefined)?.message
            if (!message) throw new Error('Missing Claude prompt envelope')
            input.push(message)
            await done
            return { stopReason: 'end_turn' }
          },
          cancel: async (request) => {
            check(request.sessionId)
            await native?.interrupt()
          },
          extMethod: async (method, params) => {
            if (method === '_ramu/close') {
              if (params.sessionId !== sessionId) throw new Error('Wrong Claude session')
              input.close()
              native?.close()
              complete?.()
              complete = undefined
              return {}
            }
            check(params.sessionId)
            if (method === '_ramu/steer') {
              input.push(params.message as SDKUserMessage)
              return {}
            }
            if (method === '_ramu/inputEnd') {
              input.close()
              return {}
            }
            const controls: Record<string, (...values: any[]) => unknown> = {
              supportedModels: (...values) => native!.supportedModels(...(values as [])),
              getContextUsage: (options) => native!.getContextUsage(options),
              usage: (options) => native!.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET(options),
              backgroundTasks: (id) => native!.backgroundTasks(id),
              stopTask: (id) => native!.stopTask(id),
            }
            const name = method.replace('_ramu/', ''),
              handler = controls[name]
            if (!handler) throw new Error('Unsupported owning-Query control')
            return { value: await handler(...((params.args as unknown[]) ?? [])) }
          },
        }
      },
    )
    const client = pair.connection
    const ready = (async () => {
      await client.initialize({
        protocolVersion: 1,
        clientCapabilities: { subagents: {}, fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      })
      const request = {
        cwd: args.options.cwd ?? process.cwd(),
        additionalDirectories: args.options.additionalDirectories ?? [],
        mcpServers: [],
      }
      if (args.options.resume) await client.loadSession({ ...request, sessionId: args.options.resume })
      else await client.newSession(request)
    })()
    void ready.catch((error) => output.close(error))
    void (async () => {
      await ready
      for await (const message of args.prompt) {
        if (closed) break
        if (active) await client.extMethod('_ramu/steer', { sessionId, message })
        else {
          active = true
          const text =
            typeof message.message.content === 'string'
              ? message.message.content
              : message.message.content
                  .filter((block) => block.type === 'text')
                  .map((block) => (block as { text: string }).text)
                  .join('\n')
          void client
            .prompt({ sessionId, prompt: [{ type: 'text', text }], _meta: { ramu: { message } } })
            .catch((error) => output.close(error))
            .finally(() => {
              active = false
            })
        }
      }
      if (!closed) await client.extMethod('_ramu/inputEnd', { sessionId })
    })().catch((error) => {
      if (!closed) output.close(error)
    })
    const control = async (name: string, values: unknown[]) => {
      await ready
      const result = await client.extMethod(`_ramu/${name}`, { sessionId, args: values })
      return result.value
    }
    const close = () => {
      if (closed) return
      void ready
        .then(() => client.extMethod('_ramu/close', { sessionId }))
        .catch(() => {})
        .finally(() => {
          pair.close()
          output.close()
          for (const controller of permissionAborts.values()) controller.abort()
        })
      closed = true
    }
    args.options.abortController?.signal.addEventListener('abort', close, { once: true })
    return new Proxy(
      {
        [Symbol.asyncIterator]: () => output[Symbol.asyncIterator](),
        close,
        interrupt: async () => {
          await ready
          await client.cancel({ sessionId })
        },
      },
      {
        get(target, key) {
          if (key in target) return target[key as keyof typeof target]
          if (key === 'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET')
            return (...values: unknown[]) => control('usage', values)
          if (['supportedModels', 'getContextUsage', 'backgroundTasks', 'stopTask'].includes(String(key)))
            return (...values: unknown[]) => control(String(key), values)
          return undefined
        },
      },
    ) as unknown as Query
  }
}
