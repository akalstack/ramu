// Downloads Google's Antigravity CLI so nobody has to install it by hand.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, lstatSync, statSync } from 'node:fs'
import { chmod, copyFile, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { recordOutput } from './exitReason'
import { antigravityArgs, antigravityCliName } from './adapters/antigravity'
import { managedAntigravity, providerRuntimeHome } from './providerBinaries'
import {
  ANTIGRAVITY_MANIFESTS,
  antigravityTarget,
  resolveAntigravityAsset,
  type AntigravityAsset,
} from './antigravityRelease'

export { resolveAntigravityAsset, type AntigravityAsset }
const MAX_DOWNLOAD_BYTES = 512 * 1024 ** 2
/** A download that receives nothing for this long is dropped and resumed, rather than left hanging on a stalled connection. */
export const STALL_MS = 60_000
/** Attempts per install; each resumes where the last one stopped, so a slow or flaky connection still finishes. */
const ATTEMPTS = 6
export const PROBE_TIMEOUT_MS = 90_000

async function sha512Of(file: string): Promise<string> {
  const hash = createHash('sha512')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

const sizeOf = (file: string) => {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Downloads `url` into `file`, continuing from what `file` already holds. A dropped or stalled connection is retried
 * from where it stopped, and what was received survives a cancelled install for the next attempt.
 */
export async function downloadResumable(
  url: string,
  file: string,
  signal?: AbortSignal,
  options: { attempts?: number; stallMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? ATTEMPTS,
    stallMs = options.stallMs ?? STALL_MS
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    signal?.throwIfAborted()
    const have = sizeOf(file)
    const stall = new AbortController()
    let timer = setTimeout(() => stall.abort(new Error('The download stalled')), stallMs)
    const touch = () => {
      clearTimeout(timer)
      timer = setTimeout(() => stall.abort(new Error('The download stalled')), stallMs)
    }
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([stall.signal, ...(signal ? [signal] : [])]),
        headers: { 'User-Agent': 'Ramu-provider-install', ...(have ? { Range: `bytes=${have}-` } : {}) },
      })
      // Everything is already here; the checksum decides whether it is right.
      if (response.status === 416 && have) return
      if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
      const resumed = response.status === 206
      const total = resumed ? have : 0
      if (total + Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD_BYTES)
        throw new Error('The CLI download is larger than expected')
      let received = total
      const body = Readable.fromWeb(response.body as never)
      body.on('data', (chunk: Buffer) => {
        touch()
        received += chunk.length
        if (received > MAX_DOWNLOAD_BYTES) body.destroy(new Error('The CLI download is larger than expected'))
      })
      await pipeline(body, createWriteStream(file, { flags: resumed ? 'a' : 'w', mode: 0o600 }), {
        signal: AbortSignal.any([stall.signal, ...(signal ? [signal] : [])]),
      })
      return
    } catch (error) {
      if (signal?.aborted) throw signal.reason
      if ((error as Error).message === 'The CLI download is larger than expected') throw error
      lastError = stall.signal.aborted ? stall.signal.reason : error
    } finally {
      clearTimeout(timer)
    }
    await new Promise((resolve) => setTimeout(resolve, (options.retryDelayMs ?? 2000) * attempt))
  }
  throw new Error(
    `The download did not finish after ${attempts} tries. What arrived is kept, so Install runtime continues from there. ${(lastError as Error)?.message ?? ''}`.trim(),
  )
}

function run(command: string, args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out = (out + chunk.toString()).slice(-64 * 1024)
    })
    const abort = () => child.kill()
    signal?.addEventListener('abort', abort, { once: true })
    child.once('error', () => reject(new Error(`Cannot unpack the CLI. Install ${command} and try again.`)))
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(signal.reason)
      else if (code === 0) resolve(out)
      else reject(new Error('The CLI archive could not be unpacked'))
    })
  })
}

