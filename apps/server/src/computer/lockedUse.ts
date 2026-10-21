import { execFile, spawn } from 'node:child_process'
import { ocuExecutable } from './ocu'

export interface LockedUseStatus {
  /** Whether Open Computer Use is installed at all. */
  installed: boolean
  enabled: boolean
  /** True when the agent can work through a locked screen right now. */
  available: boolean
  stage: string
  /** `unlocked`, `locked` or another state the system reports. */
  session: string
  clientApproved: boolean
  blockers: string[]
}

type Exec = (file: string, args: string[], timeoutMs: number) => Promise<string>
const execute: Exec = (file, args, timeoutMs) =>
  new Promise((resolve, reject) =>
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) =>
        error ? reject(new Error(stderr.trim() || stdout.trim() || error.message)) : resolve(stdout),
    ),
  )

export function parseLockedUse(output: string): LockedUseStatus {
  const raw = JSON.parse(output) as Record<string, unknown>
  const session = raw.session as { state?: unknown } | undefined
  return {
    installed: true,
    enabled: raw.enabled === true,
    available: raw.available === true,
    stage: typeof raw.stage === 'string' ? raw.stage : 'unknown',
    session: typeof session?.state === 'string' ? session.state : 'unknown',
    clientApproved: raw.clientApproved === true,
    blockers: Array.isArray(raw.blockers)
      ? raw.blockers.filter((entry): entry is string => typeof entry === 'string')
      : [],
  }
}

const MISSING: LockedUseStatus = {
  installed: false,
  enabled: false,
  available: false,
  stage: 'not-installed',
  session: 'unknown',
  clientApproved: false,
  blockers: ['Install Open Computer Use first.'],
}

/**
 * Open Computer Use's Locked Use lets an approved client work while the Mac is locked. Installing it adds signed
 * components to macOS sign-in, so it needs an administrator password at the Mac and is only ever started by the person.
 */
export class LockedUse {
  constructor(
    private readonly executable: () => string | null = ocuExecutable,
    private readonly exec: Exec = execute,
    private readonly start: (file: string, args: string[]) => void = (file, args) => {
      const child = spawn(file, args, { stdio: 'ignore', detached: true })
      child.on('error', () => {})
      child.unref()
    },
  ) {}

  async status(): Promise<LockedUseStatus> {
    const ocu = this.executable()
    if (!ocu || process.platform !== 'darwin') return MISSING
    try {
      return parseLockedUse(await this.exec(ocu, ['locked-use', 'status', '--json'], 20_000))
    } catch (error) {
      return {
        ...MISSING,
        installed: true,
        blockers: [error instanceof Error ? error.message : 'Could not read Locked Use status.'],
      }
    }
  }

  /**
   * Starts the installer, which opens macOS's own permission and administrator prompts on the Mac and can take as long as
   * the person does. Returns at once; poll `status` until it is enabled or the blockers say what is left.
   */
  async enable(): Promise<LockedUseStatus> {
    const ocu = this.executable()
    if (!ocu) throw new Error('Install Open Computer Use first.')
    this.start(ocu, ['locked-use', 'enable'])
    return this.status()
  }

  async disable(): Promise<LockedUseStatus> {
    const ocu = this.executable()
    if (!ocu) throw new Error('Install Open Computer Use first.')
    await this.exec(ocu, ['locked-use', 'disable'], 5 * 60_000)
    return this.status()
  }
}
