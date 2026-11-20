// Downloads Google's official Antigravity ACP runtime so nobody has to unpack it by hand.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, lstatSync } from 'node:fs'
import { chmod, mkdir, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { antigravityFileNames, managedAntigravity, providerRuntimeHome } from './providerBinaries'

export const ANTIGRAVITY_REGISTRY =
  'https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json'
const ARCHIVE_ORIGIN = 'https://dl.google.com'
const MAX_ARCHIVE_BYTES = 1024 ** 3
/** The runtime unpacks and compiles its Python on first launch, which takes minutes on a slow or Intel Mac; the install runs in the background, so waiting costs nothing. */
export const PROBE_TIMEOUT_MS = 5 * 60_000
export interface AntigravityAsset {
  version: string
  archive: string
  /** The archive's SHA-256 as the registry lists it; a download that does not match is never unpacked. */
  sha256?: string
}

/** The registry's archive for this platform. Only Google's download origin, plain version numbers and a listed checksum are trusted. */
export function resolveAntigravityAsset(
  registry: unknown,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch,
): AntigravityAsset | null {
  const entry = registry as {
    version?: unknown
    distribution?: { binary?: Record<string, { archive?: unknown; sha256?: unknown }> }
  } | null
  const target = `${platform === 'darwin' ? 'darwin' : platform === 'win32' ? 'windows' : 'linux'}-${arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : arch}`
  const archive = entry?.distribution?.binary?.[target]?.archive,
    sha256 = entry?.distribution?.binary?.[target]?.sha256,
    version = entry?.version
  if (typeof archive !== 'string' || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return null
  try {
    if (new URL(archive).origin !== ARCHIVE_ORIGIN) return null
  } catch {
    return null
  }
  return { version, archive, sha256: sha256.toLowerCase() }
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

async function downloadFile(url: string, file: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.any([AbortSignal.timeout(45 * 60_000), ...(signal ? [signal] : [])]),
    headers: { 'User-Agent': 'Ramu-provider-install' },
  })
  if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
  if (Number(response.headers.get('content-length') ?? 0) > MAX_ARCHIVE_BYTES)
    throw new Error('The runtime download is larger than expected')
  let received = 0
  const body = Readable.fromWeb(response.body as never)
  body.on('data', (chunk: Buffer) => {
    received += chunk.length
    if (received > MAX_ARCHIVE_BYTES) body.destroy(new Error('The runtime download is larger than expected'))
  })
  await pipeline(body, createWriteStream(file, { mode: 0o600 }), { signal })
}

function extract(archive: string, into: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  // bsdtar (Windows, macOS) and Info-ZIP unzip both refuse entries that climb out of the target directory.
  const [command, args] =
    process.platform === 'win32' ? ['tar', ['-xf', archive, '-C', into]] : ['unzip', ['-q', '-o', archive, '-d', into]]
  return new Promise((resolve, reject) => {
    const child = spawn(command!, args as string[], { stdio: 'ignore', windowsHide: true })
    const abort = () => {
      child.kill()
      const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
      kill.unref()
    }
    signal?.addEventListener('abort', abort, { once: true })
    child.once('close', () => signal?.removeEventListener('abort', abort))
    if (signal?.aborted) abort()
    child.once('error', () =>
      reject(new Error(`Cannot unpack the runtime. Install ${command === 'unzip' ? 'unzip' : 'tar'} and try again.`)),
    )
    child.once('close', (code) => {
      if (signal?.aborted) reject(signal.reason)
      else if (code === 0) resolve()
      else reject(new Error('The runtime archive could not be unpacked'))
    })
  })
}

/** Starts the runtime and waits for its ACP handshake, so a broken download never becomes the active version. */
export function probeAntigravity(
  executable: string,
  harness: string,
  timeoutMs = PROBE_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, process.platform === 'linux' ? ['--uid='] : [], {
      cwd: join(executable, '..'),
      env: { ...process.env, ANTIGRAVITY_HARNESS_PATH: harness },
      stdio: 'pipe',
      windowsHide: true,
    })
    // What the runtime said before it went quiet is the only clue to why it did not answer.
    let said = ''
    child.stderr.on('data', (chunk: Buffer) => {
      said = (said + chunk.toString()).slice(-400)
    })
    const why = () => {
      const last = said.trim().split('\n').pop()?.trim()
      return last ? ` Last output: ${last.slice(0, 200)}` : ''
    }
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
      error ? reject(error) : resolve()
    }
    const timer = setTimeout(
      () =>
        finish(
          new Error(
            `The downloaded runtime did not answer within ${Math.round(timeoutMs / 1000)} seconds. It may not match this host.${why()}`,
          ),
        ),
      timeoutMs,
    )
    const abort = () => finish(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.once('error', () => finish(new Error('The downloaded runtime cannot start on this host.')))
    child.once('close', () => finish(new Error(`The downloaded runtime stopped before answering.${why()}`)))
    lines.on('line', (line) => {
      try {
        if (JSON.parse(line).id === 1) finish()
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
  probe?: (executable: string, harness: string) => Promise<void>
}
/** Installs the newest runtime under Ramu's own directory and makes it the active one. A same-version install that is already complete is left alone. */
export async function installAntigravity(
  options: AntigravityInstallOptions = {},
): Promise<{ version: string; installed: boolean }> {
  const { signal } = options
  signal?.throwIfAborted()
  let asset = options.asset
  if (!asset) {
    const response = await fetch(ANTIGRAVITY_REGISTRY, {
      signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]),
      headers: { 'User-Agent': 'Ramu-provider-install' },
    })
    if (!response.ok) throw new Error(`Release source returned HTTP ${response.status}`)
    asset = resolveAntigravityAsset(await response.json()) ?? undefined
  }
  signal?.throwIfAborted()
  if (!asset) throw new Error('Google does not publish the Antigravity runtime for this host.')
  const active = managedAntigravity()
  if (active?.version === asset.version) return { version: asset.version, installed: false }
  const home = providerRuntimeHome('antigravity'),
    names = antigravityFileNames()
  await mkdir(home, { recursive: true, mode: 0o700 })
  const stage = await mkdtemp(join(home, '.stage-'))
  try {
    const archive = join(stage, 'runtime.zip'),
      unpacked = join(stage, 'files')
    await mkdir(unpacked)
    await (options.download ?? downloadFile)(asset.archive, archive, signal)
    signal?.throwIfAborted()
    if (asset.sha256 && (await sha256Of(archive)) !== asset.sha256)
      throw new Error('The runtime download does not match the checksum Google published')
    await extract(archive, unpacked, signal)
    signal?.throwIfAborted()
    for (const name of [names.executable, names.harness]) {
      const info = existsSync(join(unpacked, name)) ? lstatSync(join(unpacked, name)) : null
      if (!info?.isFile() || info.size <= 0) throw new Error(`The runtime archive is missing ${name}`)
      if (process.platform !== 'win32') await chmod(join(unpacked, name), 0o755)
    }
    const executable = join(unpacked, names.executable),
      harness = join(unpacked, names.harness)
    if (options.probe) await options.probe(executable, harness)
    else await probeAntigravity(executable, harness, PROBE_TIMEOUT_MS, signal)
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
    // Keep the one before for rollback; chats already running keep their files either way.
    const keep = new Set([asset.version, active?.version])
    for (const old of await readdir(join(home, 'versions')))
      if (!keep.has(old)) await rm(join(home, 'versions', old), { recursive: true, force: true })
    return { version: asset.version, installed: true }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
