import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { defineAdapter, parseProviderVersion, type PendingSignIn } from '../adapter'
import { newerVersion } from '@ramu/shared/version'
import { antigravityTarget, ANTIGRAVITY_MANIFESTS, resolveAntigravityAsset } from '../antigravityRelease'
import { recordOutput } from '../exitReason'
import { antigravityKeyName, antigravitySignInProblem } from '@ramu/shared/providers/environment'

/** Google's Antigravity CLI (`agy`), which serves ACP as `agy acp`. Older releases have no `acp` command. */
export const ANTIGRAVITY_CLI_MIN = '1.5.0'
/** Where the CLI keeps a login's settings and credentials, beneath its Gemini folder; the runtime Ramu used before shares it. */
export const ANTIGRAVITY_APP_DATA = 'antigravity-acp'
/** Ramu's record that a browser sign-in was made with the CLI, whose credentials the older runtime's cannot stand in for. */
const CLI_SIGN_IN = 'ramu-sign-in.json'

/** The CLI's file name in Ramu's own runtime folder. */
export const antigravityCliName = () => (process.platform === 'win32' ? 'agy.exe' : 'agy')
/** The runtime Ramu downloaded before the CLI served ACP, kept running until it is updated. */
export const legacyAntigravityNames = () =>
  process.platform === 'win32'
    ? { executable: 'agy_acp_server.exe', harness: 'localharness_external.exe' }
    : { executable: 'agy_acp_server.par', harness: 'localharness_external' }

/** The CLI is the only form with an `acp` command; anything else is the older ACP runtime with its harness helper. */
export const isAntigravityCli = (binary: string) =>
  /^(?:agy|antigravity)(?:\.(?:exe|cmd|bat))?$/i.test(binary.split(/[\\/]/).pop() ?? '')

export interface ManagedAntigravity {
  executable: string
  version: string
  /** Set only for the older runtime, which needs its helper beside it. */
  harness?: string
}
/** The runtime Ramu downloaded itself: `active.json` names the version directory that holds it. */
export function managedAntigravityAt(home: string): ManagedAntigravity | null {
  try {
    const version = JSON.parse(readFileSync(join(home, 'active.json'), 'utf8'))?.version
    if (typeof version !== 'string' || !/^[\w.-]{1,40}$/.test(version)) return null
    const directory = join(home, 'versions', version)
    const cli = join(directory, antigravityCliName())
    if (existsSync(cli)) return { executable: cli, version }
    const legacy = legacyAntigravityNames()
    const executable = join(directory, legacy.executable),
      harness = join(directory, legacy.harness)
    return existsSync(executable) && existsSync(harness) ? { executable, harness, version } : null
  } catch {
    return null
  }
}

const cliVersions = new Map<string, { stamp: string; version: string | null }>()
/** The version an `agy` on this computer reports, read once per file change: it takes a third of a second. */
export function antigravityCliVersion(binary: string): string | null {
  let stamp: string
  try {
    const info = statSync(binary)
    stamp = `${info.size}:${info.mtimeMs}`
  } catch {
    return null
  }
  const known = cliVersions.get(binary)
  if (known?.stamp === stamp) return known.version
  let version: string | null = null
  try {
    version = parseProviderVersion(
      execFileSync(binary, ['--version'], { timeout: 5000, encoding: 'utf8', windowsHide: true, stdio: 'pipe' }),
    )
  } catch {}
  cliVersions.set(binary, { stamp, version })
  return version
}
/** An `agy` new enough to serve ACP. */
export const servesAcp = (binary: string) => {
  const version = antigravityCliVersion(binary)
  return !!version && !newerVersion(ANTIGRAVITY_CLI_MIN, version)
}

