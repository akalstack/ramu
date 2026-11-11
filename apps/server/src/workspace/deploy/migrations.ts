// A project's migrations, run against its production database before a production deploy goes out, however the agent
// deploys. The database address is saved once per project on this host; the migrate command comes from `ramu.json`.
import { execFile } from 'node:child_process'
import { commandLine } from '@ramu/shared/stacks'
import { HostCredentialStore } from '../../credentials/store'
import { redactSecrets } from '../../memory/secrets'
import { SavedCredential } from '../forge/savedCredential'

const TIMEOUT_MS = 10 * 60_000
const OUTPUT_LINES = 60

export type MigrationRunner = (
  argv: string[],
  cwd: string,
  variables: Record<string, string>,
) => Promise<{ ok: boolean; output: string }>

/** Runs the command with only the basics of this host's environment and the database's variables. */
export const runMigration: MigrationRunner = (argv, cwd, variables) =>
  new Promise((resolve) => {
    const keep = ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'SHELL', 'SystemRoot']
    const env = {
      ...Object.fromEntries(keep.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : []))),
      ...variables,
    }
    execFile(
      argv[0]!,
      argv.slice(1),
      { cwd, env, timeout: TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 },
      (error, out, err) => resolve({ ok: !error, output: `${out}\n${err}` }),
    )
  })

/** A migration that failed; its output is already redacted, for the thread to show. */
export class MigrationError extends Error {
  constructor(
    message: string,
    readonly output: string,
  ) {
    super(message)
  }
}

export interface MigrationHost {
  getState<T>(key: string, fallback: T): T
  setState(key: string, value: unknown): void
  /** The migrate command from the project's `ramu.json`, if it names one. */
  migrate(projectId: string): string[] | null
}

/** What a production deploy runs first, and whether it can: the command, and whether its database address is saved. */
export interface MigrationPlan {
  command: string | null
  addressSaved: boolean
}

export class ProductionMigrations {
  constructor(
    private readonly host: MigrationHost,
    private readonly credentials = new HostCredentialStore(),
    private readonly run: MigrationRunner = runMigration,
  ) {}

  private saved(projectId: string) {
    return new SavedCredential<{ token: string; name: string }>(
      { key: `production-database-${projectId}`, connectionId: `production-database-${projectId}`, shown: 'name' },
      (key, fallback) => this.host.getState(key, fallback),
      (key, value) => this.host.setState(key, value),
      this.credentials,
    )
  }

  async plan(projectId: string): Promise<MigrationPlan> {
    const argv = this.host.migrate(projectId)
    return { command: argv ? commandLine(argv) : null, addressSaved: !!(await this.saved(projectId).read()) }
  }

  /** Keeps the production database's address (a `postgres://…` URL) for this project, in the host's credential store. */
  async save(projectId: string, address: string) {
    const url = new URL(address)
    await this.saved(projectId).save({ token: address, name: `${url.hostname}${url.pathname}` })
  }

  async remove(projectId: string) {
    await this.saved(projectId).remove()
  }

  /**
   * Runs the project's migrations in the checkout that is about to deploy, against production. Nothing to run returns
   * a note for the approval card; a failure throws, and the deploy does not go out.
   */
  async beforeProduction(projectId: string | null, cwd: string): Promise<string> {
    const argv = projectId ? this.host.migrate(projectId) : null
    if (!projectId || !argv) return 'This project names no migrate command in ramu.json, so nothing runs first.'
    const saved = await this.saved(projectId).read()
    if (!saved)
      throw new MigrationError(
        `This project migrates with ${commandLine(argv)}, but no production database address is saved, so the migrations cannot run first. Ask the person to add it in the project's Deploy sheet.`,
        '',
      )
    const result = await this.run(argv, cwd, { DATABASE_URL: saved.token, DATABASE_URL_UNPOOLED: saved.token })
    if (!result.ok) {
      // It ran with production's address, which an error may print; the output reaches the thread.
      const output = redactSecrets(tail(result.output)).replaceAll(saved.token, '[database address]')
      throw new MigrationError(`The migration (${commandLine(argv)}) failed.\n${output}`, output)
    }
    return `Ran ${commandLine(argv)} against production first.`
  }
}

const tail = (text: string) =>
  text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-OUTPUT_LINES)
    .join('\n')
