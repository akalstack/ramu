// Expo's GraphQL API with the person's own access token: who the token is, the app's store builds and the
// submissions made from them, and their logs. Starting a build or a submission is not in the public API (it uploads
// the project and resolves signing credentials), so `release.ts` runs the `eas` CLI for that.
import type { DeploymentState, StoreBuild, StorePlatform, StoreSubmission } from '@ramu/shared/types/deploy'
import { DeployError, platformRequest, tail, type HostingAuth, type HostingIdentity } from './adapter'

interface RawSubmission {
  id: string
  status: string
  androidConfig?: { track?: string | null } | null
  error?: { message?: string | null } | null
  logFiles?: string[]
  createdAt?: string
}

interface RawBuild {
  id: string
  status: string
  platform: string
  buildProfile?: string | null
  appVersion?: string | null
  appBuildVersion?: string | null
  gitCommitHash?: string | null
  gitCommitMessage?: string | null
  error?: { message?: string | null } | null
  logFiles?: string[]
  createdAt?: string
  app?: { id?: string; slug?: string; ownerAccount?: { name?: string } | null } | null
  submissions?: RawSubmission[]
}

const BUILD_STATES: Record<string, DeploymentState> = {
  NEW: 'queued',
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'building',
  PENDING_CANCEL: 'building',
  FINISHED: 'ready',
  ERRORED: 'failed',
  CANCELED: 'canceled',
}

const SUBMISSION_STATES: Record<string, DeploymentState> = {
  AWAITING_BUILD: 'queued',
  IN_QUEUE: 'queued',
  IN_PROGRESS: 'building',
  FINISHED: 'ready',
  ERRORED: 'failed',
  CANCELED: 'canceled',
}

const BUILD_FIELDS = `
  id status platform buildProfile appVersion appBuildVersion gitCommitHash gitCommitMessage createdAt logFiles
  error { message }
  app { id slug ownerAccount { name } }
  submissions { id status createdAt logFiles androidConfig { track } error { message } }
`

/** At most this much of a log file is read; a build log's useful end is far smaller. */
const LOG_LIMIT = 4 * 1024 * 1024

const time = (value: string | null | undefined) => (value ? Date.parse(value) || 0 : 0)

function submission(raw: RawSubmission): StoreSubmission {
  return {
    id: raw.id,
    state: SUBMISSION_STATES[raw.status] ?? 'queued',
    track: raw.androidConfig?.track ?? null,
    error: raw.error?.message ?? null,
    createdAt: time(raw.createdAt),
  }
}

function build(raw: RawBuild, site: string): StoreBuild {
  const owner = raw.app?.ownerAccount?.name
  const slug = raw.app?.slug
  // The newest submission is the one that counts; a retried one replaces an older failure.
  const latest = [...(raw.submissions ?? [])].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0]
  return {
    id: raw.id,
    platform: (raw.platform === 'IOS' ? 'ios' : 'android') satisfies StorePlatform,
    state: BUILD_STATES[raw.status] ?? 'queued',
    profile: raw.buildProfile ?? null,
    version: raw.appVersion ?? null,
    buildNumber: raw.appBuildVersion ?? null,
    commit: raw.gitCommitHash ?? null,
    message: raw.gitCommitMessage?.split('\n')[0] ?? null,
    error: raw.error?.message ?? null,
    createdAt: time(raw.createdAt),
    page:
      owner && slug
        ? `${site}/accounts/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}/builds/${encodeURIComponent(raw.id)}`
        : site,
    submission: latest ? submission(latest) : null,
  }
}

/** A GraphQL error's code, as Expo puts it in `extensions.errorCode`. */
function refusal(errors: { message?: string; extensions?: { errorCode?: string } }[], what: string): DeployError {
  const code = errors.map((error) => `${error.extensions?.errorCode ?? ''} ${error.message ?? ''}`).join(' ')
  if (/UNAUTHENTICATED|not logged in/i.test(code))
    return new DeployError(
      `Expo refused the saved token while ${what}. Connect Expo again in Settings → Hosting accounts.`,
      'signed-out',
    )
  if (/UNAUTHORIZED|FORBIDDEN|permission/i.test(code))
    return new DeployError(
      `The Expo account lacks permission for this while ${what}. Use a token of an account that can build the app.`,
      'missing-permission',
    )
  if (/NOT_FOUND|could not find|not found/i.test(code))
    return new DeployError(`Expo found nothing for this account while ${what}.`, 'not-found')
  return new DeployError(`Expo could not answer while ${what}.`, null)
}

export interface ExpoClient {
  readonly name: 'Expo'
  readonly kind: 'store'
  readonly tokenPage: string
  account(auth: HostingAuth): Promise<HostingIdentity>
  /** The app's page on expo.dev. */
  app(auth: HostingAuth, projectId: string): Promise<{ name: string; page: string }>
  /** Newest first, at most `limit`, each with its latest submission. */
  builds(auth: HostingAuth, projectId: string, limit: number): Promise<StoreBuild[]>
  build(auth: HostingAuth, buildId: string): Promise<StoreBuild>
  /** The end of a build's log, or of the log of the submission made from it, for a build of the app `projectId`. */
  logs(
    auth: HostingAuth,
    projectId: string,
    buildId: string,
    of: 'build' | 'submission',
    lines: number,
  ): Promise<string>
}

