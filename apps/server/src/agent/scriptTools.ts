// run_script: an agent calls many Shared MCP tools from one JavaScript snippet instead of one model turn per call.
// The snippet runs in QuickJS compiled to WebAssembly, so it reaches nothing on the host (no files, processes or
// network); its only way out is call(), which goes through the thread's Shared MCP gateway and its approvals.
import { z } from 'zod'
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core'
import variant from '@jitl/quickjs-wasmfile-release-sync'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

export interface ScriptLimits {
  timeoutMs: number
  maxCalls: number
  parallel: number
  outputChars: number
  memoryBytes: number
}
export const SCRIPT_LIMITS: ScriptLimits = {
  timeoutMs: 5 * 60_000,
  maxCalls: 500,
  parallel: 8,
  outputChars: 12_000,
  memoryBytes: 64 << 20,
}
export type ScriptCall = (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>
export interface ScriptReport {
  result?: unknown
  error?: string
  /** Every call the script made, by tool, also when it failed. */
  calls: Record<string, number>
  log?: string[]
}

let engine: Promise<QuickJSWASMModule> | undefined
const quickjs = () => (engine ??= newQuickJSWASMModuleFromVariant(variant))

const PRELUDE = `
globalThis.call = async (name, args) => JSON.parse(await __call(String(name), JSON.stringify(args ?? {})))
globalThis.log = (...parts) => __log(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' '))
`
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error)

/** Runs one snippet. Calls beyond `parallel` wait their turn; the run ends at `timeoutMs` or when `signal` aborts. */
export async function runScript(
  code: string,
  call: ScriptCall,
  signal: AbortSignal,
  limits: ScriptLimits = SCRIPT_LIMITS,
): Promise<ScriptReport> {
  const calls: Record<string, number> = {}
  const log: string[] = []
  const stop = new AbortController()
  const abort = () => stop.abort()
  signal.addEventListener('abort', abort, { once: true })
  const deadline = Date.now() + limits.timeoutMs
  const runtime = (await quickjs()).newRuntime()
  runtime.setMemoryLimit(limits.memoryBytes)
  runtime.setMaxStackSize(1 << 20)
  runtime.setInterruptHandler(() => Date.now() > deadline || stop.signal.aborted)
  const context = runtime.newContext()
  const pump = () => {
    if (!context.alive) return
    const pending = runtime.executePendingJobs()
    if ('error' in pending && pending.error) pending.error.dispose()
  }
  let made = 0
  let active = 0
  const queue: (() => void)[] = []
  const slot = () =>
    active < limits.parallel ? (active++, Promise.resolve()) : new Promise<void>((go) => queue.push(go))
  const release = () => (queue.length ? queue.shift()!() : active--)
  const bridge = context.newFunction('__call', (nameHandle, argsHandle) => {
    const name = context.getString(nameHandle)
    const deferred = context.newPromise()
    const finish = (settle: () => void) => {
      if (context.alive) settle()
      pump()
    }
    if (++made > limits.maxCalls) {
      const error = context.newError(`A script can make at most ${limits.maxCalls} calls`)
      deferred.reject(error)
      error.dispose()
      return deferred.handle
    }
    calls[name] = (calls[name] ?? 0) + 1
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(context.getString(argsHandle)) as Record<string, unknown>
    } catch {}
    void slot()
      .then(() => call(name, args, stop.signal))
      .then(
        (value) =>
          finish(() => {
            const text = context.newString(JSON.stringify(value ?? null))
            deferred.resolve(text)
            text.dispose()
          }),
        (error) =>
          finish(() => {
            const failure = context.newError(message(error))
            deferred.reject(failure)
            failure.dispose()
          }),
      )
      .finally(release)
    return deferred.handle
  })
  context.setProp(context.global, '__call', bridge)
  bridge.dispose()
  const logger = context.newFunction('__log', (line) => {
    if (log.length < 200) log.push(context.getString(line).slice(0, 2000))
  })
  context.setProp(context.global, '__log', logger)
  logger.dispose()

  // QuickJS reports its interrupt handler as a bare "interrupted"; say why it stopped instead.
  const why = (error: unknown) =>
    signal.aborted
      ? 'The script was stopped'
      : Date.now() > deadline
        ? `The script stopped after ${Math.round(limits.timeoutMs / 1000)} seconds`
        : message(error)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    context.unwrapResult(context.evalCode(PRELUDE, 'prelude.js')).dispose()
    const started = context.evalCode(`(async () => {\n${code}\n})()`, 'script.js')
    if (started.error) {
      const error = context.dump(started.error)
      started.error.dispose()
      return { error: why(error), calls, ...logged(log) }
    }
    const settled = context.resolvePromise(started.value)
    started.value.dispose()
    pump()
    const outcome = await Promise.race([
      settled,
      new Promise<'timeout'>((done) => (timer = setTimeout(() => done('timeout'), Math.max(deadline - Date.now(), 0)))),
      new Promise<'stopped'>((done) => stop.signal.addEventListener('abort', () => done('stopped'), { once: true })),
    ])
    if (outcome === 'timeout' || outcome === 'stopped') return { error: why(null), calls, ...logged(log) }
    if (outcome.error) {
      const error = context.dump(outcome.error)
      outcome.error.dispose()
      return { error: why(error), calls, ...logged(log) }
    }
    const result: unknown = context.dump(outcome.value)
    outcome.value.dispose()
    return { result: result ?? null, calls, ...logged(log) }
  } catch (error) {
    // A script stopped by the interrupt handler or out of memory lands here.
    return { error: why(error), calls, ...logged(log) }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
    stop.abort()
    try {
      context.dispose()
      runtime.dispose()
    } catch {
      // Calls still in flight hold handles; the engine is discarded with them.
    }
  }
}
const logged = (log: string[]) => (log.length ? { log } : {})

