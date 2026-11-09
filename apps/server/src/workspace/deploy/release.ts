// Store releases of a project's Expo app: the checks the stores need, read from app.json and eas.json, and Release,
// which builds the app on EAS and submits each build to TestFlight or Play's internal track. Builds and submissions
// start through the `eas` CLI (EAS has no public API for them) as an argument list with the token in its environment;
// everything else is read through Expo's API. A submission for review is never made here: that is the person's
// action on each store.
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { lstat, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  blockingChecks,
  EAS_JSON,
  easProjectId,
  RELEASE_PROFILE,
  storeCheckText,
  storeChecks,
  UPDATE_PREVIEW_NEED_TEXT,
  updatePreviewNeeds,
  type StoreFacts,
} from '@ramu/shared/storeRelease'
import {
  EAS_PREVIEW_WORKFLOW_PATH,
  easPreviewWorkflow,
  EXPO_TOKEN_SECRET,
  packageManagerOf,
} from '@ramu/shared/easPreview'
import { translate } from '@ramu/shared/i18n'
import type { StoreBuild, StoreRelease, StoreTarget, UsageReport } from '@ramu/shared/types/deploy'
import { redactSecrets } from '../../memory/secrets'
import { commitBranchInfo } from '../git'
import { proposeFile } from '../proposeFile'
import { DeployError } from './adapter'
import type { HostingAccounts } from './accounts'
import type { EnvTarget } from './envSync'
import { expoClient, type ExpoClient } from './expo'
import { cliEnvironment, platformCli } from './signIn'
import { usageReport } from './usage'

const LISTED = 10
const LOG_LINES = 200
/** Configuration files larger than this are not read; a real app.json or eas.json is far smaller. */
const FILE_LIMIT = 256 * 1024
/** Uploading the project and starting the builds; the builds themselves run on EAS and are not waited for. */
const START_TIMEOUT_MS = 20 * 60_000

/** Runs the `eas` CLI in `cwd` with the token in its environment and resolves with its standard output. */
export type EasRunner = (args: string[], options: { cwd: string; token: string }) => Promise<string>

/** The `eas` CLI on this host, or the published one through npx. */
function easCommand(): { file: string; prefix: string[] } {
  const installed = platformCli('eas')
  if (installed) return { file: installed, prefix: [] }
  return { file: platformCli('npx') ?? 'npx', prefix: ['--yes', 'eas-cli@latest'] }
}

const runEas: EasRunner = (args, { cwd, token }) =>
  new Promise((done, fail) => {
    const { file, prefix } = easCommand()
    execFile(
      file,
      [...prefix, ...args],
      {
        cwd,
        // The person's own HOME, for Git and npm caches; only Ramu's secrets are left out, and the token is EAS's own.
        env: { ...cliEnvironment(process.env.HOME ?? cwd), EXPO_TOKEN: token },
        timeout: START_TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (!error) return done(stdout)
        const output = redactSecrets(
          String(stderr || stdout)
            .split('\n')
            .slice(-30)
            .join('\n')
            .trim(),
        )
        fail(new Error(`EAS stopped before starting the builds.${output ? `\n\n${output}` : ''}`, { cause: error }))
      },
    )
  })

/** A file of the repository, read only when it is a regular file of a sensible size. */
async function readSmall(root: string, name: string): Promise<string | null> {
  const info = await lstat(join(root, name)).catch(() => null)
  if (!info?.isFile() || info.size > FILE_LIMIT) return null
  return readFile(join(root, name), 'utf8')
}

