import { existsSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineAdapter, npmLatest, runCli, selfUpdate } from '../adapter'

export const claudeCodeAdapter = defineAdapter({
  id: 'claude-code',
  binaryEnvVar: 'RAMU_CLAUDE_BIN',
  executableNames: () => ['claude'],
  accountEnv: (root) => ({ CLAUDE_CONFIG_DIR: root }),
  accountClearedEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'],
  /** A Claude account keeps your user-level settings, skills and agents by linking them in; credentials and history stay its own. */
  prepareAccount(root) {
    const shared = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
    for (const name of ['settings.json', 'CLAUDE.md', 'skills', 'agents', 'commands']) {
      const source = join(shared, name),
        target = join(root, name)
      if (existsSync(source) && !existsSync(target) && shared !== root)
        try {
          symlinkSync(source, target)
        } catch {}
    }
  },
  setup: () => ({
    docsUrl: 'https://code.claude.com/docs/en/setup',
    installCommand:
      process.platform === 'win32'
        ? 'irm https://claude.ai/install.ps1 | iex'
        : 'curl -fsSL https://claude.ai/install.sh | bash',
    updateCommand: 'claude update',
    setupCommand: 'claude',
    setupNote:
      'Install Claude Code and run it in a terminal to sign in. Ramu uses your installed CLI through the Claude Agent SDK; select its executable path if automatic detection does not find it.',
  }),
  latestRelease: npmLatest(() => '@anthropic-ai/claude-code'),
  async signInState(binary, env) {
    const { out } = await runCli(binary, ['auth', 'status'], env)
    try {
      const status = JSON.parse(out)
      return status.loggedIn
        ? { signedIn: true, ...(typeof status.authMethod === 'string' ? { detail: status.authMethod } : {}) }
        : { signedIn: false }
    } catch {
      return { signedIn: false }
    }
  },
  loginArgs: ['auth', 'login'],
  native: { advisor: true, blockingQuestions: true },
  // A local plugin adds the export as `ramu-managed:<skill>` without touching ~/.claude or the project.
  skillsLaunch: (exportDir) => ({ plugins: [exportDir] }),
  updatePlan: selfUpdate(['update']),
})