/** Unpacks the one executable a release archive holds; an archive with anything else in it is refused. */
async function unpack(archive: string, into: string, signal?: AbortSignal): Promise<string> {
  const listed = (await run('tar', ['-tzf', archive], signal)).trim().split(/\r?\n/)
  const name = listed[0]?.replace(/^\.\//, '')
  if (listed.length !== 1 || !name || !/^[\w.-]+$/.test(name))
    throw new Error('The CLI archive must hold one executable')
  await run('tar', ['-xzf', archive, '-C', into, listed[0]!], signal)
  const file = join(into, name)
  const info = existsSync(file) ? lstatSync(file) : null
  if (!info?.isFile() || info.size <= 0) throw new Error('The CLI archive must hold one executable')
  return file
}

/** Starts the CLI as an ACP server and waits for it to name itself, so a broken download never becomes the active one. */
export function probeAntigravity(
  executable: string,
  version: string | null,
  timeoutMs = PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
  profile?: string,
): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const home = profile ?? join(executable, '..', '.probe')
    const env = {
      ...process.env,
      GEMINI_HOME: home,
      AGY_CLI_DISABLE_AUTO_UPDATE: '1',
      SSH_CONNECTION: '127.0.0.1 0 127.0.0.1 0',
    }
    const child = spawn(executable, antigravityArgs(executable, env), {
      cwd: join(executable, '..'),
      env,
      stdio: 'pipe',
      windowsHide: true,
    })
    // What the CLI said before it went quiet is the only clue to why it did not answer.
    const output = recordOutput(child.stderr)
    const why = () => (output.last() ? ` Last output: ${output.last()}` : '')
    child.stdin.on('error', () => {})
    const lines = createInterface({ input: child.stdout })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', abort)
      clearTimeout(timer)
      lines.close()
      child.kill()
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      kill.unref()
      void rm(home, { recursive: true, force: true }).catch(() => {})
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `The downloaded CLI did not answer within ${Math.round(timeoutMs / 1000)} seconds. It may not match this host.${why()}`,
          ),
        ),
      timeoutMs,
    )
    const abort = () => finish(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.once('error', () => finish(new Error('The downloaded CLI cannot start on this host.')))
    child.once('close', () => finish(new Error(`The downloaded CLI stopped before answering.${why()}`)))
    lines.on('line', (line) => {
      try {
        const message = JSON.parse(line)
        if (message.id !== 1) return
        const info = message.result?.agentInfo
        if (info?.name !== 'Antigravity ACP Server' || (version && info.version !== version))
          finish(new Error('The downloaded CLI did not identify as the expected Antigravity release.'))
        else finish()
      } catch {}
    })
    child.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: 1, clientInfo: { name: 'ramu', version: '0.0.1' }, clientCapabilities: {} },
      }) + '\n',
    )
  })
}

export interface AntigravityInstallOptions {
  signal?: AbortSignal
  asset?: AntigravityAsset
  download?: (url: string, file: string, signal?: AbortSignal) => Promise<void>
  probe?: (executable: string, version: string) => Promise<void>
}
/** Installs the newest CLI under Ramu's own directory and makes it the active one. A same-version install that is already complete is left alone. */
export async function installAntigravity(
  options: AntigravityInstallOptions = {},
): Promise<{ version: string; installed: boolean }> {
  const { signal } = options
  signal?.throwIfAborted()
  let asset = options.asset
  if (!asset) {
    const target = antigravityTarget()
    if (!target) throw new Error('Google does not publish the Antigravity CLI for this host.')
    const response = await fetch(`${ANTIGRAVITY_MANIFESTS}/${target}.json`, {
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      headers: { 'User-Agent': 'Ramu-provider-install' },
    })
    if (!response.ok) throw new Error(`Release source returned HTTP ${response.status}`)
    asset = resolveAntigravityAsset(await response.json()) ?? undefined
  }
  signal?.throwIfAborted()
  if (!asset) throw new Error('Google does not publish the Antigravity CLI for this host.')
  const active = managedAntigravity()
  if (active?.version === asset.version && !active.harness) return { version: asset.version, installed: false }
  const home = providerRuntimeHome('antigravity')
  await mkdir(join(home, 'downloads'), { recursive: true, mode: 0o700 })
  // Named by the checksum, so a partial download only ever continues the same file.
  const archive = join(home, 'downloads', `${asset.version}-${asset.sha512.slice(0, 16)}.part`)
  for (const old of await readdir(join(home, 'downloads')))
    if (join(home, 'downloads', old) !== archive) await rm(join(home, 'downloads', old), { force: true })
  await (options.download ?? downloadResumable)(asset.url, archive, signal)
  signal?.throwIfAborted()
  if ((await sha512Of(archive)) !== asset.sha512) {
    await rm(archive, { force: true })
    throw new Error('The CLI download does not match the checksum Google published. Nothing was installed.')
  }
  const stage = await mkdtemp(join(home, '.stage-'))
  try {
    const unpacked = join(stage, 'files')
    await mkdir(unpacked)
    const executable = join(unpacked, antigravityCliName())
    if (asset.format === 'executable') await copyFile(archive, executable)
    else await rename(await unpack(archive, unpacked, signal), executable)
    if (process.platform !== 'win32') await chmod(executable, 0o755)
    signal?.throwIfAborted()
    if (options.probe) await options.probe(executable, asset.version)
    else await probeAntigravity(executable, asset.version, PROBE_TIMEOUT_MS, signal, join(stage, 'probe'))
    // Cancellation is honored up to activation; the short atomic activation finishes once started.
    signal?.throwIfAborted()
    const target = join(home, 'versions', asset.version)
    await mkdir(join(home, 'versions'), { recursive: true, mode: 0o700 })
    await rm(target, { recursive: true, force: true })
    await rename(unpacked, target)
    const record = join(stage, 'active.json')
    await writeFile(record, JSON.stringify({ version: asset.version, installedAt: new Date().toISOString() }), {
      mode: 0o600,
    })
    await rename(record, join(home, 'active.json'))
    await rm(archive, { force: true })
    // Keep the one before for rollback; chats already running keep their files either way.
    const keep = new Set([asset.version, active?.version])
    for (const old of await readdir(join(home, 'versions')))
      if (!keep.has(old)) await rm(join(home, 'versions', old), { recursive: true, force: true })
    return { version: asset.version, installed: true }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
