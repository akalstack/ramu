import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'

type Wire = Record<string, any>

/** The slice of `TerminalService` the ACP client-terminal boundary uses. Commands stay host-owned background terminals. */
export interface AcpTerminalService {
  launchBackground(taskId: string, repoId: string | null, cwd: string, command: string): BackgroundTerminalInfo
  inspectBackground(taskId: string, id: string): BackgroundTerminalInfo & { output: string }
  stopBackground(taskId: string, id: string, force?: boolean): BackgroundTerminalInfo
}

export interface AcpTerminalScope {
  taskId: string
  repoId: string | null
  cwd: string
}

/** Methods an ACP runtime may call once the client advertises the `terminal` capability. */
export const ACP_TERMINAL_METHODS = new Set([
  'terminal/create',
  'terminal/output',
  'terminal/wait_for_exit',
  'terminal/kill',
  'terminal/release',
])

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Serves ACP `terminal/*` requests for one session through Ramu's own background-terminal service, so a command an
 * agent starts is listed, inspected and stopped by the person like any other. A terminal id is the background command's
 * id and only ids this session created are accepted. Commands run in the session's checkout: a `cwd` outside it is
 * refused. Releasing or killing asks the command's process group to end; nothing here force-stops.
 */
export class AcpTerminalHost {
  /** Terminal id to the number of ACP terminals using it: launching the same command twice returns the running one. */
  private readonly owned = new Map<string, number>()
  private readonly stopped = new AbortController()
  constructor(
    private readonly service: AcpTerminalService,
    private readonly scope: AcpTerminalScope,
  ) {}

  private own(params: Wire): string {
    const id = String(params.terminalId ?? '')
    if (!this.owned.get(id)) throw new Error(`Unknown terminal ${id}`)
    return id
  }

  private cwd(requested: unknown): string {
    if (requested === undefined || requested === null) return this.scope.cwd
    const real = (path: string) => {
      try {
        return realpathSync(path)
      } catch {
        return path
      }
    }
    const target = resolve(this.scope.cwd, String(requested))
    // Compare real paths, so a link inside the checkout cannot lead outside it.
    const rel = relative(real(this.scope.cwd), real(target))
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new Error('A terminal can only run inside this thread’s checkout.')
    return target
  }

  private command(params: Wire): string {
    const base = [String(params.command ?? ''), ...(Array.isArray(params.args) ? params.args.map(String) : [])]
    if (!base[0]?.trim()) throw new Error('A terminal needs a command.')
    const env = (Array.isArray(params.env) ? params.env : []) as { name?: unknown; value?: unknown }[]
    const assignments = env.map(({ name, value }) => {
      if (typeof name !== 'string' || !ENV_NAME.test(name)) throw new Error('Invalid environment variable name.')
      return `${name}=${quote(String(value ?? ''))}`
    })
    // A bare command string may already be a full shell line; with arguments each part is quoted.
    const line = base.length === 1 ? base[0] : base.map(quote).join(' ')
    return [...assignments, line].join(' ')
  }

  private exit(info: BackgroundTerminalInfo) {
    return info.state === 'running' || info.state === 'stopping' || info.state === 'unknown'
      ? undefined
      : { exitCode: info.exitCode, signal: null }
  }

  private output(id: string, limit?: number) {
    const info = this.service.inspectBackground(this.scope.taskId, id)
    const max = Number.isFinite(limit) && (limit as number) > 0 ? Math.floor(limit as number) : undefined
    const truncated = max !== undefined && info.output.length > max
    return {
      output: truncated ? info.output.slice(info.output.length - max!) : info.output,
      truncated: truncated || info.cursor > info.output.length,
      exitStatus: this.exit(info),
    }
  }

  /** Ends any waiting request when the session stops. Commands themselves keep running, as every background terminal does. */
  dispose() {
    this.stopped.abort()
  }

  async handle(method: string, params: Wire, signal: AbortSignal = this.stopped.signal): Promise<Wire> {
    switch (method) {
      case 'terminal/create': {
        const info = this.service.launchBackground(
          this.scope.taskId,
          this.scope.repoId,
          this.cwd(params.cwd),
          this.command(params),
        )
        this.owned.set(info.id, (this.owned.get(info.id) ?? 0) + 1)
        return { terminalId: info.id }
      }
      case 'terminal/output':
        return this.output(this.own(params), params.outputByteLimit)
      case 'terminal/wait_for_exit': {
        const id = this.own(params)
        for (;;) {
          const status = this.exit(this.service.inspectBackground(this.scope.taskId, id))
          if (status) return { exitCode: status.exitCode, signal: status.signal }
          if (signal?.aborted) throw new Error('Cancelled')
          await new Promise((done) => setTimeout(done, 200))
        }
      }
      case 'terminal/kill':
        this.service.stopBackground(this.scope.taskId, this.own(params))
        return {}
      case 'terminal/release': {
        const id = this.own(params)
        // The last terminal using a shared command is the one whose release ends it.
        const left = (this.owned.get(id) ?? 1) - 1
        if (left > 0) this.owned.set(id, left)
        else {
          this.owned.delete(id)
          this.service.stopBackground(this.scope.taskId, id)
        }
        return {}
      }
      default:
        throw new Error(`Unsupported terminal method: ${method}`)
    }
  }
}

let service: AcpTerminalService | undefined
/** Registered once by the server so a session can be given terminals without the runner knowing the host. */
export function setAcpTerminalService(next: AcpTerminalService | undefined) {
  service = next
}
export function acpTerminalHostFor(scope: AcpTerminalScope): AcpTerminalHost | undefined {
  return service ? new AcpTerminalHost(service, scope) : undefined
}
