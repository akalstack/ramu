// A plugin's CLI, driven by the agent through `platform_cli`. Agents already know these CLIs, so Ramu adds only what an
// agent cannot do for itself: the credential stays on the host (passed to the CLI in its environment, never in the
// arguments or the transcript), commands that only read run straight away, and every other command asks the person
// with a card naming it. A deploy follows Ramu's one rule for deploys, whichever way an agent makes them.
import { spawn } from 'node:child_process'
import { lstat, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { argvDeploy } from '@ramu/shared/deployActions'
import type { PluginCli, PluginCredential } from '@ramu/shared/plugins'
import { commandLine } from '@ramu/shared/stacks'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { cliEnvironment, platformCli } from './cliPath'
import type { PluginSecret } from './service'

export interface PluginCliTarget {
  plugin: string
  pluginId: string
  cli: PluginCli
  /** The credential that signs the CLI in; absent for a local tool with no account. */
  slot?: PluginCredential
}

const startsWith = (args: readonly string[], prefix: readonly string[]) =>
  prefix.length <= args.length && prefix.every((part, index) => args[index] === part)

/** Whether a command only reads: its arguments start with one of the plugin's read prefixes. */
export function cliCommandReads(cli: Pick<PluginCli, 'reads'>, args: readonly string[]): boolean {
  return cli.reads.some((prefix) => startsWith(args, prefix))
}

/** The CLI to run and the arguments before the agent's: the installed one, else its package through npx. */
export function cliCommand(
  cli: Pick<PluginCli, 'binaries' | 'npx'>,
  find: (name: string) => string | null = platformCli,
): { executable: string; prefix: string[] } | null {
  for (const name of cli.binaries) {
    const found = find(name)
    if (found) return { executable: found, prefix: [] }
  }
  const npx = cli.npx ? find('npx') : null
  return npx && cli.npx ? { executable: npx, prefix: ['--yes', cli.npx] } : null
}

const OUTPUT_LIMIT = 48_000
const TIMEOUT_MS = 10 * 60_000

/** The end of a long output, with every secret value replaced, and terminal escapes stripped. */
export function cliOutput(output: string, secrets: readonly string[]): string {
  // eslint-disable-next-line no-control-regex -- strips terminal colour escapes from CLI output
  let text = output.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, '')
  for (const secret of secrets) if (secret.length >= 4) text = text.split(secret).join('[token]')
  return text.length > OUTPUT_LIMIT ? `…${text.slice(-OUTPUT_LIMIT)}` : text
}

export interface CliRun {
  exitCode: number | null
  output: string
  timedOut: boolean
}

/** The variables a slot's saved value sets: the token under the slot's own, and each extra field under its own. */
export function credentialEnvironment(slot: PluginCredential, secret: PluginSecret): Record<string, string> {
  const env: Record<string, string> = { [slot.env]: secret.token }
  for (const field of slot.fields) if (secret.fields[field.id]) env[field.env] = secret.fields[field.id]!
  return env
}

/**
 * A folder only this user can reach. On Linux the temporary folder is shared by every account, so another user could
 * create the folder first and plant the CLI's config or swap it for a link; an existing folder is used only when it is
 * a real directory this user owns and nobody else can open.
 */
async function privateFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  const uid = process.getuid?.()
  if (!info.isDirectory() || (uid !== undefined && (info.uid !== uid || (info.mode & 0o077) !== 0)))
    throw new Error(`${path} belongs to another account or others can open it. Remove it, then try again.`)
}

/**
 * Runs the plugin's CLI in `cwd` with the credential in its environment and none of Ramu's. HOME is a folder of Ramu's
 * own per plugin, so the CLI never reads or writes the person's own CLI sign-in. A local tool with no account keeps
 * the person's HOME, where its own settings live (Godot's export templates, Unity's installed editors).
 */