async function readJson(root: string, name: string): Promise<unknown> {
  const text = await readSmall(root, name)
  if (text === null) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${name} is not valid JSON. Fix it before releasing.`)
  }
}

const DYNAMIC = ['app.config.ts', 'app.config.js', 'app.config.mjs', 'app.config.cjs']

/** Whether a repository root holds an Expo app. */
const isExpoApp = (root: string) =>
  existsSync(join(root, 'app.json')) || DYNAMIC.some((name) => existsSync(join(root, name)))

/** Runs the project's own `expo config`, which executes its app.config.*; only when the person asks. */
export type ConfigRunner = (cwd: string) => Promise<string>

const runExpoConfig: ConfigRunner = (cwd) =>
  new Promise((done, fail) => {
    execFile(
      platformCli('npx') ?? 'npx',
      ['--no-install', 'expo', 'config', '--json', '--type', 'public'],
      { cwd, env: cliEnvironment(process.env.HOME ?? cwd), timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) return done(stdout)
        const output = redactSecrets(
          String(stderr || stdout)
            .split('\n')
            .slice(-12)
            .join('\n')
            .trim(),
        )
        fail(
          new Error(
            `expo config did not finish. Install the project’s dependencies first.${output ? `\n\n${output}` : ''}`,
          ),
        )
      },
    )
  })

export interface ReleaseHost {
  /** The project's repository checkouts, in order. */
  roots(projectId: string): string[]
  /** The repository's GitHub Actions secrets, where the preview job's Expo token goes. */
  actionsSecrets(root: string): EnvTarget
}

export class StoreReleases {
  constructor(
    private readonly host: ReleaseHost,
    private readonly accounts: Pick<HostingAccounts, 'auth' | 'accountName'>,
    private readonly client: ExpoClient = expoClient(),
    private readonly run: EasRunner = runEas,
    private readonly config: ConfigRunner = runExpoConfig,
  ) {}

  /** The resolved configuration read from each app's `app.config.*`, by checkout, until that file changes. */
  private readonly resolved = new Map<string, { file: string; mtime: number; expo: unknown }>()

  /**
   * Reads the app's resolved configuration by running its own `expo config`, which runs the project's code, so it
   * happens only when the person asks; the checks then use it instead of app.json.
   */
  async resolveConfig(projectId: string): Promise<StoreRelease> {
    const root = this.root(projectId)
    const file = root ? DYNAMIC.find((name) => existsSync(join(root, name))) : undefined
    if (!root || !file) throw new Error('This app has no app.config file to read.')
    const output = await this.config(root)
    let expo: unknown
    try {
      expo = JSON.parse(output.slice(output.indexOf('{')))
    } catch {
      throw new Error('expo config did not print a configuration Ramu could read.')
    }
    this.resolved.set(root, { file, mtime: (await lstat(join(root, file))).mtimeMs, expo })
    return this.status(projectId)
  }

  /** The first repository of the project with an Expo app at its root. */
  root(projectId: string): string | null {
    return this.host.roots(projectId).find(isExpoApp) ?? null
  }

  /** Whether that app also depends on Expo, so it ships through the stores; an app.json alone also names Heroku apps. */
  storeApp(projectId: string): boolean {
    const root = this.root(projectId)
    if (!root) return false
    try {
      const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
      }
      return !!(pkg.dependencies?.expo ?? pkg.devDependencies?.expo)
    } catch {
      return false
    }
  }

  private async facts(root: string): Promise<StoreFacts> {
    const appJson = await readJson(root, 'app.json')
    const pkg = (await readJson(root, 'package.json').catch(() => null)) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    } | null
    const icon = appJson
      ? ((appJson as { expo?: { icon?: unknown }; icon?: unknown }).expo?.icon ?? (appJson as { icon?: unknown }).icon)
      : null
    let iconExists = false
    if (typeof icon === 'string') {
      // The icon must be a file inside the repository; a path that leaves it does not count.
      const path = resolve(root, icon)
      const inside = relative(root, path)
      iconExists =
        !!inside && !inside.startsWith('..') && !isAbsolute(inside) && !!(await lstat(path).catch(() => null))?.isFile()
    }
    const dynamicConfig = DYNAMIC.find((name) => existsSync(join(root, name))) ?? null
    // A configuration read from app.config.* stands in for app.json until that file changes.
    const kept = this.resolved.get(root)
    const resolved =
      kept &&
      dynamicConfig === kept.file &&
      (await lstat(join(root, kept.file)).catch(() => null))?.mtimeMs === kept.mtime
        ? kept.expo
        : null
    return {
      appJson: resolved ? { expo: resolved } : appJson,
      easJson: await readJson(root, 'eas.json'),
      dynamicConfig: resolved ? null : dynamicConfig,
      dependencies: Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }),
      iconExists,
    }
  }

  async status(projectId: string): Promise<StoreRelease> {
    const account = this.accounts.accountName('expo')
    const root = this.root(projectId)
    const empty: StoreRelease = {
      app: null,
      connected: !!account,
      account,
      checks: [],
      previews: null,
      builds: [],
      error: null,
    }
    if (!root) return empty
    const facts = await this.facts(root)
    const easProject = easProjectId(facts.appJson)
    const name = String(
      (facts.appJson as { expo?: { name?: unknown } } | null)?.expo?.name ?? root.split(/[\\/]/).pop() ?? '',
    )
    const status: StoreRelease = {
      ...empty,
      app: { name, projectId: easProject, page: null },
      checks: storeChecks(facts),
      previews: {
        needs: updatePreviewNeeds(facts),
        developmentBuild: facts.dependencies.includes('expo-dev-client'),
        workflow: existsSync(join(root, EAS_PREVIEW_WORKFLOW_PATH)),
      },
    }
    if (!account || !easProject) return status
    try {
      const { auth } = await this.accounts.auth('expo')
      const [app, builds] = await Promise.all([
        this.client.app(auth, easProject),
        this.client.builds(auth, easProject, LISTED),
      ])
      return { ...status, app: { name: app.name, projectId: easProject, page: app.page }, builds }
    } catch (error) {
      return { ...status, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** The Expo account's usage for the project's app, or null when the project has no EAS app or no Expo account. */
  async usage(projectId: string): Promise<UsageReport | null> {
    const root = this.root(projectId)
    if (!root || !this.accounts.accountName('expo')) return null
    const easProject = easProjectId((await this.facts(root)).appJson)
    if (!easProject) return null
    return usageReport('expo', 'Expo', async () =>
      this.client.usage((await this.accounts.auth('expo')).auth, easProject),
    )
  }

  /**
   * Builds the default branch on EAS for `target` and submits each build when it finishes: iOS to TestFlight, Android
   * to Play's internal track. Refused while a check that matters for `target` is missing, or while the checkout is
   * on another branch. The caller is the person's approval.
   */
  async start(projectId: string, target: StoreTarget): Promise<StoreBuild[]> {
    const root = this.root(projectId)
    if (!root) throw new Error('This project has no Expo app at the root of its repository.')
    const blocking = blockingChecks(storeChecks(await this.facts(root)), target)
    if (blocking.length)
      throw new Error(
        `Fix these first: ${blocking.map((check) => storeCheckText((key, values) => translate('en', key, values), check)).join('; ')}.`,
      )
    const { branch, defaultBranch } = await commitBranchInfo(root)
    if (defaultBranch && branch !== defaultBranch)
      throw new Error(`A release builds ${defaultBranch}. Switch the project’s checkout to ${defaultBranch} first.`)
    const { auth } = await this.accounts.auth('expo')
    const stdout = await this.run(
      [
        'build',
        '--platform',
        target,
        '--profile',
        RELEASE_PROFILE,
        '--auto-submit-with-profile',
        RELEASE_PROFILE,
        '--non-interactive',
        '--no-wait',
        '--json',
      ],
      { cwd: root, token: auth.token },
    )
    let started: { id?: unknown; platform?: unknown }[]
    try {
      started = JSON.parse(stdout) as { id?: unknown; platform?: unknown }[]
    } catch (error) {
      throw new DeployError(
        'EAS did not report the builds it started. Check the builds on expo.dev before releasing again.',
        null,
        null,
        { cause: error },
      )
    }
    const builds = (Array.isArray(started) ? started : []).flatMap((entry) =>
      typeof entry?.id === 'string' ? [{ id: entry.id, platform: entry.platform }] : [],
    )
    // The builds have started (and cost credits) whether or not reading them back works, so each one is returned and
    // followed; one that cannot be read yet is reported as queued rather than failing the release into a retry.
    return Promise.all(
      builds.map(({ id, platform }) =>
        this.client.build(auth, id).catch((): StoreBuild => ({
          id,
          platform: platform === 'IOS' || platform === 'ios' ? 'ios' : 'android',
          state: 'queued',
          profile: RELEASE_PROFILE,
          version: null,
          buildNumber: null,
          commit: null,
          message: null,
          error: null,
          createdAt: Date.now(),
          page: 'https://expo.dev',
          submission: null,
        })),
      ),
    )
  }

  async build(buildId: string): Promise<StoreBuild> {
    const { auth } = await this.accounts.auth('expo')
    return this.client.build(auth, buildId)
  }

  /** The end of a build's or its submission's log, for a build of the project's own app. */
  async logs(projectId: string, buildId: string, of: 'build' | 'submission'): Promise<string> {
    const root = this.root(projectId)
    const easProject = root ? easProjectId((await this.facts(root)).appJson) : null
    if (!easProject) throw new Error('This project has no Expo app linked to an EAS project.')
    const { auth } = await this.accounts.auth('expo')
    return this.client.logs(auth, easProject, buildId, of, LOG_LINES)
  }

  /** Opens a pull request that adds the eas.json Release needs; the person merges it. */
  async proposeEasJson(projectId: string): Promise<{ url: string | null }> {
    const root = this.root(projectId)
    if (!root) throw new Error('This project has no Expo app at the root of its repository.')
    const { url } = await proposeFile(root, 'ramu/eas-json', async () => ({
      files: [{ path: 'eas.json', content: EAS_JSON }],
      commit: 'build: add eas.json for store releases\n',
      title: 'Add eas.json for store releases',
      body: [
        `Adds \`eas.json\` with a \`${RELEASE_PROFILE}\` build profile whose build numbers EAS keeps and raises on every build, and a \`${RELEASE_PROFILE}\` submit profile that sends Android builds to Play’s internal testing track.`,
        'Before the first iOS release, add the app’s App Store Connect Apple ID as `submit.production.ios.ascAppId`.',
      ].join('\n\n'),
    }))
    return { url }
  }

  /**
   * Keeps the Expo token in the repository's Actions secrets and opens a pull request with the job that publishes
   * each pull request as an EAS Update and comments its QR code. Refused while the app still lacks what updates need.
   */
  async proposePreviews(projectId: string): Promise<{ url: string | null }> {
    const root = this.root(projectId)
    if (!root) throw new Error('This project has no Expo app at the root of its repository.')
    const needs = updatePreviewNeeds(await this.facts(root))
    if (needs.length)
      throw new Error(`Fix these first: ${needs.map((need) => UPDATE_PREVIEW_NEED_TEXT[need]).join('; ')}.`)
    const { auth } = await this.accounts.auth('expo')
    await this.host.actionsSecrets(root).set('ci', { [EXPO_TOKEN_SECRET]: auth.token })
    const { url } = await proposeFile(root, 'ramu/eas-preview', async () => ({
      files: [{ path: EAS_PREVIEW_WORKFLOW_PATH, content: easPreviewWorkflow(packageManagerOf(await readdir(root))) }],
      commit: `ci: publish each pull request as an EAS Update\n\nAdds ${EAS_PREVIEW_WORKFLOW_PATH}.\n`,
      title: 'Preview each pull request with EAS Update',
      body: [
        `\`${EAS_PREVIEW_WORKFLOW_PATH}\` publishes each pull request to its own EAS Update branch, \`pr-<number>\`, and comments a QR code on the pull request that opens it on a phone.`,
        `The Expo token is in this repository’s Actions secrets (${EXPO_TOKEN_SECRET}). Pull requests from forks get no secrets, so they get no preview.`,
        'An update carries JavaScript and assets only: a change to native code or to a library with native code needs a new build.',
      ].join('\n\n'),
    }))
    return { url }
  }
}