/** A Shared MCP tool's result as a script sees it: parsed JSON when the tool returned JSON, else its text. */
export function scriptValue(result: CallToolResult): unknown {
  const text = result.content
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('\n')
    .trim()
  if (result.isError) throw new Error(text || 'The tool failed')
  if (result.structuredContent) return result.structuredContent
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** The name a provider shows for a Shared MCP tool (`mcp__shared_mcp__x`, `shared_mcp.x`, `shared_mcp_x`) without its prefix. */
export const sharedToolName = (name: string) => name.replace(/^(?:mcp__)?shared_mcp(?:__|\.|_)/, '')

const DESCRIPTION = [
  'Call Shared MCP tools from JavaScript in one step instead of one call per turn: page through results, look up many items, filter and combine them, then `return` only what you need (output over 12,000 characters is cut). Use it when a task needs several Shared MCP calls; use your own tools for files and commands.',
  'The code is the body of an async function. `await call(name, args)` calls a Shared MCP tool by the name you see for it (the mcp__shared_mcp__ prefix is optional) and returns its parsed JSON; a failed or declined call throws. Promise.all runs calls in parallel. log(...) adds lines to the result.',
  'The script has no files, network or shell. Each call asks for approval like a direct call. The result lists every call made, also when the script fails.',
].join('\n')

/** Registers run_script for a chat; `call` is its Shared MCP gateway, by the provider-safe tool name. */
export function registerScriptTools(
  server: McpServer,
  call: (name: string, args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult>,
  limits: ScriptLimits = SCRIPT_LIMITS,
) {
  server.registerTool(
    'run_script',
    { description: DESCRIPTION, inputSchema: { code: z.string().min(1).max(20_000) } },
    async ({ code }, extra: { signal: AbortSignal }) => {
      const report = await runScript(
        code,
        async (name, args, signal) => scriptValue(await call(sharedToolName(name), args, signal)),
        extra.signal,
        limits,
      )
      let text = JSON.stringify(report, null, 1)
      if (text.length > limits.outputChars)
        text = `${text.slice(0, limits.outputChars)}\n… ${text.length - limits.outputChars} more characters cut. Return less: filter or summarize inside the script.`
      return { ...(report.error !== undefined ? { isError: true } : {}), content: [{ type: 'text' as const, text }] }
    },
  )
}
