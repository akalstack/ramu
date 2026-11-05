import { join } from 'node:path'
import { defineAdapter, selfUpdate } from '../adapter'
import { loadCursorSdk } from '../cursor'
import { storedCursorKey } from '../cursorAuth'

/**
 * Cursor runs SDK agents only for paid plans, even locally, and refuses a free one with `plan_required`. Asking who the
 * key belongs to shows that before a thread fails; any other answer, or none, leaves the login as it is.
 */
export async function cursorPlanRequired(me: () => Promise<unknown>): Promise<boolean> {
  try {
    await me()
    return false
  } catch (error) {
    return (error as { code?: unknown }).code === 'plan_required'
  }
}
const CURSOR_PRICING = 'https://cursor.com/pricing'

export const cursorAdapter = defineAdapter({
  id: 'cursor',
  browser: { integratedTools: true, providerBrowser: true, canSuppressNative: false },
  selectionTransition: { type: 'restart-and-resume' },
  binaryEnvVar: 'RAMU_CURSOR_BIN',
  executableNames: () => ['agent', 'cursor-agent'],
  accountEnv: (root) => ({
    CURSOR_CONFIG_DIR: root,
    // Where this account's Cursor SDK login is saved, so it never shares the default login.
    RAMU_CURSOR_SDK_DIR: join(root, 'sdk'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    AGENT_CLI_CREDENTIAL_STORE: 'file',
  }),
  accountClearedEnv: ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'],
  // Logins are saved in files, never the macOS Keychain, so Ramu never needs Keychain permission.
  extendEnvironment: (env) => ({ AGENT_CLI_CREDENTIAL_STORE: 'file', ...env }),
  setup: () => ({
    docsUrl: 'https://cursor.com/docs/cli/installation',
    installCommand:
      process.platform === 'win32'
        ? "irm 'https://cursor.com/install?win32=true' | iex"
        : 'curl https://cursor.com/install -fsS | bash',
    updateCommand: 'agent update',
    setupCommand: 'agent login',
    setupNote:
      'Ramu runs Cursor threads through the Cursor SDK. Sign in with Login (opens your browser) or set CURSOR_API_KEY. The CLI is used for updates and as a fallback model list.',
  }),
  async latestRelease(_current, fetchText) {
    const script = await fetchText(`https://cursor.com/install${process.platform === 'win32' ? '?win32=true' : ''}`)
    return { version: /downloads\.cursor\.com\/lab\/([^/"\s]+)/.exec(script)?.[1] }
  },
  // The SDK takes an API key, or its own stored login; the CLI's `agent login` session does not carry over.
  async signInState(_binary, env) {
    try {
      const { Cursor, FileCredentialStore } = await loadCursorSdk()
      const free = (apiKey: string | undefined) =>
        apiKey ? cursorPlanRequired(() => Cursor.me({ apiKey })) : Promise.resolve(false)
      const unpaid = { plan: 'free', upgradeUrl: CURSOR_PRICING }
      if (env.CURSOR_API_KEY)
        return {
          signedIn: true,
          detail: 'API key',
          apiKey: true,
          ...((await free(env.CURSOR_API_KEY)) ? unpaid : {}),
        }
      const status = await Cursor.auth.status(
        env.RAMU_CURSOR_SDK_DIR ? { store: new FileCredentialStore(join(env.RAMU_CURSOR_SDK_DIR, 'auth.json')) } : {},
      )
      if (status.status !== 'logged-in') return { signedIn: false }
      return {
        signedIn: true,
        ...(status.email ? { detail: status.email, email: String(status.email) } : {}),
        ...((await free(storedCursorKey(env))) ? unpaid : {}),
      }
    } catch {
      return env.CURSOR_API_KEY ? { signedIn: true, detail: 'API key', apiKey: true } : { signedIn: false }
    }
  },
  loginArgs: null,
  // Each account saves its own login file; the default account uses the SDK's own location.
  async signIn({ env }) {
    const { Cursor, FileCredentialStore } = await loadCursorSdk()
    await Cursor.auth.login(
      env.RAMU_CURSOR_SDK_DIR ? { store: new FileCredentialStore(join(env.RAMU_CURSOR_SDK_DIR, 'auth.json')) } : {},
    )
  },
  // The agent scans `<workspace>/.cursor/skills` (and follows folder links there); ACP has no option for another folder.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.cursor', 'skills')] : [] }),
  updatePlan: selfUpdate(['update']),
})
