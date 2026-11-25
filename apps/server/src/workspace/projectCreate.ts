import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROJECT_NAME, STACKS, commandLine, withProjectName, type StackId, type StackPlan } from '@ramu/shared/stacks'
import { git } from './git'
import type { ProjectConfig } from './projectConfig'

const GENERATOR_TIMEOUT_MS = 10 * 60_000
const OUTPUT_TAIL = 2000

/** Runs one command with no shell and no input, failing with the end of its output. */
export type RunCommand = (argv: string[], cwd: string, signal?: AbortSignal) => Promise<void>

export const runCommand: RunCommand = (argv, cwd, signal) =>
  new Promise((resolve, reject) => {
    const child = execFile(
      argv[0]!,
      argv.slice(1),
      {
        cwd,
        timeout: GENERATOR_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        ...(signal ? { signal } : {}),
        // Generators ask questions on a terminal; CI and a closed input make them take their defaults.
        env: { ...process.env, CI: '1', npm_config_yes: 'true' },
      },
      (error, stdout, stderr) => {
        if (!error) return resolve()
        const output = `${stdout}${stderr}`.trim().slice(-OUTPUT_TAIL)
        reject(new Error(`${commandLine(argv)} failed${output ? `:\n${output}` : `: ${error.message}`}`))
      },
    )
    child.stdin?.end()
  })

export interface NewProjectFolder {
  path: string
  stack: StackId | null
  /** The name of a stack an agent looked up, which has no id. */
  stackName: string | null
  /** The generator commands that ran, as lines. */
  ran: string[]
}

/**
 * A new project folder beside the person's other repositories: the stack's own generator, a `.gitignore`, the stack's
 * commands in `ramu.json` so later threads know them, and a first commit. A failed generator removes the folder it
 * started in, so the same name can be tried again.
 */
export async function createProjectFolder(
  input: { parent: string; name: string; stack?: StackId | StackPlan; description?: string },
  deps: { create: (parent: string, name: string) => Promise<string>; run: RunCommand; signal?: AbortSignal },
): Promise<NewProjectFolder> {
  if (!PROJECT_NAME.test(input.name))
    throw new Error('Use a folder name of letters, digits, dots, dashes or underscores.')
  const stack = typeof input.stack === 'string' ? STACKS[input.stack] : (input.stack ?? null)
  const path = await deps.create(input.parent, input.name)
  const ran: string[] = []
  try {
    for (const step of stack?.generator ?? []) {
      const argv = withProjectName(step, input.name)
      await deps.run(argv, path, deps.signal)
      ran.push(commandLine(argv))
    }
  } catch (error) {
    await rm(path, { recursive: true, force: true }).catch(() => {})
    throw error
  }
  if (stack && !existsSync(join(path, '.gitignore')) && stack.ignore.length)
    await writeFile(join(path, '.gitignore'), `${stack.ignore.join('\n')}\n`)
  await writeFile(join(path, 'ramu.json'), `${JSON.stringify(projectFile(path, input.name, stack), null, 2)}\n`)
  if (!existsSync(join(path, '.git'))) await git(path, ['init', '--initial-branch=main'])
  await git(path, ['add', '-A'])
  await commit(path, stack ? `Start ${input.name} with ${stack.name}` : `Start ${input.name}`)
  return { path, stack: stack?.id ?? null, stackName: stack?.name ?? null, ran }
}

/** The stack's facts merged into a `ramu.json` a generator may already have written. */
function projectFile(path: string, name: string, stack: StackPlan | null): ProjectConfig {
  let existing: ProjectConfig = {}
  try {
    existing = JSON.parse(readFileSync(join(path, 'ramu.json'), 'utf8')) as ProjectConfig
  } catch {
    // None yet, which is the usual case.
  }
  return {
    ...existing,
    name: existing.name ?? name,
    ...(stack
      ? {
          stack: {
            ...(stack.id ? { id: stack.id } : { name: stack.name }),
            ...(stack.dev ? { dev: commandLine(stack.dev) } : {}),
            ...(stack.build ? { build: commandLine(stack.build) } : {}),
            ...(stack.test ? { test: commandLine(stack.test) } : {}),
            ...(stack.database ? { database: true } : {}),
            ...(stack.migrate ? { migrate: stack.migrate } : {}),
          },
        }
      : {}),
  }
}

/** The first commit; a host with no Git identity yet commits as Ramu rather than failing the new project. */
async function commit(path: string, message: string) {
  try {
    await git(path, ['commit', '--allow-empty', '-m', message])
  } catch (error) {
    if (!/user\.(name|email)|identity|Please tell me who you are/i.test(String(error))) throw error
    await git(path, [
      '-c',
      'user.name=Ramu',
      '-c',
      'user.email=ramu@localhost',
      'commit',
      '--allow-empty',
      '-m',
      message,
    ])
  }
}

/** What a thread in a project knows from its `ramu.json` without being told: the stack and its commands. */
export function projectFactsText(config: ProjectConfig): string | undefined {
  const stack = config.stack
  if (!stack) return undefined
  const lines = [
    stack.id ? `Stack: ${STACKS[stack.id].name}` : stack.name ? `Stack: ${stack.name}` : '',
    stack.dev ? `Run it: ${stack.dev}` : '',
    stack.build ? `Build: ${stack.build}` : '',
    stack.test ? `Test: ${stack.test}` : '',
    stack.id && !STACKS[stack.id].installed
      ? "Deploys: with the hosting platform's own plugin (plugin_search, plugin_install) or its CLI. A preview deploy runs without asking; a production deploy, however you make it, asks the person and runs the migrations first."
      : '',
    stack.id && STACKS[stack.id].prerequisites ? `Needs: ${STACKS[stack.id].prerequisites}` : '',
    stack.database ? 'Stores data in Postgres: read DATABASE_URL (DATABASE_URL_UNPOOLED for migrations).' : '',
    stack.migrate ? `Migrate (runs before each production deploy): ${commandLine(stack.migrate)}` : '',
  ].filter(Boolean)
  return lines.length ? `Project facts from ramu.json (use these commands):\n${lines.join('\n')}` : undefined
}

export const NO_PROJECT_GUIDE =
  'This thread has no project. When the person asks you to build something new that needs its own folder and repository (an app, a site, a service), ask at most three short questions you cannot infer (web or phone app, sign-in, stored data), propose the stack in one line (no framework unless it needs sign-in, stored data, many pages, or is a phone or desktop app), then call project_create. When they name a framework, use it, looking up its official create command on the web when it is not one of Ramu’s stacks. Make the smallest thing that does the job first: a calculator, tracker or game is an App artifact, writing to keep a Doc, a deck Slides, numbers to watch a Dashboard, a screen or mockup a Design and a short explainer a Motion, each made with artifact_publish and no project. Only something that needs a backend, data shared between people or its own domain becomes a project.'
