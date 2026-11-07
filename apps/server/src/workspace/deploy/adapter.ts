// Hosting platforms behind one small interface: the required reads every platform has, and the optional
// capabilities a platform declares. Callers and the UI see only `@ramu/shared/types/deploy`, so a new platform is one
// adapter file, its credentials and the contract suite, with no change to callers, IPC or UI.
import type {
  Deployment,
  DeployFailureKind,
  DomainStatus,
  HostingCapability,
  HostingPlatform,
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
  /** The project's environment variables: names only when listing; values are written, never read back. */
  environment?: {
    list(auth: HostingAuth, site: HostingSite): Promise<Record<PlatformEnvironment, string[]>>
    set(
      auth: HostingAuth,
      site: HostingSite,
      environment: PlatformEnvironment,
      values: Record<string, string>,
    ): Promise<void>
  }
  /** Custom domains on the project: adding one, what its DNS needs, and how far it is from serving HTTPS. */
  domains?: {
    list(auth: HostingAuth, site: HostingSite): Promise<PlatformDomain[]>
    add(auth: HostingAuth, site: HostingSite, name: string): Promise<void>
    /** Creates the domain's records in the platform's own DNS; only for a domain listed with `managedDns`. */
    createRecords(auth: HostingAuth, site: HostingSite, domain: PlatformDomain): Promise<void>
  }
}

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
  const names: HostingCapability[] = ['linkRepository', 'deployPreview', 'deployProduction', 'rollback', 'domains']
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
 * One JSON call to a platform. Error bodies are read only to classify the failure; their text is never shown, since
 * platforms can echo request details back.
 */
export async function platformCall<T>(
  name: string,
  fetcher: typeof fetch,
  url: string,
  init: RequestInit & { token: string },
  what: string,
): Promise<T> {
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
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    throw new ReplyLostError(`${name} stopped answering while ${what}.`, { cause: error })
  }
  return (text ? JSON.parse(text) : {}) as T
}

function failure(name: string, status: number, body: string, what: string): DeployError {
  if (status === 401)
    return new DeployError(
      `${name} refused the saved sign-in while ${what}. Connect ${name} again in Settings → Hosting accounts.`,
      'signed-out',
      status,
    )
  if (status === 402 || (status !== 404 && status >= 400 && status < 500 && LIMIT.test(body)))
    return new DeployError(
      `Your ${name} plan's limit stopped this while ${what}. Raise it on ${name}'s billing page.`,
      'plan-limit',
      status,
    )
  if (status === 403)
    return new DeployError(
      `The ${name} account lacks permission for this while ${what}. Check the token's scope or your role in the team.`,
      'missing-permission',
      status,
    )
  if (status === 404)
    return new DeployError(`${name} found nothing for this account while ${what}.`, 'not-found', status)
  return new DeployError(`${name} answered ${status} while ${what}.`, null, status)
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
