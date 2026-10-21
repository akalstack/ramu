import { join } from 'node:path'
import { defineAdapter, npmLatest, runCli, selfUpdate } from '../adapter'

export const opencodeAdapter = defineAdapter({
  id: 'opencode',
  browser: { integratedTools: true, providerBrowser: true, canSuppressNative: false },
  selectionTransition: { type: 'restart-and-resume' },
  binaryEnvVar: 'RAMU_OPENCODE_BIN',
  executableNames: () => ['opencode'],
  searchDirs: (home) => [join(home, '.opencode/bin'), join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin'],
  accountEnv: (root) => ({
    XDG_DATA_HOME: join(root, 'data'),
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_STATE_HOME: join(root, 'state'),
  }),
  accountClearedEnv: [
    'OPENCODE_DB',
    'OPENCODE_AUTH_CONTENT',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY',
    'MISTRAL_API_KEY',
    'GROQ_API_KEY',
    'OPENROUTER_API_KEY',
    'CEREBRAS_API_KEY',
    'XAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'OPENCODE_API_KEY',
    'OPENCODE_ZEN_API_KEY',
  ],
  setup(version) {
    const windows = process.platform === 'win32'
    const v1 = version?.startsWith('1.')
    return {
      docsUrl: v1 ? 'https://opencode.ai/docs/' : 'https://opencode.ai/v2/docs/',
      installCommand: windows ? null : `curl -fsSL https://opencode.ai/${v1 ? '' : 'v2/'}install | bash`,
      updateCommand: windows ? null : `curl -fsSL https://opencode.ai/${v1 ? '' : 'v2/'}install | bash`,
      setupCommand: 'opencode',
      setupNote:
        'Open OpenCode in a terminal and use /connect to configure model providers. Version checks stay on your installed major version. On Windows, download the standalone CLI from the setup guide.',
    }
  },
  latestRelease: npmLatest((current) => (current?.startsWith('1.') ? 'opencode-ai' : '@opencode/cli')),
  // OpenCode publishes v1 and v2 separately. Never compare a cached release from another line.
  sameReleaseLine: (installed, release) => (installed?.startsWith('1.') ?? false) === release.startsWith('1.'),
  async signInState(binary, env) {
    const { out } = await runCli(binary, ['auth', 'list'], env)
    const stored = out.split('\n').filter((line) => /\b(stored|env)\b/i.test(line)).length
    return stored ? { signedIn: true, detail: String(stored) } : { signedIn: false }
  },
  loginArgs: ['auth', 'login'],
  // OpenCode's `skills` setting lists extra folders; it travels in the inline config, not the user's config files.
  skillsLaunch: (exportDir) => ({ configPaths: [join(exportDir, 'skills')] }),
  updatePlan: selfUpdate(['upgrade']),
})
