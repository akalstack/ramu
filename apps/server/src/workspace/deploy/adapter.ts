// Hosting platforms behind one small interface: the required reads every platform has, and the optional
// capabilities a platform declares. Callers and the UI see only `@ramu/shared/types/deploy`, so a new platform is one
// adapter file, its credentials and the contract suite, with no change to callers, IPC or UI.
import type {
  Deployment,
  DeployFailureKind,
  DomainStatus,
  HostingCapability,
  HostingPlatform,
  UsageReport,
} from '@ramu/shared/types/deploy'

/** The account a call runs as: the token and, for a team on Vercel, the team the project belongs to. */
export interface HostingAuth {
  token: string
  scope?: string | null
}

/** Who a token belongs to, and whether it reaches more than deploys need. */
export interface HostingIdentity {
  id: string
  name: string
  /** A team or account scope new projects go to by default. */
  defaultScope: string | null
  /** Set when the token is broader than deploys need, naming the narrower choice. */
  broadScope: string | null
  /** When the token stops working, if the platform reports it (milliseconds). */
  expiresAt: number | null
}

/** A project on the platform that a binding points at. */
export interface HostingSite {
  siteId: string
  siteName: string
}

/** A GitHub repository, and the token of the GitHub account that reaches it, read only when a platform needs it. */
export interface RepositoryLink {
  owner: string
  name: string
  githubToken(): Promise<string>
  /** The branch production builds from. */
  productionBranch: string
}

export interface HostingCapabilities {
  /** Connects the platform's Git integration: previews per pull request, production on the default branch. */
  linkRepository?(auth: HostingAuth, name: string, repository: RepositoryLink): Promise<HostingSite>
  /** Builds a branch as a preview deployment. */
  deployPreview?(auth: HostingAuth, site: HostingSite & { repository: string }, ref: string): Promise<Deployment>
  /** Builds the production branch and makes it live. */
  deployProduction?(auth: HostingAuth, site: HostingSite & { repository: string }, ref: string): Promise<Deployment>
  /** Makes an earlier production deployment live again. */
  rollback?(auth: HostingAuth, site: HostingSite, deploymentId: string): Promise<void>
  /**
   * Holds production builds back (`on`), so a finished one goes live only when promoted, or lets the platform make them
   * live by itself again.
   */
  hold?(auth: HostingAuth, site: HostingSite, on: boolean): Promise<void>
  /** Makes a finished production build live. */
  promote?(auth: HostingAuth, site: HostingSite, deploymentId: string): Promise<void>
  /** The project's environment variables: names only when listing; values are written, never read back. */
  environment?: {
    /** The environments the platform keeps variables for. */
    environments: readonly PlatformEnvironment[]
    list(auth: HostingAuth, site: HostingSite): Promise<Partial<Record<PlatformEnvironment, string[]>>>
    set(
      auth: HostingAuth,
      site: HostingSite,
      environment: PlatformEnvironment,
      values: Record<string, string>,
    ): Promise<void>
    /** Preview variables for one git branch only, beside the preview values every other branch gets. */
    setBranch?(auth: HostingAuth, site: HostingSite, branch: string, values: Record<string, string>): Promise<void>
    /** Removes the variables `setBranch` gave one git branch, leaving every other value as it was. */
    removeBranch?(auth: HostingAuth, site: HostingSite, branch: string, keys: string[]): Promise<void>
  }
  /** Custom domains on the project: adding one, what its DNS needs, and how far it is from serving HTTPS. */
  domains?: {
    list(auth: HostingAuth, site: HostingSite): Promise<PlatformDomain[]>
    add(auth: HostingAuth, site: HostingSite, name: string): Promise<void>
    /** Creates the domain's records in the platform's own DNS; only for a domain listed with `managedDns`. */
    createRecords(auth: HostingAuth, site: HostingSite, domain: PlatformDomain): Promise<void>
  }
  /** What the account used in the current billing period, as far as the platform's API reports it. */
  usage?(auth: HostingAuth, site: HostingSite): Promise<PlatformUsage>
}

/** A platform's usage reading: the figures it reports, the period they cover and where its billing page is. */
export type PlatformUsage = Pick<UsageReport, 'period' | 'figures' | 'billingPage'>

/**
 * A domain as the platform reports it. `configured` and `certificate` are null when the platform does not say, and
 * the service then checks the DNS and the HTTPS answer itself.
 */
export type PlatformDomain = Omit<DomainStatus, 'configured' | 'certificate'> & {
  configured: boolean | null
  certificate: boolean | null
  /** The DNS zone the records belong to, such as `example.com` for `www.example.com`. */
  zone: string
}

/** The environments a hosting platform keeps variables for. */
export type PlatformEnvironment = 'preview' | 'production'

export interface HostingAdapter {
  readonly id: HostingPlatform
  readonly name: string
  /** Where the person creates a token for the guided token page. */
  readonly tokenPage: string
  account(auth: HostingAuth): Promise<HostingIdentity>
  /** Newest first, at most `limit`. */
  listDeployments(auth: HostingAuth, site: HostingSite, limit: number): Promise<Deployment[]>
  deploymentStatus(auth: HostingAuth, site: HostingSite, deploymentId: string): Promise<Deployment>
  /** The end of the build log, at most `lines` lines. */
  deploymentLogs(auth: HostingAuth, site: HostingSite, deploymentId: string, lines: number): Promise<string>
  productionUrl(auth: HostingAuth, site: HostingSite): Promise<string | null>
  readonly capabilities: HostingCapabilities
}