/** Expo, reached at `api` (the real service unless a test points it at a fake server). */
export function expoClient(
  options: { api?: string; site?: string; fetch?: typeof fetch; logUrl?: (url: URL) => boolean } = {},
): ExpoClient {
  const api = options.api ?? 'https://api.expo.dev'
  const site = options.site ?? 'https://expo.dev'
  const fetcher = options.fetch ?? fetch
  // Log files are signed links to storage; they need no token, so none is sent.
  const logUrl = options.logUrl ?? ((url: URL) => url.protocol === 'https:')
  async function query<T>(auth: HostingAuth, document: string, variables: Record<string, unknown>, what: string) {
    const text = await platformRequest(
      'Expo',
      fetcher,
      `${api}/graphql`,
      { method: 'POST', token: auth.token, body: JSON.stringify({ query: document, variables }) },
      what,
    )
    const reply = JSON.parse(text) as { data?: T; errors?: { message?: string; extensions?: { errorCode?: string } }[] }
    if (reply.errors?.length || !reply.data) throw refusal(reply.errors ?? [], what)
    return reply.data
  }
  const one = async (auth: HostingAuth, buildId: string) => {
    const data = await query<{ builds: { byId: RawBuild } }>(
      auth,
      `query Build($buildId: ID!) { builds { byId(buildId: $buildId) { ${BUILD_FIELDS} } } }`,
      { buildId },
      'reading the build',
    )
    return data.builds.byId
  }
  async function readLog(url: string): Promise<string> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return ''
    }
    if (!logUrl(parsed)) return ''
    const response = await fetcher(parsed, { redirect: 'follow' }).catch(() => null)
    if (!response?.ok) return ''
    const raw = (await response.text().catch(() => '')).slice(-LOG_LIMIT)
    // Each line is one JSON log entry; a line that is not is kept as it is.
    return raw
      .split('\n')
      .map((line) => {
        try {
          const entry = JSON.parse(line) as { msg?: unknown }
          return typeof entry.msg === 'string' ? entry.msg : ''
        } catch {
          return line
        }
      })
      .join('\n')
  }
  return {
    name: 'Expo',
    kind: 'store',
    tokenPage: `${site}/settings/access-tokens`,
    async account(auth) {
      const { meActor } = await query<{ meActor: { __typename?: string; id: string; displayName?: string } | null }>(
        auth,
        'query Me { meActor { __typename id displayName } }',
        {},
        'reading the account',
      )
      if (!meActor) throw new DeployError('Expo did not recognize the token.', 'signed-out')
      return {
        id: meActor.id,
        name: meActor.displayName || meActor.id,
        defaultScope: null,
        // A personal token reaches every account its owner belongs to; a robot's reaches only its own account.
        broadScope:
          meActor.__typename === 'User'
            ? 'A robot user’s token on the account that owns the app reaches less than a personal token'
            : null,
        expiresAt: null,
      }
    },
    async app(auth, projectId) {
      const data = await query<{
        app: { byId: { name?: string; slug: string; ownerAccount: { name: string } } }
      }>(
        auth,
        'query App($appId: String!) { app { byId(appId: $appId) { name slug ownerAccount { name } } } }',
        { appId: projectId },
        'reading the app',
      )
      const app = data.app.byId
      return {
        name: app.name || app.slug,
        page: `${site}/accounts/${encodeURIComponent(app.ownerAccount.name)}/projects/${encodeURIComponent(app.slug)}`,
      }
    },
    async builds(auth, projectId, limit) {
      const data = await query<{ app: { byId: { builds: RawBuild[] } } }>(
        auth,
        `query Builds($appId: String!, $limit: Int!) { app { byId(appId: $appId) { builds(offset: 0, limit: $limit, filter: {}) { ${BUILD_FIELDS} } } } }`,
        { appId: projectId, limit },
        'reading the builds',
      )
      return data.app.byId.builds.map((raw) => build(raw, site)).sort((a, b) => b.createdAt - a.createdAt)
    },
    async build(auth, buildId) {
      return build(await one(auth, buildId), site)
    },
    async logs(auth, projectId, buildId, of, lines) {
      const raw = await one(auth, buildId)
      if (raw.app?.id !== projectId) throw new DeployError('That build is not one of this app’s.', 'not-found')
      const latest = [...(raw.submissions ?? [])].sort((a, b) => time(b.createdAt) - time(a.createdAt))[0]
      const files = (of === 'build' ? raw.logFiles : latest?.logFiles) ?? []
      const texts = await Promise.all(files.slice(0, 4).map(readLog))
      return tail(texts.join('\n'), lines)
    },
  }
}
