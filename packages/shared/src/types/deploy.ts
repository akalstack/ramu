// Deploy targets: the shapes every hosting platform is reported in, so callers, IPC and both clients never depend on
// one platform's API. A new platform adds an adapter on the server and its id here.
import type { DeployTargetId } from '../stacks'

/** Hosting platforms with an adapter on the server. */
export const HOSTING_PLATFORMS = ['vercel', 'netlify'] as const
export type HostingPlatform = (typeof HOSTING_PLATFORMS)[number]

/** Database and storage providers with a resource adapter on the server. */
export const RESOURCE_PROVIDERS = ['neon'] as const
export type ResourceProvider = (typeof RESOURCE_PROVIDERS)[number]

/** Every account connected in Settings → Hosting accounts: the hosting platforms, then the resource providers. */
export const ACCOUNT_PLATFORMS = [...HOSTING_PLATFORMS, ...RESOURCE_PROVIDERS] as const
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export const isHostingPlatform = (platform: AccountPlatform): platform is HostingPlatform =>
  (HOSTING_PLATFORMS as readonly string[]).includes(platform)

/** What a platform can do beyond the required reads. The UI and agent tools hide what a target lacks. */
export type HostingCapability = 'linkRepository' | 'deployPreview' | 'deployProduction' | 'rollback' | 'domains'

/** Why a platform refused a call, in the words every platform shares. */
export type DeployFailureKind = 'signed-out' | 'missing-permission' | 'plan-limit' | 'not-found'

/** One platform's connection on this host. The token never leaves the host. */
export interface HostingAccount {
  platform: AccountPlatform
  /** Whether it deploys apps or provides a resource such as a database. */
  kind: 'hosting' | ResourceKind
  /** The platform's name, such as "Vercel". */
  name: string
  connected: boolean
  /** The account name the platform reports for the saved sign-in. */
  account: string | null
  /** How it was connected: the platform's own CLI sign-in, or a token pasted on the guided page. */
  via: 'cli' | 'token' | null
  /** When the saved token stops working, for a token that expires (milliseconds). */
  expiresAt: number | null
  /** Set when the token reaches more than deploys need, naming the narrower choice. */
  broadScope: string | null
  /** Why the last check failed, in plain words. */
  error: string | null
  /** Whether the platform's CLI is on the host, so its browser sign-in can be offered. */
  cli: boolean
  /** The platform's page for creating a token. */
  tokenPage: string
}

export interface HostingAccountsSummary {
  accounts: HostingAccount[]
  /** False on a paired device that is not the host: connections change only on the host itself. */
  canAdminister: boolean
}

/** What a resource adapter provides. */
export type ResourceKind = 'database'

/** A size or tier a provider offers when creating a resource. */
export interface ResourcePlan {
  id: string
  name: string
  /** One line on what it includes, such as its storage. */
  summary: string
}

/** A resource made for a project. Connection values stay on the host; clients see variable names only. */
export interface ProjectResource {
  provider: ResourceProvider
  kind: ResourceKind
  /** The resource's id at the provider. */
  id: string
  name: string
  /** The environment variables it sets, such as DATABASE_URL. */
  variables: string[]
  /** Previews and this host use a branch of the database rather than production's. */
  previewBranch: boolean
  /** The provider's page for the resource, where it is resized or deleted. */
  page: string
  /** What the provider reports for the current billing period, when it does. */
  usage: { storageBytes: number | null; computeSeconds: number | null } | null
}

export interface ProjectResources {
  /** The project's stack, or the variables its code reads, show it needs a database. */
  needsDatabase: boolean
  /** Providers that can create one, with their plans and whether an account is connected. */
  providers: {
    provider: ResourceProvider
    name: string
    kind: ResourceKind
    connected: boolean
    plans: ResourcePlan[]
  }[]
  resources: ProjectResource[]
  /** The migrate command from `ramu.json`, run before each production deploy from Ramu. */
  migrate: string | null
}

/** A platform CLI sign-in running on the host: the link and code to show, then the result. */
export interface HostingSignIn {
  id: string
  platform: HostingPlatform
  state: 'starting' | 'waiting' | 'connected' | 'failed'
  url: string | null
  code: string | null
  account: string | null
  error: string | null
}

export type DeploymentState = 'queued' | 'building' | 'ready' | 'failed' | 'canceled'

export interface Deployment {
  id: string
  state: DeploymentState
  /** The deployment's own address, when the platform gave one. */
  url: string | null
  production: boolean
  /** The branch it was built from. */
  ref: string | null
  commit: string | null
  message: string | null
  createdAt: number
}

/** Where a project deploys: the platform, its project or site there, and the account that linked it. */
export interface DeployBinding {
  platform: HostingPlatform
  siteId: string
  siteName: string
  /** `owner/name` on GitHub, when the platform watches the repository. */
  repository: string | null
  /** The branch production builds from. */
  productionBranch: string
  /** The platform account id the binding was made with; another account is refused. */
  accountId: string
  /** A Vercel team the project belongs to. */
  scope: string | null
}

export interface ProjectDeployment {
  /** The target the project's stack names, from `ramu.json`. */
  recommended: DeployTargetId | null
  binding: DeployBinding | null
  capabilities: HostingCapability[]
  productionUrl: string | null
  deployments: Deployment[]
  /** Why the platform could not be read, with the shared kind when it is one. */
  error: { kind: DeployFailureKind | null; message: string } | null
}

/** A DNS record to create at the domain's DNS provider. */
export interface DnsRecord {
  type: 'A' | 'CNAME' | 'TXT'
  /** The full host name the record is for. */
  host: string
  /** The same name relative to its zone, as DNS providers ask for it: `@` for the domain itself, `www` for www.… */
  name: string
  value: string
}

/** A custom domain on the project's platform, and how far it is from serving the app over HTTPS. */
export interface DomainStatus {
  name: string
  /** What the domain's DNS needs, including an ownership record when the platform asks for one. */
  records: DnsRecord[]
  /** The DNS points at the platform (and ownership is verified where the platform checks it). */
  configured: boolean
  /** An HTTPS certificate is issued and served for the domain. */
  certificate: boolean
  /** The DNS is hosted by the platform itself, so Ramu can create the records through the same account. */
  managedDns: boolean
}

/** How one uptime check of the live address came out. `unknown` means the host itself could not tell. */
export type UptimeResult = 'up' | 'down' | 'unknown'

/** Why a check got no usable answer, in words the clients translate. */
export type UptimeFailure = 'timeout' | 'unreachable' | 'redirects'

export interface UptimeCheck {
  at: number
  result: UptimeResult
  /** The HTTP status the address answered with, when it answered. */
  status: number | null
  /** How long the answer took, in milliseconds. */
  ms: number | null
  failure: UptimeFailure | null
}

/** The live address watch of a project, as the Deploy sheet shows it. */
export interface UptimeStatus {
  /** On unless the person turned it off; checks start once the project has a live production deployment. */
  enabled: boolean
  /** The address checked: the production address and the health path from `ramu.json`. */
  url: string | null
  last: UptimeCheck | null
  /** When the current run of failed checks began. */
  downSince: number | null
  /** The latest span the host was asleep or not running, reported as unknown rather than as downtime. */
  gap: { from: number; to: number } | null
  /** The open incident's thread, while the address is down. */
  incident: { taskId: string; openedAt: number } | null
}