const geminiHome = (env: NodeJS.ProcessEnv) => env.GEMINI_HOME || join(homedir(), '.gemini')
const appData = (env: NodeJS.ProcessEnv) => join(geminiHome(env), ANTIGRAVITY_APP_DATA)
/** How Ramu starts a runtime as an ACP server: the CLI is told where this login keeps its files. */
export function antigravityArgs(binary: string, env: NodeJS.ProcessEnv): string[] {
  if (isAntigravityCli(binary)) return ['acp', '--gemini-dir', geminiHome(env), '--app-data-dir', ANTIGRAVITY_APP_DATA]
  return process.platform === 'linux' ? ['--uid='] : []
}

/** Where Google sends a CLI browser sign-in; the page shows a code to paste back. */
const CODE_REDIRECT = 'https://antigravity.google/oauth-callback'
/** Google's sign-in link as the CLI prints it, or null for anything else. */
export function antigravitySignInUrl(line: string): { url: string; state: string } | null {
  const text = line.trim()
  if (text.length > 16_384 || /\s/.test(text)) return null
  try {
    const url = new URL(text)
    const state = url.searchParams.get('state') ?? ''
    if (
      url.origin !== 'https://accounts.google.com' ||
      !url.pathname.startsWith('/o/oauth2/') ||
      url.username ||
      url.password ||
      url.searchParams.get('redirect_uri') !== CODE_REDIRECT ||
      url.searchParams.get('response_type') !== 'code'
    )
      return null
    return { url: url.href, state }
  } catch {
    return null
  }
}
/** What the sign-in page gave the person: its code, or the page's own address for this same sign-in. Null otherwise. */
export function antigravitySignInCode(response: string, state: string): string | null {
  const value = response.trim()
  if (/^[\w./~-]{1,2048}$/.test(value)) return value
  if (value.length > 16_384 || /\s/.test(value)) return null
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}` === CODE_REDIRECT &&
      !url.username &&
      !url.password &&
      url.searchParams.get('state') === state &&
      !!url.searchParams.get('code')
      ? value
      : null
  } catch {
    return null
  }
}

/** Starts the CLI's own browser sign-in and hands back its link; the code from Google's page finishes it. */
function cliSignIn(binary: string, env: NodeJS.ProcessEnv, timeoutMs = 10 * 60_000): Promise<PendingSignIn> {
  const child = spawn(binary, [...antigravityArgs(binary, env), '--login'], {
    cwd: homedir(),
    env,
    stdio: 'pipe',
    windowsHide: true,
  })
  const output = recordOutput(child.stderr)
  let said = ''
  child.stdout.on('data', (chunk: Buffer) => {
    said = (said + chunk.toString()).slice(-400)
  })
  child.stdin.on('error', () => {})
  const ended = new Promise<number | null>((resolve) => {
    child.once('error', () => resolve(-1))
    child.once('close', (code) => resolve(code))
  })
  const stop = () => {
    if (child.exitCode !== null || child.signalCode) return
    child.kill()
    const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
    kill.unref()
  }
  const timer = setTimeout(stop, timeoutMs)
  timer.unref()
  void ended.then(() => clearTimeout(timer))
  const why = () => {
    const last = (output.last() || said.trim().split('\n').pop() || '').trim()
    return last ? ` ${last.slice(0, 200)}` : ''
  }
  return new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      const link = antigravitySignInUrl(line)
      if (!link) return
      lines.close()
      resolve({
        url: link.url,
        async complete(response) {
          const code = antigravitySignInCode(response, link.state)
          if (!code) throw new Error('Paste the code from the Antigravity page, or that page’s full address.')
          child.stdin.end(`${code}\n`)
          const exit = await ended
          if (exit !== 0) throw new Error(`Google did not accept the code. Start the sign-in again.${why()}`)
        },
        cancel: stop,
      })
    })
    void ended.then((code) =>
      reject(
        new Error(
          code === -1
            ? 'Cannot start the Antigravity CLI.'
            : `The Antigravity CLI stopped before it gave a link.${why()}`,
        ),
      ),
    )
  })
}

export const antigravityAdapter = defineAdapter({
  id: 'antigravity',
  browser: { integratedTools: true, providerBrowser: true, canSuppressNative: false },
  selectionTransition: { type: 'restart-and-resume' },
  binaryEnvVar: 'RAMU_ANTIGRAVITY_BIN',
  // An `agy` you installed is used before the older runtime; a copy too old to serve ACP is passed over.
  executableNames: () => ['agy', legacyAntigravityNames().executable],
  usable: (binary) => !isAntigravityCli(binary) || servesAcp(binary),
  managedBinary: (runtimeHome) => managedAntigravityAt(runtimeHome)?.executable ?? null,
  accountEnv: (root) => ({ GEMINI_HOME: root, AGY_ACP_FORCE_FILE_STORAGE: '1' }),
  accountClearedEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  launchArgs: antigravityArgs,
  extendEnvironment(env, { overrides, binary, expand }) {
    const runtime = binary()
    if (isAntigravityCli(runtime))
      return {
        ...env,
        // The CLI keeps a Google login in one OS keyring entry shared by every login unless it believes it runs over SSH;
        // then each login keeps its own file, and Ramu never needs Keychain permission.
        SSH_CONNECTION: env.SSH_CONNECTION || '127.0.0.1 0 127.0.0.1 0',
        // Ramu updates the CLI itself, so a running chat never has its executable replaced underneath it.
        AGY_CLI_DISABLE_AUTO_UPDATE: '1',
      }
    const custom = overrides.antigravity?.harness?.trim()
    const sibling = join(dirname(runtime), legacyAntigravityNames().harness)
    const helper = custom
      ? expand(custom)
      : process.env.ANTIGRAVITY_HARNESS_PATH || (existsSync(sibling) ? sibling : undefined)
    // The login is saved in a file, never the macOS Keychain, so Ramu never needs Keychain permission.
    return {
      ...env,
      AGY_ACP_FORCE_FILE_STORAGE: env.AGY_ACP_FORCE_FILE_STORAGE ?? '1',
      ...(helper ? { ANTIGRAVITY_HARNESS_PATH: helper } : {}),
    }
  },
  setup: () => ({
    docsUrl: 'https://antigravity.google/docs/ide/extensions',
    installCommand: null,
    updateCommand: null,
    setupCommand: null,
    setupNote:
      "Ramu uses the Antigravity CLI (agy 1.5 or newer) you installed, or downloads Google's official CLI for you with Install runtime. Then choose Login and pick a Google account, Gemini Enterprise, a Gemini API key or Agent Platform. To use another copy, select its agy executable under Advanced. The Antigravity IDE is a separate application.",
  }),
  async latestRelease(_current, fetchText) {
    const target = antigravityTarget()
    if (!target) return {}
    const asset = resolveAntigravityAsset(JSON.parse(await fetchText(`${ANTIGRAVITY_MANIFESTS}/${target}.json`)))
    return asset ? { version: asset.version, downloadUrl: asset.url } : {}
  },
  // ACP initialize reports the runtime version without starting a chat or authenticating.
  probeVersion: (binary, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, antigravityArgs(binary, env), {
        cwd: homedir(),
        env,
        stdio: 'pipe',
        windowsHide: true,
      })
      child.stderr.resume()
      child.stdin.on('error', () => {})
      const lines = createInterface({ input: child.stdout })
      let settled = false
      const finish = (value: string | null, error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        lines.close()
        child.kill()
        const kill = setTimeout(() => child.kill('SIGKILL'), 1000)
        kill.unref()
        child.once('exit', () => clearTimeout(kill))
        error ? reject(error) : resolve(value)
      }
      const timer = setTimeout(
        () =>
          finish(
            null,
            new Error(
              isAntigravityCli(binary)
                ? 'The Antigravity CLI did not report its version. Update it to agy 1.5 or newer.'
                : 'ACP runtime did not report its version. Check the helper path.',
            ),
          ),
        isAntigravityCli(binary) ? 30_000 : 5000,
      )
      child.once('error', () => finish(null, new Error('Cannot start the ACP runtime.')))
      child.once('exit', () => finish(null, new Error('ACP runtime stopped before reporting its version.')))
      lines.on('line', (line) => {
        try {
          const message = JSON.parse(line)
          if (message.id === 1) finish(parseProviderVersion(message.result?.agentInfo?.version ?? ''))
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
    }),
  async signInState(binary, env) {
    try {
      const type = JSON.parse(readFileSync(join(appData(env), 'settings.json'), 'utf8'))?.auth?.type
      if (typeof type !== 'string' || !type) return { signedIn: false }
      // A browser login made with the older runtime is not one the CLI can use; it asks for a new sign-in.
      if (isAntigravityCli(binary) && (type === 'oauth-personal' || type === 'oauth-business')) {
        let method: unknown
        try {
          method = JSON.parse(readFileSync(join(appData(env), CLI_SIGN_IN), 'utf8'))?.method
        } catch {}
        if (method !== type) return { signedIn: false, detail: type }
      }
      return { signedIn: true, detail: type }
    } catch {
      return { signedIn: false }
    }
  },
  loginArgs: null,
  // The ACP runtime scans `<cwd>/.gemini/skills` and `<cwd>/.agents/skills`; the first is Antigravity's own, so other agents that read `.agents` do not pick the links up.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.gemini', 'skills')] : [] }),
  async signIn({ installed, binary, accountId, acpSignIn, env, method }) {
    if (!installed) throw new Error('Install the Antigravity CLI first.')
    const chosen = method ?? { method: 'oauth-personal' as const }
    const problem = antigravitySignInProblem(chosen, !!env[antigravityKeyName(chosen.method)])
    if (problem) throw new Error(problem)
    // The runtime reads the method and the Google Cloud project from its own settings; keys stay in the environment.
    const dir = appData(env)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const project = chosen.gcpProject?.trim(),
      location = chosen.gcpLocation?.trim()
    const file = join(dir, 'settings.json'),
      record = join(dir, CLI_SIGN_IN)
    const previous = existsSync(file) ? readFileSync(file, 'utf8') : null
    writeFileSync(
      file,
      JSON.stringify({
        auth: { type: chosen.method },
        ...(project || location ? { gcp: { ...(project ? { project } : {}), ...(location ? { location } : {}) } } : {}),
      }),
      { mode: 0o600 },
    )
    // A failed sign-in must not read as signed in with the new method.
    const restore = () => {
      if (previous === null) rmSync(file, { force: true })
      else writeFileSync(file, previous, { mode: 0o600 })
    }
    const browser = chosen.method === 'oauth-personal' || chosen.method === 'oauth-business'
    if (browser && isAntigravityCli(binary)) {
      rmSync(record, { force: true })
      const pending = await cliSignIn(binary, env).catch((error) => {
        restore()
        throw error
      })
      return {
        url: pending.url,
        async complete(code) {
          try {
            await pending.complete(code)
            writeFileSync(record, JSON.stringify({ method: chosen.method }), { mode: 0o600 })
          } catch (error) {
            pending.cancel()
            restore()
            throw error
          }
        },
        cancel() {
          pending.cancel()
          restore()
        },
      }
    }
    try {
      await acpSignIn('antigravity', chosen.method, accountId)
    } catch (error) {
      restore()
      throw error
    }
  },
  updatePlan({ config, binary, findExecutable, installRuntime, runtimeHome }) {
    const custom = config.antigravity?.binary?.trim() || process.env.RAMU_ANTIGRAVITY_BIN
    const managed = binary.startsWith(runtimeHome)
    // An `agy` you installed updates itself, even one too old to serve ACP yet, so no second copy is downloaded.
    const own = custom
      ? isAntigravityCli(binary) && findExecutable(binary)
      : !managed && (isAntigravityCli(binary) ? findExecutable(binary) : findExecutable('agy'))
    if (own) return { command: own, args: ['update'] }
    if (custom)
      throw new Error('Update this custom Antigravity runtime yourself, or clear its path to let Ramu manage it.')
    return { install: installRuntime }
  },
})
