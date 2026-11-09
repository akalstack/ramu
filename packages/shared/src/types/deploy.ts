// Deploy targets: the shapes every hosting platform is reported in, so callers, IPC and both clients never depend on
// one platform's API. A new platform adds an adapter on the server and its id here.
import type { DeployTargetId } from '../stacks'

/** Hosting platforms with an adapter on the server: linked to a repository, watched, rolled back from the sheet. */
export const HOSTING_PLATFORMS = ['vercel', 'netlify'] as const
export type HostingPlatform = (typeof HOSTING_PLATFORMS)[number]

/**
 * Platforms an agent drives through the platform's own CLI with the token saved on this host (`platform_cli`), rather
 * than through an adapter: the agent writes the setup, Ramu keeps the token out of the thread and asks before a
 * command that changes anything.
 */
export const CLI_PLATFORMS = ['railway', 'fly', 'cloudflare', 'supabase'] as const
export type CliPlatform = (typeof CLI_PLATFORMS)[number]
export const isCliPlatform = (value: unknown): value is CliPlatform =>
  typeof value === 'string' && (CLI_PLATFORMS as readonly string[]).includes(value)

/** Platforms whose own CLI can sign in on the host. */
export const CLI_SIGN_IN_PLATFORMS = ['vercel', 'netlify', 'railway', 'fly', 'expo', 'neon'] as const
export type CliSignInPlatform = (typeof CLI_SIGN_IN_PLATFORMS)[number]
/** Sign-ins whose link works from any device, so a paired owner device can start them for a remote host. */
export const REMOTE_SIGN_IN_PLATFORMS: readonly CliSignInPlatform[] = ['vercel', 'netlify', 'railway', 'expo']

/** Database providers with a resource adapter on the server. */
export const RESOURCE_PROVIDERS = ['neon'] as const
export type ResourceProvider = (typeof RESOURCE_PROVIDERS)[number]

/** Services that build an app and hand it to the app stores. */
export const STORE_SERVICES = ['expo'] as const
export type StoreService = (typeof STORE_SERVICES)[number]

/**
 * Every account connected in Settings → Deploy: the hosting platforms, the resource providers, then the
 * store services.
 */
/** Services a Dashboard artifact reads from, each its own grant on the dashboard. */
/** The loopback callback a Salesforce connected app registers; the host listens there only during a sign-in. */
export const SALESFORCE_CALLBACK_PORT = 7417
export const SALESFORCE_CALLBACK = `http://localhost:${SALESFORCE_CALLBACK_PORT}/salesforce/callback`

export const NAMED_SERVICES = ['grafana', 'amplitude', 'salesforce'] as const
export type NamedService = (typeof NAMED_SERVICES)[number]
export const NAMED_SERVICE_NAMES: Record<NamedService, string> = {
  grafana: 'Grafana',
  amplitude: 'Amplitude',
  salesforce: 'Salesforce',
}

/**
 * Media services an ability can run on with the person's own API key, billed to that account: video, speech, music
 * and sound effects that no signed-in coding agent makes. Their keys are saved in Settings → Media.
 */
export const MEDIA_SERVICES = ['gemini', 'elevenlabs', 'openai'] as const
export type MediaService = (typeof MEDIA_SERVICES)[number]
export const MEDIA_SERVICE_NAMES: Record<MediaService, string> = {
  gemini: 'Google Gemini',
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
}
export const isMediaService = (value: unknown): value is MediaService =>
  typeof value === 'string' && (MEDIA_SERVICES as readonly string[]).includes(value)

export const ACCOUNT_PLATFORMS = [
  ...HOSTING_PLATFORMS,
  ...CLI_PLATFORMS,
  ...RESOURCE_PROVIDERS,
  ...STORE_SERVICES,
  ...NAMED_SERVICES,
  ...MEDIA_SERVICES,
] as const
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export const isHostingPlatform = (platform: AccountPlatform): platform is HostingPlatform =>
  (HOSTING_PLATFORMS as readonly string[]).includes(platform)

/** What a platform can do beyond the required reads. The UI and agent tools hide what a target lacks. */
export type HostingCapability =
  'linkRepository' | 'deployPreview' | 'deployProduction' | 'rollback' | 'promote' | 'domains' | 'usage'

/** Why a platform refused a call, in the words every platform shares. */
export type DeployFailureKind = 'signed-out' | 'missing-permission' | 'plan-limit' | 'not-found'

/** One platform's connection on this host. The token never leaves the host. */
export interface HostingAccount {
  platform: AccountPlatform
  /** Whether it deploys apps, runs through its CLI, provides a database, or releases phone apps to the stores. */
  kind: 'hosting' | 'cli' | ResourceKind | 'store' | 'service' | 'media'
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
export const RESOURCE_KINDS = ['database'] as const
export type ResourceKind = (typeof RESOURCE_KINDS)[number]

/** How the Deploy settings page groups accounts, in order; titles are English copy keys. */
export const DEPLOY_ACCOUNT_GROUPS: readonly { kind: Exclude<HostingAccount['kind'], 'media'>; title: string }[] = [
  { kind: 'hosting', title: 'Hosting' },
  { kind: 'cli', title: 'Platforms through their CLI' },
  { kind: 'database', title: 'Databases' },
  { kind: 'store', title: 'App stores' },
  { kind: 'service', title: 'Dashboard data' },
]

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
}

