// Secrets sync: the variables an app reads, where each one is set, and copying the missing ones from this host to the
// other places. Every place is an `EnvTarget`, so syncing is one loop over targets. Values travel only from this
// host's credential store to a target's API; they are never returned to a client.
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appVariables,
  ENV_CODE_EXTENSIONS,
  ENV_EXAMPLE_FILES,
  type EnvColumn,
  type EnvEnvironment,
  type EnvSyncStatus,
} from '@ramu/shared/envSync'
import type { ProviderEnvironmentStore } from '../../providers/environmentStore'
import { actionsSecretNames, setActionsSecrets } from '../forge'
import { git } from '../git'

/** A place environment variables are set. `list` returns names only. */
export interface EnvTarget {
  /** `host`, `github` or a hosting platform id. */
  readonly id: string
  readonly name: string
  readonly environments: readonly EnvEnvironment[]
  list(): Promise<Partial<Record<EnvEnvironment, string[]>>>
  set(environment: EnvEnvironment, values: Record<string, string>): Promise<void>
}

/** This host's Environment variables (the global scope every agent gets), which are also where values come from. */
export function hostTarget(store: ProviderEnvironmentStore): EnvTarget & { values(): Record<string, string> } {
  return {
    id: 'host',
    name: 'This host',
    environments: ['development'],
    list: async () => ({ development: store.status(false).keys.global ?? [] }),
    values() {
      const status = store.status(true)
      if (status.state === 'unavailable')
        throw new Error('Unlock this computer’s credential store so Ramu can read the saved values, then sync again.')
      return Object.fromEntries((status.values?.global ?? []).map((variable) => [variable.key, variable.value]))
    },
    async set(_environment, values) {
      const current = store.status(true).values ?? {}
      const kept = (current.global ?? []).filter((variable) => !(variable.key in values))
      await store.save({
        ...current,
        global: [...kept, ...Object.entries(values).map(([key, value]) => ({ key, value }))],
      })
    },
  }
}

/** The repository's GitHub Actions secrets, through its existing GitHub account. */
export function githubActionsTarget(root: string): EnvTarget {
  return {
    id: 'github',
    name: 'GitHub Actions',
    environments: ['ci'],
    list: async () => ({ ci: await actionsSecretNames(root) }),
    set: (_environment, values) => setActionsSecrets(root, values),
  }
}

const FILE_LIMIT = 4000
const FILE_BYTES = 512 * 1024
const TOTAL_BYTES = 32 * 1024 * 1024

/** The app's variables, from the files Git would track (ignored folders such as node_modules are skipped). */
export async function readAppVariables(root: string): Promise<string[]> {
  const paths = (await git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']))
    .split('\0')
    .filter((path) => path && (ENV_CODE_EXTENSIONS.test(path) || ENV_EXAMPLE_FILES.includes(path.split('/').pop()!)))
    .slice(0, FILE_LIMIT)
  const files: { path: string; text: string }[] = []
  let total = 0
  for (const path of paths) {
    // Links are skipped, so nothing outside the repository is read.
    const info = await lstat(join(root, path)).catch(() => null)
    if (!info?.isFile() || info.size > FILE_BYTES || total + info.size > TOTAL_BYTES) continue
    total += info.size
    files.push({ path, text: await readFile(join(root, path), 'utf8').catch(() => '') })
  }
  return appVariables(files)
}

async function columnsOf(targets: EnvTarget[]): Promise<EnvColumn[]> {
  const read = await Promise.all(
    targets.map(async (target) => {
      try {
        return { target, names: await target.list(), error: null }
      } catch (error) {
        return { target, names: null, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
  return read.flatMap(({ target, names, error }) =>
    target.environments.map((environment) => ({
      target: target.id,
      name: target.name,
      environment,
      names: names ? (names[environment] ?? []) : null,
      error,
    })),
  )
}

/** Where each of the app's variables is set. The host comes first. */
export async function envStatus(variables: string[], targets: EnvTarget[]): Promise<EnvSyncStatus> {
  const columns = await columnsOf(targets)
  const onHost = new Set(columns.find((column) => column.target === 'host')?.names ?? [])
  return { variables, columns, missingOnHost: variables.filter((name) => !onHost.has(name)) }
}

/**
 * Copies each app variable this host has a value for to every place that lacks it. A target that cannot be read is
 * left alone, and one that refuses stops the sync with its message after the others before it were written.
 */
export async function syncEnv(
  variables: string[],
  host: ReturnType<typeof hostTarget>,
  others: EnvTarget[],
): Promise<EnvSyncStatus> {
  const values = host.values()
  for (const target of others) {
    const columns = await columnsOf([target])
    for (const column of columns) {
      if (!column.names) continue
      const present = new Set(column.names)
      const missing = variables.filter((name) => !present.has(name) && name in values)
      if (missing.length)
        await target.set(column.environment, Object.fromEntries(missing.map((name) => [name, values[name]!])))
    }
  }
  return envStatus(variables, [host, ...others])
}
