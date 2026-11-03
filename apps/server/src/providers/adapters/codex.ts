import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineAdapter, npmLatest, runCli } from '../adapter'

/** The email in the signed-in ChatGPT token's claims. Only that claim is read; the token is never kept or sent. */
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
          detail:
            out
              .trim()
              .split('\n')[0]!
              .replace(/^logged in( using)?\s*/i, '') || undefined,
        }
      : { signedIn: false }
  },
  loginArgs: ['login'],
  native: { blockingQuestions: true },
  // The ACP adapter takes no skill roots from the client, but Codex scans `.agents/skills` in the chat's folder.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.agents', 'skills')] : [] }),
  updatePlan({ config, binary, findExecutable, runtimeHome }) {
    if (!findExecutable(binary)) throw new Error('Select an installed CLI before updating it.')
    if (config.codex?.binary?.trim() || process.env.RAMU_CODEX_BIN)
      throw new Error('Update this custom Codex installation with its package manager.')
    // Own the npm-managed replacement instead of modifying an unrelated global
    // installation selected by npm's prefix. Existing native processes keep running.
    return {
      command: findExecutable(process.platform === 'win32' ? 'npm.cmd' : 'npm') ?? 'npm',
      args: ['install', '--prefix', runtimeHome, '--no-audit', '--no-fund', '@openai/codex@latest'],
    }
  },
})
