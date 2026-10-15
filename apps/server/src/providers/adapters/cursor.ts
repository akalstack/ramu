import { join } from 'node:path'
import { defineAdapter, runCli, selfUpdate } from '../adapter'

export const cursorAdapter = defineAdapter({
  id: 'cursor',
  binaryEnvVar: 'RAMU_CURSOR_BIN',
  executableNames: () => ['agent', 'cursor-agent'],
  accountEnv: (root) => ({
    CURSOR_CONFIG_DIR: root,
    XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'),
    AGENT_CLI_CREDENTIAL_STORE: 'file',
  }),
  accountClearedEnv: ['CURSOR_API_KEY', 'CURSOR_AUTH_TOKEN'],
  setup: () => ({
    docsUrl: 'https://cursor.com/docs/cli/installation',
    installCommand:
      process.platform === 'win32'
        ? "irm 'https://cursor.com/install?win32=true' | iex"
        : 'curl https://cursor.com/install -fsS | bash',
    updateCommand: 'agent update',
    setupCommand: 'agent login',
    setupNote: 'Install the Cursor CLI and sign in. Ramu connects through its ACP mode.',
  }),
  async latestRelease(_current, fetchText) {
    const script = await fetchText(`https://cursor.com/install${process.platform === 'win32' ? '?win32=true' : ''}`)
    return { version: /downloads\.cursor\.com\/lab\/([^/"\s]+)/.exec(script)?.[1] }
  },
  async signInState(binary, env) {
    const { out } = await runCli(binary, ['status'], env)
    const match = /logged in(?: as (\S+))?/i.exec(out)
    return match && !/not logged in/i.test(out)
      ? { signedIn: true, ...(match[1] ? { detail: match[1] } : {}) }
      : { signedIn: false }
  },
  loginArgs: ['login'],
  // The agent scans `<workspace>/.cursor/skills` (and follows folder links there); ACP has no option for another folder.
  skillsLaunch: (_exportDir, cwd) => ({ linkDirs: cwd ? [join(cwd, '.cursor', 'skills')] : [] }),
  updatePlan: selfUpdate(['update']),
})
