import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { git, parseStatus, topLevel } from '../workspace/git'
import { userEnvironment } from '../userEnvironment'

/** The uncommitted state of a repository: a content hash for every changed path, relative to the repository root. */
export interface WorkspaceSnapshot {
  root: string
  files: Record<string, string>
}
export interface VerifyResult {
  ok: boolean
  code: number | null
  timedOut: boolean
  /** The end of the combined output. */
  output: string
}
/** What goals need from the machine: git and a shell. Replaceable, so tests need no processes. */
export interface GoalProbes {
  /** Null when the folder is not in a git repository. */
  snapshot(cwd: string): Promise<WorkspaceSnapshot | null>
  verify(cwd: string, command: string, signal: AbortSignal): Promise<VerifyResult>
}

const MAX_FILES = 2000
const HASH_LIMIT = 8_000_000
const OUTPUT_KEEP = 24_000
export const VERIFY_TIMEOUT_MS = 10 * 60_000

async function hashFile(path: string): Promise<string> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return `kind:${info.isDirectory() ? 'dir' : 'other'}`
    // A huge file is told apart by size and time rather than read whole.
    if (info.size > HASH_LIMIT) return `big:${info.size}:${info.mtimeMs}`
    const handle = await open(path, 'r')
    try {
      return createHash('sha1')
        .update(await handle.readFile())
        .digest('hex')
    } finally {
      await handle.close()
    }
  } catch {
    return 'missing'
  }
}

async function gitSnapshot(cwd: string): Promise<WorkspaceSnapshot | null> {
  let root: string
  try {
    root = (await topLevel(cwd)).trim()
  } catch {
    return null
  }
  const entries = parseStatus(await git(root, ['status', '--porcelain=v2', '-z', '--untracked-files=all'])).entries
  const files: Record<string, string> = {}
  for (const entry of entries.slice(0, MAX_FILES)) files[entry.path] = await hashFile(join(root, entry.path))
  if (entries.length > MAX_FILES) files['*overflow'] = String(entries.length)
  return { root, files }
}

function runCommand(cwd: string, command: string, signal: AbortSignal): Promise<VerifyResult> {
  return new Promise((resolve) => {
    // Its own process group, so a timeout or Stop ends the whole test run and not only the shell around it.
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', env: userEnvironment() })
    let output = '',
      timedOut = false,
      settled = false
    const stop = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
    }
    const finish = (result: VerifyResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', stop)
      resolve(result)
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, VERIFY_TIMEOUT_MS)
    timer.unref()
    signal.addEventListener('abort', stop, { once: true })
    if (signal.aborted) stop()
    const collect = (chunk: Buffer) => {
      output = (output + chunk.toString('utf8')).slice(-OUTPUT_KEEP)
    }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.on('error', (error) =>
      finish({ ok: false, code: null, timedOut, output: `${output}\n${error.message}`.trim() }),
    )
    child.on('close', (code) => finish({ ok: code === 0 && !timedOut && !signal.aborted, code, timedOut, output }))
  })
}

export const realGoalProbes: GoalProbes = {
  snapshot: async (cwd) => {
    try {
      return await gitSnapshot(cwd)
    } catch {
      // A probe that cannot read the repository must not stop a goal from finishing.
      return null
    }
  },
  verify: runCommand,
}