/** The declared capabilities, by the names the shared types use. */
export function capabilityNames(adapter: HostingAdapter): HostingCapability[] {
  const names: HostingCapability[] = [
    'linkRepository',
    'deployPreview',
    'deployProduction',
    'rollback',
    'promote',
    'domains',
    'usage',
  ]
  return names.filter((name) => !!adapter.capabilities[name])
}

/** A platform refusal in the shared kinds, or a plain failure (`kind` null) with the status only. */
export class DeployError extends Error {
  constructor(
    message: string,
    readonly kind: DeployFailureKind | null,
    readonly status: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

/** The reply never arrived (connection reset, timeout): the platform may or may not have acted. */
export class ReplyLostError extends Error {}

const LIMIT = /limit|quota|plan|upgrade|payment|exceeded/i

/**
 * One call to a platform, answering its body as text. Error bodies are read only to classify the failure; their text
 * is never shown, since platforms can echo request details back.
 */
export async function platformRequest(
  name: string,
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
  what: string,
): Promise<string> {
  const { token, ...rest } = init
  let response: Response
  try {
    response = await fetcher(url, {
      ...rest,
      redirect: 'error',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(typeof rest.body === 'string' ? { 'Content-Type': 'application/json' } : {}),
        ...(rest.headers as Record<string, string> | undefined),
      },
    })
  } catch (error) {
    throw new ReplyLostError(`${name} did not answer while ${what}.`, { cause: error })
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw failure(name, response.status, body, what)
  }
  try {
    return await response.text()
  } catch (error) {
    throw new ReplyLostError(`${name} stopped answering while ${what}.`, { cause: error })
  }
}

/** One JSON call to a platform. */
export async function platformCall<T>(
  name: string,
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
  what: string,
): Promise<T> {
  const text = await platformRequest(name, fetcher, url, init, what)
  return (text ? JSON.parse(text) : {}) as T
}

function failure(name: string, status: number, body: string, what: string): DeployError {
  const kind: DeployFailureKind | null =
    status === 401
      ? 'signed-out'
      : status === 402 || (status !== 404 && status >= 400 && status < 500 && LIMIT.test(body))
        ? 'plan-limit'
        : status === 403
          ? 'missing-permission'
          : status === 404
            ? 'not-found'
            : null
  return refusal(name, kind, status, what)
}

/** A refusal in the person's words: what happened and where to fix it. */
function refusal(name: string, kind: DeployFailureKind | null, status: number | null, what: string): DeployError {
  if (kind === 'signed-out')
    return new DeployError(
      `${name} refused the saved sign-in while ${what}. Connect ${name} again in Settings → Deploy.`,
      kind,
      status,
    )
  if (kind === 'plan-limit')
    return new DeployError(
      `Your ${name} plan's limit stopped this while ${what}. Raise it on ${name}'s billing page.`,
      kind,
      status,
    )
  if (kind === 'missing-permission')
    return new DeployError(
      `The ${name} account lacks permission for this while ${what}. Check the token's scope or your role in the team.`,
      kind,
      status,
    )
  if (kind === 'not-found')
    return new DeployError(`${name} found nothing for this account while ${what}.`, kind, status)
  return new DeployError(`${name} answered ${status ?? 'with an error'} while ${what}.`, null, status)
}

/** How a GraphQL API words a refusal it answers beside a 200. */
const GRAPHQL_KINDS: [RegExp, DeployFailureKind][] = [
  [/unauthenticated|invalid (api )?token|token (is )?(expired|revoked)|not logged in/i, 'signed-out'],
  [/not authori[sz]ed|unauthori[sz]ed|forbidden|permission|access denied/i, 'missing-permission'],
  [/not found|could not find|does not exist|no such/i, 'not-found'],
  [LIMIT, 'plan-limit'],
]

/**
 * One GraphQL call. GraphQL APIs answer most refusals as `errors` beside a 200, so those are classified like HTTP
 * refusals; their text is never shown either.
 */
export async function graphqlCall<T>(
  name: string,
  fetcher: typeof fetch,
  url: string,
  init: { token: string; headers?: Record<string, string> },
  query: string,
  variables: Record<string, unknown>,
  what: string,
): Promise<T> {
  const reply = await platformCall<{ data?: T | null; errors?: { message?: string }[] }>(
    name,
    fetcher,
    url,
    { method: 'POST', body: JSON.stringify({ query, variables }), ...init },
    what,
  )
  if (reply.errors?.length) {
    const text = reply.errors.map((error) => error.message ?? '').join('\n')
    throw refusal(name, GRAPHQL_KINDS.find(([pattern]) => pattern.test(text))?.[1] ?? null, null, what)
  }
  if (!reply.data) throw new DeployError(`${name} sent no answer while ${what}.`, null)
  return reply.data
}

/** The last `lines` non-empty lines of a log. */
export function tail(text: string, lines: number): string {
  return text
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .join('\n')
}

const adapters = new Map<HostingPlatform, HostingAdapter>()

/** Registers an adapter once, at module load. A second registration for the same id is a bug. */
export function registerHostingAdapter(adapter: HostingAdapter): HostingAdapter {
  if (adapters.has(adapter.id)) throw new Error(`A hosting adapter for ${adapter.id} is already registered`)
  adapters.set(adapter.id, adapter)
  return adapter
}

/** The adapter for a platform; throws for one with no adapter so a caller never gets a silent no-op. */
export function hostingAdapter(id: HostingPlatform): HostingAdapter {
  const adapter = adapters.get(id)
  if (!adapter) throw new Error(`No hosting adapter for ${id}`)
  return adapter
}