export interface ProjectResources {
  /** What the project's stack, or the variables its code reads, show it needs, in the sheet's order. */
  needs: ResourceKind[]
  /** The platform the project deploys to, whose own database the sheet can point to. */
  platform: HostingPlatform | null
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
  /** A platform's CLI sign-in, or Salesforce's browser sign-in through the person's connected app. */
  platform: CliSignInPlatform | 'salesforce'
  state: 'starting' | 'waiting' | 'connected' | 'failed'
  url: string | null
  code: string | null
  account: string | null
  error: string | null
  /** The platform's page shows a number to pick, which the person sends back with `deploy.signInMatch`. */
  asksNumber?: boolean
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
  /** The team or workspace the project belongs to (a Vercel team). */
  scope: string | null
}

export interface ProjectDeployment {
  /** The target the project's stack names, from `ramu.json`. */
  recommended: DeployTargetId | null
  binding: DeployBinding | null
  capabilities: HostingCapability[]
  productionUrl: string | null
  deployments: Deployment[]
  /** Production builds wait for the project's migrations, which Ramu runs before making each one live. */
  heldForMigrations: boolean
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

/** What a usage figure measures: one Ramu names, or a platform service named in the platform's own words. */
export type UsageMetric = 'build-minutes' | 'storage' | 'compute' | 'transfer' | 'service'

export interface UsageFigure {
  metric: UsageMetric
  /** The platform's own name for a `service` figure, such as "Fast Data Transfer". */
  service: string | null
  used: number
  /** `bytes`, `minutes` or `seconds`, or the platform's own unit for a `service` figure. */
  unit: string
  /** The plan's limit as the platform reports it; null when the platform reports none. */
  limit: number | null
}

/** One platform's figures for the current billing period, as it reports them. */
export interface UsageReport {
  platform: AccountPlatform
  name: string
  /** The span the figures cover (milliseconds), when the platform says. */
  period: { start: number; end: number | null } | null
  figures: UsageFigure[]
  /** Set when the platform reports no usage for this account, in plain words. */
  unavailable: string | null
  /** The platform's billing page. Ramu never changes a plan or adds a payment method. */
  billingPage: string
}

/** The app stores a release reaches, by the platform the app runs on. */
export type StorePlatform = 'ios' | 'android'

/** What Release builds: both platforms, or one. */
export type StoreTarget = StorePlatform | 'all'

/** A store submission: an upload to TestFlight or Play's internal track, never a submission for review. */
export interface StoreSubmission {
  id: string
  state: DeploymentState
  /** The Play track for Android; null for iOS, which always goes to TestFlight. */
  track: string | null
  /** Why it failed, in the service's words. */
  error: string | null
  createdAt: number
}

/** One store build of the app on the build service, with the submission made from it. */
export interface StoreBuild {
  id: string
  platform: StorePlatform
  state: DeploymentState
  profile: string | null
  /** The version people see, such as 1.2.0. */
  version: string | null
  /** The build number (iOS) or version code (Android). */
  buildNumber: string | null
  commit: string | null
  message: string | null
  /** Why it failed, in the service's words. */
  error: string | null
  createdAt: number
  /** The build's page on the service. */
  page: string
  submission: StoreSubmission | null
}

/** One thing the stores need, checked from the app's configuration before a release. */
export type StoreCheckId =
  | 'eas-json'
  | 'eas-project'
  | 'ios-bundle'
  | 'android-package'
  | 'icon'
  | 'version'
  | 'build-number'
  | 'ios-app'
  | 'android-track'
  | 'ios-privacy'
  | 'dynamic-config'

export interface StoreCheck {
  id: StoreCheckId
  /** `warning` passes but is worth fixing before the stores review the app. */
  state: 'ok' | 'missing' | 'warning'
  /** The value found or what is missing, such as a bundle identifier or permission keys. */
  detail: string | null
}

/** Store releases of a project's Expo app: what the stores need, and the latest builds and submissions. */
/** What EAS Update previews of pull requests still need from the app. */
export type UpdatePreviewNeed = 'expo-updates' | 'eas-project' | 'runtime-version' | 'updates-url'

/** Previews of each pull request as an EAS Update, opened from a QR code the job comments on the pull request. */
export interface UpdatePreview {
  needs: UpdatePreviewNeed[]
  /** The app uses expo-dev-client, so the QR code opens a development build rather than Expo Go. */
  developmentBuild: boolean
  /** The checkout already has Ramu's preview job. */
  workflow: boolean
}

export interface StoreRelease {
  /** The Expo app at the repository root; null when the project has none. */
  app: { name: string; projectId: string | null; page: string | null } | null
  /** Whether an Expo account is connected on this host, and its name. */
  connected: boolean
  account: string | null
  checks: StoreCheck[]
  /** Update previews of pull requests; null when the project has no Expo app. */
  previews: UpdatePreview | null
  builds: StoreBuild[]
  /** Why the builds could not be read, in plain words. */
  error: string | null
}

/** What linking a project did: the deployment status. */
export interface DeployLinkResult {
  deployment: ProjectDeployment
}

/** An app published from this computer through a tunnel of its own (Deploy → Run on this computer). */
/** How an app runs on this computer: in a Docker container, or as a program with the person's own permissions. */
export type LocalAppMode = 'container' | 'process'

export interface LocalAppStatus {
  state: 'off' | 'building' | 'running' | 'failed'
  mode: LocalAppMode | null
  /** The lasting hostname the app runs at, when one is set; a quick tunnel's changing address otherwise. */
  lasting: string | null
  /** The app's own public address once its tunnel is up. */
  url: string | null
  error: string | null
  since: number | null
}
