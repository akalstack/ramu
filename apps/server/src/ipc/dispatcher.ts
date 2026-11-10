import { checkRpcResult } from '@ramu/shared/rpcResults'
import { RPC_RESULTS } from '@ramu/shared/rpcResults.generated'
import { operationLabels } from '../background/activity'
import { describeValidationError } from '../validation'
import { createHandlerContext } from './context'
import { registerHandlers } from './registry'
import type { RuntimeHost, Services } from './types'

/** Methods that change which projects, chats or sessions exist, or how the sidebar shows them. */
const WORKSPACE_MUTATIONS =
  /^(projects\.(create|addFolder|rename|setRouting|remove|reorder|setActions|setActionVisibility|resetActionOrder|reorderActions)|folders\.(addProject|clone)|repos\.(add|remove)|workspaces\.rename|tasks\.(create|rename|pin|done|archive|delete|setup|generateTitle)|thread\.start|agent\.(start|delete|submit|send|sendQueuedNow|resumeQueue|goal\.control)|summaries\.discuss)$/

export function createDispatcher(host: RuntimeHost, services: Services) {
  const { workspace } = services
  // Bursts (create + setup + start) collapse into one trailing notification.
  let workspaceTimer: ReturnType<typeof setTimeout> | undefined
  const announceWorkspaceChange = () => {
    clearTimeout(workspaceTimer)
    workspaceTimer = setTimeout(() => host.send('workspace:changed', {}), 40)
  }
  const ctx = createHandlerContext(host, services)
  const methods = registerHandlers(ctx)

  return {
    invoke(method: unknown, args: unknown): unknown {
      if (typeof method !== 'string' || !Object.hasOwn(methods, method))
        throw new Error(`Unknown method ${String(method)}`)
      const m = methods[method]!
      const parsed = m.args.safeParse(args)
      // People see this message, so it must read as a sentence rather than as a list of schema issues.
      if (!parsed.success) throw new Error(describeValidationError(parsed.error))
      const run = () => {
        try {
          const value = checked(method, m.run(...parsed.data))
          return value instanceof Promise
            ? value.catch((error) => {
                services.diagnostics?.record('service-error', error)
                throw error
              })
            : value
        } catch (error) {
          services.diagnostics?.record('service-error', error)
          throw error
        }
      }
      const label = operationLabels[method]
      let detail: string | undefined
      if (label && method.startsWith('git.') && typeof parsed.data[1] === 'string') {
        try {
          detail = workspace.getRepository(parsed.data[1]).name
        } catch {}
      }
      const result = label ? ctx.activity.run(label, detail, run) : run()
      if (!WORKSPACE_MUTATIONS.test(method)) return result
      // Every connected client (desktop windows, paired phones) reloads its project and chat lists from this.
      if (result instanceof Promise)
        return result.then((value) => {
          announceWorkspaceChange()
          return value
        })
      announceWorkspaceChange()
      return result
    },
    close() {
      ctx.workspace.settingsStore?.close()
      ctx.providers.close()
      ctx.updates.close()
      ctx.awake.close()
      ctx.watchers.close()
    },
  }
}

/**
 * Under tests, every answer is checked against the result its method declares, after the trip through JSON a client
 * sees, so a handler and its declared type cannot drift apart unnoticed. Clients check the same in production.
 */
function checked(method: string, value: unknown): unknown {
  if (!process.env.VITEST || process.env.RAMU_RESULT_CHECKS === '0') return value
  const check = (result: unknown) => {
    checkRpcResult(RPC_RESULTS, method, result === undefined ? undefined : JSON.parse(JSON.stringify(result)))
    return result
  }
  return value instanceof Promise ? value.then(check) : check(value)
}
