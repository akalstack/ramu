import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { defineAdapter, LONG_CONTEXT_TOKENS, npmLatest, runCli } from '../adapter'

/** The login's email and ChatGPT plan, from the ID token Codex keeps; the plan is as of Codex's last token refresh. */
function codexLogin(env: NodeJS.ProcessEnv): { email?: string; plan?: string } {
  try {
    const file = JSON.parse(readFileSync(join(env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'))
    const claims = JSON.parse(Buffer.from(String(file?.tokens?.id_token).split('.')[1] ?? '', 'base64url').toString())
    const plan = claims?.['https://api.openai.com/auth']?.chatgpt_plan_type
    return {
      ...(typeof claims.email === 'string' && claims.email ? { email: claims.email } : {}),
      ...(typeof plan === 'string' && plan ? { plan } : {}),
    }
  } catch {
    return {}
  }
}

export const codexAdapter = defineAdapter({
  id: 'codex',
  browser: { integratedTools: true, providerBrowser: true, canSuppressNative: false },
  selectionTransition: { type: 'restart-and-resume' },
  binaryEnvVar: 'RAMU_CODEX_BIN',
  executableNames: () => ['codex'],
  managedBinary(runtimeHome) {
    const managed = join(runtimeHome, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex')
    return existsSync(managed) ? managed : null
  },
  accountEnv: (root) => ({ CODEX_HOME: root }),
  accountClearedEnv: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
  setup: () => ({
    docsUrl: 'https://developers.openai.com/codex/cli/',
    installCommand: 'npm install -g @openai/codex@latest',
    updateCommand: 'npm install -g @openai/codex@latest',
    setupCommand: 'codex login',
    setupNote: 'Install with npm, then sign in with your ChatGPT account or configure your API key.',
  }),
  latestRelease: npmLatest(() => '@openai/codex'),
  async signInState(binary, env) {
    const { ok, out } = await runCli(binary, ['login', 'status'], env)
    return ok && /logged in/i.test(out)
      ? {
          signedIn: true,
          ...codexLogin(env),
          ...(/api key/i.test(out) ? { apiKey: true } : {}),
          detail:
            out
              .trim()
              .split('\n')[0]!
              .replace(/^logged in( using)?\s*/i, '') || undefined,
        }
      : { signedIn: false }
  },
  loginArgs: ['login'],
  // The app-server reads the key from Codex's own login file, so it is saved there; the key travels on stdin only.
  storeApiKey: ({ binary, env, key }) =>
    new Promise((resolve, reject) => {
      const child = execFile(
        binary,
        key === null ? ['logout'] : ['login', '--with-api-key'],
        { timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true, env },
        (error) => (error ? reject(new Error('Codex did not accept the API key.')) : resolve()),
      )
      child.stdin?.end(key === null ? '' : `${key}\n`)
    }),
  native: {
    blockingQuestions: true,
    // tool_search is always on in the app-server and always defers MCP tools.
    toolSearch: true,
    // Built-in tools of the app-server. Image generation depends on the login and model: the check decides.
    abilities: [
      { ability: 'image_generation', via: { tool: 'image_gen' } },
      { ability: 'image_edit', via: { tool: 'image_gen' } },
      { ability: 'web_search', via: { tool: 'web_search' } },
      { ability: 'long_context', via: { contextWindow: LONG_CONTEXT_TOKENS } },
      { ability: 'vision', via: { input: 'image' } },
    ],
  },
  // The ACP adapter takes no skill roots from the client, but Codex scans `.agents/skills` in the chat's folder.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.agents', 'skills')] : [] }),
  // Only Ramu's own npm copy can install an exact release; `codex update` always takes the newest.
  pinsVersion: (binary, runtimeHome) => binary.startsWith(runtimeHome),
  updatePlan({ config, binary, findExecutable, runtimeHome, version }) {
    const own = findExecutable(binary)
    if (!own) throw new Error('Select an installed CLI before updating it.')
    if (config.codex?.binary?.trim() || process.env.RAMU_CODEX_BIN)
      throw new Error('Update this custom Codex installation with its package manager.')
    const npm = findExecutable(process.platform === 'win32' ? 'npm.cmd' : 'npm')
    // Codex's own updater knows how it was installed (standalone, Homebrew or npm) and updates it in place, needing
    // no Node.js for a standalone install. An npm-installed Codex sits beside the `node` its updater runs.
    if (!binary.startsWith(runtimeHome))
      return { command: own, args: ['update'], pathDirs: [dirname(own), ...(npm ? [dirname(npm)] : [])] }
    if (!npm)
      throw new Error(
        'This Codex copy is updated with npm, and npm was not found. Install Node.js, or install Codex yourself and Ramu will use it.',
      )
    // Ramu's own npm copy, kept apart from any global installation npm's prefix would pick. Running threads keep going.
    return {
      command: npm,
      args: ['install', '--prefix', runtimeHome, '--no-audit', '--no-fund', `@openai/codex@${version ?? 'latest'}`],
      pathDirs: [dirname(npm)],
    }
  },
})
