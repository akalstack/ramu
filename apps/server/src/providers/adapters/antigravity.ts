import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { defineAdapter, parseProviderVersion } from '../adapter'

/** The Antigravity runtime Ramu downloaded itself: `active.json` names the version directory that holds the executable and its helper. */
export const antigravityFileNames = () =>
  process.platform === 'win32'
    ? { executable: 'agy_acp_server.exe', harness: 'localharness_external.exe' }
    : { executable: 'agy_acp_server.par', harness: 'localharness_external' }
export function managedAntigravityAt(home: string): { executable: string; harness: string; version: string } | null {
  try {
    const version = JSON.parse(readFileSync(join(home, 'active.json'), 'utf8'))?.version
    if (typeof version !== 'string' || !/^[\w.-]{1,40}$/.test(version)) return null
    const names = antigravityFileNames(),
      directory = join(home, 'versions', version)
    const executable = join(directory, names.executable),
      harness = join(directory, names.harness)
    return existsSync(executable) && existsSync(harness) ? { executable, harness, version } : null
  } catch {
    return null
  }
}

export const antigravityAdapter = defineAdapter({
  id: 'antigravity',
  binaryEnvVar: 'RAMU_ANTIGRAVITY_BIN',
  executableNames: () => [process.platform === 'win32' ? 'agy_acp_server.exe' : 'agy_acp_server.par'],
  managedBinary: (runtimeHome) => managedAntigravityAt(runtimeHome)?.executable ?? null,
  accountEnv: (root) => ({ GEMINI_HOME: root }),
  accountClearedEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  extendEnvironment(env, { overrides, binary, expand }) {
    const custom = overrides.antigravity?.harness?.trim()
    const sibling = join(
      dirname(binary()),
      process.platform === 'win32' ? 'localharness_external.exe' : 'localharness_external',
    )
    const helper = custom
      ? expand(custom)
      : process.env.ANTIGRAVITY_HARNESS_PATH || (existsSync(sibling) ? sibling : undefined)
    return { ...env, ...(helper ? { ANTIGRAVITY_HARNESS_PATH: helper } : {}) }
  },
  setup: () => ({
    docsUrl: 'https://antigravity.google/docs/ide/extensions',
    installCommand: null,
    updateCommand: null,
    setupCommand: null,
    setupNote:
      "Ramu downloads Google's official ACP runtime for you: choose Install runtime, then Login (opens Google sign-in in your browser). To use your own copy, select agy_acp_server.par (or .exe) and its localharness_external helper under Advanced. The Antigravity IDE is a separate application.",
  }),
  async latestRelease(_current, fetchText) {
    const registry = JSON.parse(
      await fetchText('https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json'),
    )
    let downloadUrl: string | undefined
    const target = `${process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch === 'x64' ? 'x86_64' : process.arch === 'arm64' ? 'aarch64' : process.arch}`
    const archive = registry.distribution?.binary?.[target]?.archive
    if (typeof archive === 'string' && new URL(archive).origin === 'https://dl.google.com') downloadUrl = archive
    return { version: registry.version, ...(downloadUrl ? { downloadUrl } : {}) }
  },
  // ACP initialize reports the runtime version without starting a chat or authenticating.
  probeVersion: (binary, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(binary, process.platform === 'linux' ? ['--uid='] : [], {
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
        () => finish(null, new Error('ACP runtime did not report its version. Check the helper path.')),
        5000,
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
  async signInState(_binary, env) {
    try {
      const type = JSON.parse(
        readFileSync(join(env.GEMINI_HOME || join(homedir(), '.gemini'), 'antigravity-acp', 'settings.json'), 'utf8'),
      )?.auth?.type
      return typeof type === 'string' && type ? { signedIn: true, detail: type } : { signedIn: false }
    } catch {
      return { signedIn: false }
    }
  },
  loginArgs: null,
  // The ACP runtime scans `<cwd>/.gemini/skills` and `<cwd>/.agents/skills`; the first is Antigravity's own, so other agents that read `.agents` do not pick the links up.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.gemini', 'skills')] : [] }),
  async signIn({ installed, accountId, acpSignIn }) {
    if (!installed) throw new Error('Select the Antigravity ACP runtime first.')
    await acpSignIn('antigravity', 'oauth-personal', accountId)
  },
  updatePlan({ config, installRuntime }) {
    // Ramu downloads Google's official runtime itself; a runtime the user picked by path or env keeps its own updater.
    if (config.antigravity?.binary?.trim() || process.env.RAMU_ANTIGRAVITY_BIN)
      throw new Error('Update this custom Antigravity runtime yourself, or clear its path to let Ramu manage it.')
    return { install: installRuntime }
  },
})