export async function runPluginCli(
  target: Pick<PluginCliTarget, 'plugin' | 'cli' | 'slot'>,
  args: readonly string[],
  cwd: string,
  secret: PluginSecret | null,
  signal?: AbortSignal,
  spawner: typeof spawn = spawn,
): Promise<CliRun> {
  const command = cliCommand(target.cli)
  if (!command)
    throw new Error(`The ${target.cli.binaries[0]} CLI is not installed on this host. Ask the person to install it.`)
  const base = join(tmpdir(), `ramu-cli-${process.getuid?.() ?? 'user'}`)
  const home = target.slot ? join(base, target.plugin) : (process.env.HOME ?? tmpdir())
  if (target.slot) {
    await privateFolder(base)
    await privateFolder(home)
  }
  const values = target.slot && secret ? credentialEnvironment(target.slot, secret) : {}
  const env: NodeJS.ProcessEnv = { ...cliEnvironment(home), ...values, CI: '1' }
  return new Promise((resolve, reject) => {
    const child = spawner(command.executable, [...command.prefix, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    let output = ''
    let timedOut = false
    const append = (chunk: Buffer) => {
      output += chunk.toString('utf8')
      if (output.length > OUTPUT_LIMIT * 2) output = output.slice(-OUTPUT_LIMIT * 2)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const stop = () => {
      try {
        if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    }
    const timer = setTimeout(() => {
      timedOut = true
      stop()
    }, TIMEOUT_MS)
    signal?.addEventListener('abort', stop, { once: true })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
      resolve({ exitCode: code, output: cliOutput(output, Object.values(values)), timedOut })
    })
  })
}

const guide = (targets: readonly PluginCliTarget[]) =>
  `Runs the CLI of an installed plugin (${targets.map((target) => `${target.plugin}: ${target.cli.binaries[0]}`).join(', ')}) in this thread's checkout, signed in with the credential the person saved for the plugin in Customize → Plugins when it has one (a local tool such as a game engine has none). Use it instead of running those CLIs yourself: the credential is passed to the CLI in its environment and never shown, a CLI you run yourself is signed out, and commands that only read run without a card. Pass the plugin's name and the arguments after the CLI's name, such as ["status"] or ["deploy", "--detach"]; never pass a token or a login command. Commands that only read run straight away, and so does a preview deploy; a production deploy asks unless the person allowed production deploys for this thread, and the project's migrations run first; every other command asks the person with a card naming it, and a refusal is final for this request. Run non-interactive forms (--yes, --json, --detach, --no-tail) since there is no terminal to answer prompts. Write the platform's own config files yourself and commit them like any change. For a service no plugin covers, call plugin_search.`

/** The CLIs of plugins that apply to this thread's project, signed in with the value saved on this host. */
export function registerPluginCliTools(
  server: McpServer,
  plugins: {
    clis(): PluginCliTarget[]
    secret(pluginId: string, slotId: string): Promise<PluginSecret | null>
  },
  source: AgentSessionInfo,
  current: () => AgentSessionInfo,
  /** Asks the person through the thread's approval card. Resolves false when refused. */
  requestApproval: (detail: string, signal: AbortSignal | undefined) => Promise<boolean>,
  /**
   * Asks for a production deploy (unless the thread allowed them) and runs the project's migrations: what they did, or
   * null when refused. Throws when the migrations fail.
   */
  approveProduction: (detail: string, signal: AbortSignal | undefined) => Promise<string | null>,
  run: typeof runPluginCli = runPluginCli,
) {
  const targets = plugins.clis()
  if (!targets.length) return
  server.registerTool(
    'platform_cli',
    {
      description: guide(targets),
      inputSchema: {
        platform: z.string().min(1).max(64),
        args: z.array(z.string().max(1000)).min(1).max(60),
      },
    },
    async ({ platform, args }: { platform: string; args: string[] }, extra) => {
      const target = plugins.clis().find((entry) => entry.plugin === platform)
      if (!target)
        throw new Error(`No installed plugin named ${platform} has a CLI here. Call plugin_search to find one.`)
      const secret = target.slot ? await plugins.secret(target.pluginId, target.slot.id) : null
      if (target.slot && !secret)
        throw new Error(
          `${target.slot.label} for ${target.plugin} is not saved on this host. Ask the person to add it in Customize → Plugins.`,
        )
      if (args.some((arg) => /^(login|logout)$/.test(arg) || /token/i.test(arg.split('=')[0] ?? '')))
        throw new Error('Sign-in is the person’s step in Settings, and the credential is passed for you. Leave it out.')
      const session = current()
      if (session.id !== source.id || session.cwd !== source.cwd)
        throw new Error('The thread’s checkout changed. Reconnect before trying again.')
      const shown = `${target.cli.binaries[0]} ${commandLine(args)}`
      const deploy = argvDeploy([target.cli.binaries[0]!, ...args])
      const where = target.slot
        ? `Run ${shown} with your ${target.plugin} account, in ${session.cwd}.`
        : `Run ${shown} in ${session.cwd}.`
      const declined = new Error('The person declined this command. Do not retry it without a new request.')
      // A preview never touches what people use, so it runs like a read.
      let migrated: string | null = null
      if (deploy === 'production') {
        migrated = await approveProduction(where, extra.signal)
        if (migrated === null) throw declined
      } else if (
        !cliCommandReads(target.cli, args) &&
        deploy !== 'preview' &&
        !(await requestApproval(where, extra.signal))
      )
        throw declined
      const ran = await run(target, args, session.cwd, secret, extra.signal)
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ command: shown, ...(migrated ? { migrations: migrated } : {}), ...ran }),
          },
        ],
        ...(ran.exitCode === 0 ? {} : { isError: true }),
      }
    },
  )
}
