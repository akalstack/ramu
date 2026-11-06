import type {
  BrowserImportDomain,
  BrowserImportProfile,
  BrowserImportSource,
  BrowserImportStaged,
  BrowserProfileCatalog,
  BrowserProfileInfo,
  BrowserTabInfo,
} from './types/browser'
import type { RoutingCandidate, RoutingOutcome } from './workspace/projectRouting'
import type { BranchChoice, BranchNamingIntent, BranchNamingStrategy } from './workspaceDefaults'
import type { AntigravitySignIn, ProviderEnvironmentStatus, ProviderEnvironmentValues } from './providers/environment'
import type { HostOverview, HostDestination, HostTaskMethod } from './hostOverview'
import type { SettingsSnapshot, SettingEdit } from './settingsCompatibility'
import type { BackgroundActivity } from './chat/activity'
import type { RamuTheme, ThemeIssue, ThemeRole } from './theme'
import type { AppUpdateStatus } from './updates'
import type { NearbyHostsState } from './discovery/tracker'
import type { AgentSetupSnapshot } from './agentSetup'
import type { AccountLogin, ProviderConfiguration, ProviderStatus } from './providers/providers'
import type { AbilityCall, AbilityCheck } from './providers/abilities'
import type { LimitRetryResult } from './chat/providerWait'
import type { VoiceBridge } from './voice/bridge'
import type {
  SharedMcpConnection,
  SharedMcpGrant,
  SharedMcpInspection,
  SharedMcpManagement,
  SharedMcpAccountReadiness,
  SharedMcpProviderAccount,
  SharedMcpSelection,
  ProjectSetup,
} from './mcp'
// The renderer-facing contract. Each method maps 1:1 to a validated handler in src/main/ipc.ts.
import type {
  PullMode,
  CommitBranchOptions,
  ChangeReview,
  ChangeFile,
  ReviewBranchState,
  ReviewFileState,
  ReviewComment,
  UndoPreview,
  FileContext,
  SkillInfo,
  ScheduleInput,
  ScheduleRule,
  Schedule,
  ScheduleRun,
  RecapSnapshot,
  BackgroundStatus,
  NetworkStatus,
  NetworkSettingsInput,
  TunnelChoice,
  PairingOffer,
  PairingOfferStatus,
  Computers,
  Memory,
  MemoryInput,
  MemorySnapshot,
  SearchOptions,
  SearchResults,
  ReplaceFilePreview,
  AppPreferences,
  ChatGoal,
  UsageReading,
  ContextUsage,
  AgentMcpStatus,
  NextMessageRoute,
  Aside,
  AgentEvent,
  Attachment,
  AgentSettings,
  ModelPreferences,
  ProviderCatalog,
  ModelNotice,
  AgentScope,
  ProjectAction,
  ProjectActionSettings,
  ChatSearchHit,
  FolderInspection,
  AgentSessionInfo,
  StartedThread,
  CreateTaskInput,
  DiffContents,
  DirEntry,
  FileContent,
  EditorConfigProps,
  GitStatus,
  GitCommit,
  GitCommitFile,
  GitStash,
  GitBranchInfo,
  CommitDraft,
  ForgeStatus,
  Rule,
  RuleInput,
  RuleRevision,
  NativeInstructions,
  ForgeAccessReport,
  ForgeRepositoryAccount,
  ForgeRepositorySummary,
  ForgeConnectionSummary,
  GitlabSummary,
  BitbucketSummary,
  AzureSummary,
  ForgeSaveConnectionInput,
  ForgeSavedConnection,
  PullRequestWatchStatus,
  IssueLink,
  IssueSummary,
  PullRequestDraft,
  PullRequestFeedbackKind,
  PublishRepositoryInput,
  PullRequestInput,
  Project,
  Repository,
  RepositoryBinding,
  SaveResult,
  Task,
  TaskUiState,
  WorkspaceUiState,
  WorktreePlanEntry,
  WorktreeWorkspace,
} from './types'

export interface TerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  exited: boolean
  /** Set for a persistent command Ramu launched for a thread. */
  background?: true
}

export type BackgroundTerminalState = 'running' | 'stopping' | 'exited' | 'failed' | 'unknown'

/** One persistent command Ramu launched for a thread. The host owns identity, lifecycle and output. */
export interface BackgroundTerminalInfo {
  id: string
  taskId: string
  repoId: string | null
  cwd: string
  command: string
  state: BackgroundTerminalState
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  cursor: number
  /** Who asked it to stop. A command the person stopped must not be relaunched without a new instruction. */
  stoppedBy?: 'user' | 'agent'
  /** Set when a sub-agent (helper), not the thread's main agent, launched the command. */
  startedBy?: 'helper'
  /** The agent is waiting on this command right now, so its turn continues when the command settles. */
  agentWaiting?: true
  capabilities: { inspect: true; stop: boolean; forceStop: boolean; input: boolean }
}

/** Counts only: lock-screen content never includes prompts, paths, host names or credentials. */
export interface MobileLiveActivityContent {
  running: number
  waiting: number
  startedAt: number
  updatedAt: number
  locale: 'en' | 'id'
  phase: 'working' | 'waiting' | 'finished' | 'paused'
}
export interface MobileLiveActivityRegistration {
  activityId: string
  token: string
  computerId: string
  startedAt: number
  locale: 'en' | 'id'
  environment: 'sandbox' | 'production'
}

export interface ComputerSessionSummary {
  target: import('./computerBridge').ComputerTarget
  controller: import('./control/lease').Controller
  generation: number
  paused: boolean
  /** The computer whose screen this is; `local` is the host itself. */
  runtime: { id: string; name: string }
  /** That computer's system, when known, so shortcuts use its own command key. */
  os?: 'macos' | 'linux' | 'windows'
  /** Control passed to the person at the computer because they used its mouse or keyboard. Cleared at the next change of owner. */
  interruption?: 'local-input' | null
  /** The device asking the human controller for control, if any. */
  handoffRequest?: string | null
  /** Whether the person in control is using the device that asked. False means another of their devices has it. */
  controlledHere?: boolean
  /** False when mouse and keyboard use on the computer cannot be noticed, so the person must take control explicitly. */
  detectsLocalInput?: boolean
}

export interface ComputerLockedUse {
  installed: boolean
  enabled: boolean
  available: boolean
  stage: string
  session: string
  clientApproved: boolean
  blockers: string[]
  /** The installer this host last started: still open on the Mac, or why it stopped. */
  installer?: { running: boolean; error?: string }
}

type ComputerFrameMeta = import('./computerBridge').ComputerFrameMeta
type ComputerAction = import('./computerBridge').ComputerAction

/** Why a changed address was or was not adopted: only `moved` changes anything. */
export type ReviewAddressResult = 'moved' | 'unchanged' | 'mismatch' | 'unsupported' | 'unreachable' | 'insecure'

/** Artifacts: what agents make and people keep, with their state, records, runs, shares and publishing. */
interface ArtifactMethods {
  'artifacts.list'(): import('./artifacts').ArtifactInfo[]
  'artifacts.get'(artifactId: string): import('./artifacts').ArtifactInfo
  'artifacts.exists'(artifactId: string): boolean
  'artifacts.versions'(artifactId: string): import('./artifacts').ArtifactVersion[]
  'artifacts.document'(artifactId: string, version?: number): import('./interactive').InteractiveDocument
  /** Keeps a thread's document as an artifact owned by the host. */
  'artifacts.keep'(
    sessionId: string,
    contentId: string,
    title?: string,
    icon?: string,
  ): import('./artifacts').ArtifactInfo
  'artifacts.update'(
    artifactId: string,
    patch: { title?: string; icon?: string; pinned?: boolean; projectId?: string | null },
  ): import('./artifacts').ArtifactInfo
  'artifacts.delete'(artifactId: string): void
  'artifacts.restoreVersion'(artifactId: string, version: number): import('./artifacts').ArtifactInfo
  'artifacts.duplicate'(artifactId: string, title?: string): import('./artifacts').ArtifactInfo
  'artifacts.state'(artifactId: string): import('./artifacts').ArtifactState
  /** Saves over the revision read; `accepted: false` returns the newer state another device saved. */
  'artifacts.saveState'(
    artifactId: string,
    state: unknown,
    revision: number,
  ): import('./artifacts').ArtifactState & { accepted: boolean }
  'artifacts.grant'(
    artifactId: string,
    grants: import('./artifacts').ArtifactGrants,
  ): import('./artifacts').ArtifactInfo
  'artifacts.usage'(artifactId: string): import('./artifacts').ArtifactUsage
  /** One ramuContent call from the artifact's frame, checked against its grants. */
  'artifacts.call'(artifactId: string, method: string, args: unknown[]): unknown
  /** Starts an artifact run and returns its id at once; its steps arrive on artifacts:changed. */
  'artifacts.runStart'(
    artifactId: string,
    task: string,
    options?: {
      shape?: unknown
      maxSteps?: number
      name?: string
      functions?: { name: string; description: string; input: Record<string, string> }[]
    },
  ): string | null
  'artifacts.runFlow'(
    artifactId: string,
    name: string,
    functions?: { name: string; description: string; input: Record<string, string> }[],
  ): string | null
  /** Ask this artifact: a read-only agent answers a question about its records. */
  'artifacts.ask'(artifactId: string, question: string): import('./artifacts').ArtifactRun
  'artifacts.runs'(artifactId: string): import('./artifacts').ArtifactRun[]
  'artifacts.runStop'(runId: string): void
  'artifacts.runUndo'(runId: string): import('./artifacts').ArtifactRun
  'artifacts.runReply'(callId: string, value: unknown, error?: string): boolean
  'artifacts.runConfirm'(confirmId: string, allowed: boolean): boolean
  'artifacts.reportError'(
    artifactId: string,
    error: { message: string; version: number; device?: string; steps?: string[] },
  ): void
  'artifacts.clearError'(artifactId: string): void
  'artifacts.exportRecords'(artifactId: string): { json: string; csv: Record<string, string> }
  'artifacts.importCsv'(artifactId: string, collection: string, text: string): { added: number }
  'artifacts.widget'(artifactId: string): { title: string; value: string; items: string[] } | null
  'artifacts.webhookUrls'(artifactId: string): string[]
  /** Hands work the artifact cannot do itself to a new thread, with the artifact attached. */
  /** `selector` is an element Edit pointed at; the host attaches its screenshot. */
  'artifacts.startThread'(artifactId: string, prompt: string, selector?: string): StartedThread
  'artifacts.makeProject'(
    artifactId: string,
    name?: string,
  ): { projectId: string; folder: string; thread: StartedThread }
  'artifacts.share'(artifactId: string, canAdd: boolean): import('./artifacts').ArtifactShare
  'artifacts.shares'(artifactId: string): import('./artifacts').ArtifactShare[]
  'artifacts.revokeShare'(token: string): void
  'artifacts.renewShare'(token: string): import('./artifacts').ArtifactShare
  'artifacts.openShare'(token: string): {
    share: import('./artifacts').ArtifactShare
    artifact: Pick<import('./artifacts').ArtifactInfo, 'id' | 'kind' | 'title' | 'icon' | 'version' | 'capabilities'>
    document: import('./interactive').InteractiveDocument
    state: import('./artifacts').ArtifactState
  }
  'artifacts.shareCall'(token: string, method: string, args: unknown[]): unknown
  /** Static hosting platforms an artifact can be published to, and whether this host has their login. */
  'artifacts.publishTargets'(): {
    target: 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages'
    name: string
    connected: boolean
  }[]
  /** `account` is the Cloudflare account ID, for a token limited to Pages that cannot list accounts. */
  'artifacts.saveHostingToken'(target: 'netlify' | 'vercel' | 'cloudflare-pages', token: string, account?: string): void
  'artifacts.removeHostingToken'(target: 'netlify' | 'vercel' | 'cloudflare-pages'): void
  /** Deploys the artifact's current version as a static site on the person's own account; updates the same site later. */
  'artifacts.publish'(
    artifactId: string,
    target: 'github-pages' | 'netlify' | 'vercel' | 'cloudflare-pages',
  ): import('./artifacts').ArtifactInfo
  /** Whether an artifact is open to people without Ramu, and its address. */
  'artifacts.publicStatus'(artifactId: string): import('./artifacts').PublicArtifactStatus
  /** Opens an artifact to anyone through its own listener and tunnel; only one that uses no host feature. */
  'artifacts.openPublic'(artifactId: string): import('./artifacts').PublicArtifactStatus
  'artifacts.closePublic'(artifactId: string): void
  /** Copies an artifact another host shared into a new one here, with no records, values or grants. */
  'artifacts.import'(
    document: import('./interactive').InteractiveDocument,
    from: { title: string; icon: string },
  ): import('./artifacts').ArtifactInfo
}

export interface RamuMethods extends ArtifactMethods {
  /** Test devices on this host: whether they are on, each platform's readiness and the devices. */
  'testDevices.status'(): import('./testDevices').TestDeviceStatus
  'testDevices.setEnabled'(enabled: boolean): void
  'testDevices.stop'(id: string): void
  /** Installs the optional helper that lets agents tap and type on iOS Simulators. */
  'testDevices.installHelper'(): void
  'computer.status'(): {
    enabled: boolean
    runtime: import('./computerBridge').ComputerRuntimeStatus
    /** Whether a single app can be granted instead of the whole display; null on a host that cannot. */
    apps: import('./computerBridge').ComputerRuntimeStatus | null
    /** Whether the host's Keep awake setting is holding it awake right now. */
    keepAwake: boolean
    /** Whether app drags may use the real pointer (window moves, text selection). */
    globalPointer: boolean
    /** The pinned Open Computer Use release this host runs. */
    appVersion?: string
    /** Runtime permission snapshot; null when it cannot be checked. */
    appPermissions?: { allGranted: boolean; accessibilityTrusted: boolean; screenCaptureGranted: boolean } | null
    appUpdate?: {
      installedVersion: string | null
      supportedVersion: string
      updateAvailable: boolean
      managed: boolean
    }
  }
  /** Installs the pinned Open Computer Use release for app-scoped access. Owning host only. */
  /** Whether the agent can keep working while the Mac is locked (Open Computer Use's Locked Use). Paired owner devices may read it. */
  'computer.lockedUse'(): ComputerLockedUse
  /** Starts the macOS installer and permission prompts on the host. Owning host only. */
  'computer.lockedUseEnable'(): ComputerLockedUse
  'computer.lockedUseDisable'(): ComputerLockedUse
  'computer.installApps'(): { version: string }
  /** Opens OCU doctor/onboarding on the owning Mac. Does not grant macOS permissions automatically. */
  'computer.openSetup'(): void
  'computer.resetDefaults'(): void
  'computer.apps'(): string[]
  'computer.setEnabled'(enabled: boolean): void
  'computer.setGlobalPointer'(enabled: boolean): void
  'computer.grant'(
    threadId: string,
    scope: { observe: boolean; input: boolean; app?: string },
  ): ComputerSessionSummary | null
  'computer.revoke'(threadId: string): void
  /** Current per-thread computer access on this host. Owning and paired owner devices only. */
  'computer.sessions'(): (ComputerSessionSummary & { threadId: string })[]
  'computer.session'(threadId: string): ComputerSessionSummary | null
  'computer.takeControl'(threadId: string): ComputerSessionSummary | null
  'computer.requestHandoff'(threadId: string): ComputerSessionSummary | null
  'computer.approveHandoff'(threadId: string): ComputerSessionSummary | null
  'computer.declineHandoff'(threadId: string): ComputerSessionSummary | null
  'computer.giveToAgent'(threadId: string): ComputerSessionSummary | null
  'computer.stop'(threadId: string): ComputerSessionSummary | null
  /** With the hash of the frame already shown, an unchanged screen returns `unchanged` and no image. */
  'computer.frame'(
    threadId: string,
    since?: string,
  ): ComputerFrameMeta & { id: string; hash: string } & (
      { unchanged: true } | { unchanged?: undefined; mimeType: string; data: string }
    )
  /** Smooth video of the main display over WebRTC: send the viewer's offer, get the host's answer and the picture size. */
  'computer.rtcOffer'(
    threadId: string,
    offer: string,
  ): { id: string; sdp: string; width: number; height: number; scale: number }
  'computer.rtcKeyFrame'(threadId: string, peerId: string): void
  'computer.rtcClose'(threadId: string, peerId: string): void
  'computer.input'(threadId: string, generation: number, capturedAt: number, action: ComputerAction): void
  /** The kind of text field focused on the computer, for the controlling device's keyboard. */
  'computer.focus'(threadId: string): import('./browserBridge').BrowserFieldFocus
  'computer.disconnect'(threadId: string): void
  'hostBrowser.status'(): {
    available: boolean
    enabled?: boolean
    /** `auto` prefers the connected desktop's native browser; `chromium` always uses this host's Chromium. */
    engine?: 'auto' | 'chromium'
    /** Whether the browser agents use right now is this host's Chromium (false: the connected desktop's native one). */
    selected?: boolean
    /** A paired device can see and control the browser agents use here: the host Chromium or the attached desktop's. */
    viewable?: boolean
    location?: 'execution-host-chromium'
    reason?: string
  }
  'hostBrowser.setup'(): void
  'hostBrowser.profiles'(): BrowserProfileCatalog
  'hostBrowser.profileCreate'(name: string): BrowserProfileInfo
  'hostBrowser.profileRename'(id: string, name: string): void
  'hostBrowser.profileReview'(
    id: string,
    remove: boolean,
  ): { token: string; id: string; name: string; tabs: number; remove: boolean }
  'hostBrowser.profileConfirm'(token: string): void
  'hostBrowser.disable'(): void
  'hostBrowser.importSources'(): BrowserImportSource[]
  'hostBrowser.importProfiles'(source: string): BrowserImportProfile[]
  'hostBrowser.importInspect'(source: string, profileId: string): { token: string; domains: BrowserImportDomain[] }
  'hostBrowser.importRun'(token: string, domains: string[], name: string): BrowserImportStaged
  'hostBrowser.importCancel'(token: string): void
  'hostBrowser.importKeep'(profileId: string): BrowserProfileInfo
  'hostBrowser.importDiscard'(profileId: string): void
  /** Automatic uses the connected desktop's native browser; Host Chromium always uses this host's. */
  'hostBrowser.setEngine'(engine: 'auto' | 'chromium'): void
  'hostBrowser.grants'(): { device: string; thread: string; expires: number }[]
  'hostBrowser.grant'(deviceId: string, taskId: string): void
  'hostBrowser.revoke'(deviceId: string, taskId: string): void
  'hostBrowser.list'(taskId: string): BrowserTabInfo[]
  'hostBrowser.open'(taskId: string, url: string, profileId?: string): { tab: BrowserTabInfo; profileFellBack: boolean }
  'hostBrowser.close'(taskId: string, tabId: string): void
  'hostBrowser.history'(taskId: string, tabId: string, direction: 'back' | 'forward' | 'reload'): void
  'hostBrowser.dialog'(taskId: string, tabId: string): import('./browserBridge').BrowserDialog | null
  'hostBrowser.answerDialog'(taskId: string, tabId: string, dialogId: string, accept: boolean, text?: string): void
  'hostBrowser.frame'(taskId: string, tabId: string): import('./browserBridge').BrowserScreenshot
  'hostBrowser.nextFrame'(
    taskId: string,
    tabId: string,
    after: number,
  ): import('./browserBridge').BrowserLiveFrame | null
  'hostBrowser.read'(taskId: string, tabId: string): import('./browserBridge').BrowserPageSnapshot
  'hostBrowser.upload'(
    taskId: string,
    tabId: string,
    generation: number,
    snapshot: number,
    ref: number,
    path: string,
    workspaceRoot?: number,
  ): { ok: boolean; reason?: string }
  'hostBrowser.downloads'(taskId: string): import('./browserBridge').BrowserDownloadInfo[]
  'hostBrowser.allowDownload'(taskId: string, tabId: string): void
  'hostBrowser.cancelDownload'(taskId: string, downloadId: string): void
  'hostBrowser.saveDownload'(
    taskId: string,
    downloadId: string,
    path: string,
    workspaceRoot?: number,
  ): { path: string; workspaceRoot: number; bytes: number }
  'hostBrowser.take'(taskId: string, tabId: string): BrowserTabInfo
  'hostBrowser.release'(taskId: string, tabId: string): BrowserTabInfo
  'hostBrowser.input'(
    taskId: string,
    tabId: string,
    generation: number,
    input: import('./browserBridge').BrowserHumanInput,
  ): void
  'hostBrowser.navigate'(taskId: string, tabId: string, url: string): BrowserTabInfo
  /** Zoom, appearance, a hard reload or clearing the cache for the tab this device controls. Never cookies. */
  'hostBrowser.adjust'(
    taskId: string,
    tabId: string,
    change: import('./browserBridge').BrowserTabAdjust,
  ): BrowserTabInfo
  /** The kind of field focused in the page, for the controlling device's keyboard. Never the field's value. */
  'hostBrowser.focus'(taskId: string, tabId: string): import('./browserBridge').BrowserFieldFocus
  /** Lays the page out at the controlling device's screen size, or restores the default with `null`. */
  'hostBrowser.fit'(taskId: string, tabId: string, size: { width: number; height: number } | null): { fitted: boolean }
  'hostBrowser.disconnect'(): void
  /** Host-owned tab metadata only; no frame, profile credentials or control grant. */
  'browser.activity'(taskId: string): { available: boolean; tabs: BrowserTabInfo[]; externalURLs?: string[] }
  /** Local desktop-only document origin. Never forwarded to a remote host. */
  'app.content.mount'(html: string): string
  /** Opens a web link in the person's own browser. Plain http(s) links only. */
  'app.openExternal'(url: string): void
  /** Integrated browser tabs of this computer's desktop app; every call names the host and thread it is for. */
  'browser.profiles.list'(hostId: string): BrowserProfileCatalog
  'browser.profiles.importSources'(hostId: string): import('./types/browser').BrowserImportSource[]
  /** Copy website sign-ins once from another browser into a new hidden profile. Local desktop only; values never reach the renderer. */
  'browser.import.profiles'(hostId: string, source: string): import('./types/browser').BrowserImportProfile[]
  'browser.import.inspect'(
    hostId: string,
    source: string,
    profileId: string,
  ): { token: string; domains: import('./types/browser').BrowserImportDomain[] }
  'browser.import.run'(
    hostId: string,
    token: string,
    domains: string[],
    name: string,
  ): import('./types/browser').BrowserImportStaged
  'browser.import.cancel'(hostId: string, token: string): void
  'browser.import.keep'(hostId: string, profileId: string): import('./types/browser').BrowserProfileInfo
  'browser.import.discard'(hostId: string, profileId: string): void
  'browser.profiles.create'(hostId: string, name: string): BrowserProfileInfo
  'browser.profiles.signIn'(hostId: string, profileId: string, url: string): void
  'browser.profiles.rename'(hostId: string, profileId: string, name: string): void
  /** Native review closes affected tabs and explains sign-out before removing site data. */
  'browser.profiles.clear'(hostId: string, profileId: string): { cancelled: boolean }
  'browser.profiles.delete'(hostId: string, profileId: string): { cancelled: boolean }
  'browser.runtimeStatus'(hostId: string): { available: boolean; reason?: string; warning?: string }
  'browser.list'(hostId: string, threadId: string): BrowserTabInfo[]
  'browser.downloads'(hostId: string, threadId: string): import('./browserBridge').BrowserDownloadInfo[]
  'browser.allowDownload'(hostId: string, threadId: string, tabId: string): void
  'browser.cancelDownload'(hostId: string, threadId: string, downloadId: string): void
  'browser.saveDownload'(hostId: string, threadId: string, downloadId: string): { cancelled: boolean }
  'browser.open'(
    hostId: string,
    threadId: string,
    url: string,
    profileId?: string,
  ): { tab: BrowserTabInfo; profileFellBack: boolean }
  'browser.dialog'(hostId: string, threadId: string, tabId: string): import('./browserBridge').BrowserDialog | null
  'browser.handleDialog'(
    hostId: string,
    threadId: string,
    tabId: string,
    dialogId: string,
    accept: boolean,
    text?: string,
  ): void
  'browser.changeProfile'(hostId: string, threadId: string, tabId: string, profileId: string): BrowserTabInfo
  'browser.navigate'(hostId: string, threadId: string, tabId: string, url: string): BrowserTabInfo
  'browser.back'(hostId: string, threadId: string, tabId: string): void
  'browser.forward'(hostId: string, threadId: string, tabId: string): void
  'browser.reload'(hostId: string, threadId: string, tabId: string): void
  'browser.close'(hostId: string, threadId: string, tabId: string): void
  /** Places the tab over this rectangle of the window; `hide` takes it off screen. */
  'browser.show'(
    hostId: string,
    threadId: string,
    tabId: string,
    bounds: { x: number; y: number; width: number; height: number },
  ): void
  'browser.hide'(hostId: string, threadId: string, tabId: string): void
  /** A small picture of a tab for a live view; reading it changes nothing. Null while the page cannot be captured. */
  'browser.preview'(hostId: string, threadId: string, tabId: string): import('./browserBridge').BrowserScreenshot | null
  'browser.takeControl'(hostId: string, threadId: string, tabId: string): BrowserTabInfo
  /** The desktop resolves the active run from the execution server; the renderer never supplies a run identity. */
  'browser.giveControl'(hostId: string, threadId: string, tabId: string): BrowserTabInfo
  'app.content.release'(url: string): void
  'interactive.get'(sessionId: string, id: string, version: number): import('./interactive').InteractiveDocument
  'interactive.list'(sessionId: string): import('./interactive').InteractiveReference[]
  /** The desktop and light screenshots a version's checks took, for Compare. */
  'interactive.media'(sessionId: string, id: string, version: number): { wide: string | null; light: string | null }
  /** Publishes an older version again as the newest one. */
  'interactive.restore'(sessionId: string, id: string, version: number): import('./interactive').InteractiveReference
  'onboarding.get'(): { needed: boolean }
  'onboarding.complete'(): void
  'diagnostics.export'(): string
  'diagnostics.clear'(): void
  'diagnostics.nativeEvent'(kind: 'renderer-crash' | 'desktop-crash'): void
  'skills.availability'(): { available: boolean; installUrl: string }
  'skills.find'(query: string): string
  'skills.stage'(input: {
    source: string
    skill?: string
    projectId: string | null
    updatingId?: string
  }): import('./types').SkillInstallPreview
  'skills.confirm'(stageId: string, includeScripts: boolean): import('./types').ManagedSkill
  /** Writes a skill the person authored. It is pinned, so learning never rewrites it. */
  'skills.create'(input: {
    name: string
    description: string
    content: string
    projectId: string | null
  }): import('./types').ManagedSkill
  /** Edit a copy: a separate authored skill with the same instructions; the original is untouched. */
  'skills.fork'(id: string, name?: string): import('./types').ManagedSkill
  /** A new revision of an authored skill; refused when the revision is stale or the skill is installed or learned. */
  'skills.edit'(
    id: string,
    changes: { description?: string; content?: string },
    expectedRevision: number,
  ): import('./types').ManagedSkill
  'skills.copyUpdate'(id: string): import('./types').SkillCopyUpdate
  'skills.applyCopyUpdate'(
    id: string,
    revision: number,
    sourceRevision: number,
    changes: {
      description: string
      content: string
      files: Record<string, 'copy' | 'source'>
    },
  ): import('./types').ManagedSkill
  'skills.cancel'(stageId: string): void
  'skills.updateSource'(id: string): import('./types').SkillInstallPreview
  'skills.move'(id: string, projectId: string | null): void
  /** Which providers' exports carry a managed skill. Applies to new threads. */
  'skills.setProviders'(id: string, providers: import('./types').AgentProvider[]): void
  'skills.remove'(id: string): void
  'agent.all'(): AgentSessionInfo[]
  'learning.get'(): import('./types').LearningSnapshot
  'learning.apply'(id: string): void
  'learning.retry'(id: string): void
  'learning.dismiss'(id: string): void
  'learning.control'(id: string, action: 'pin' | 'unpin' | 'disable' | 'archive' | 'restore'): void
  'learning.history'(id: string): import('./types').ManagedSkill[]
  'learning.revert'(id: string, revision: number): void
  'learning.run'(): void
  'agent.checkpoint'(id: string): import('./types').SessionCheckpoint | null
  'memory.revert'(id: string, index: number, updatedAt: number): Memory

  'app.systemLanguages': () => string[]
  'reviews.list'(sessionId?: string): ChangeReview[]
  'reviews.get'(id: string): ChangeReview
  'reviews.branches'(id: string): ReviewBranchState[]
  'reviews.inspect'(id: string): ReviewFileState[]
  'reviews.compareCurrent'(id: string, fileId: string): ChangeFile
  'reviews.locate'(id: string, fileId: string, path: string): void
  'reviews.comment'(
    id: string,
    comment: Pick<ReviewComment, 'fileId' | 'side' | 'line' | 'endLine' | 'text' | 'scope'>,
    commentId?: string,
  ): ChangeReview
  'reviews.select'(id: string, commentIds: string[], selected: boolean): ChangeReview
  'reviews.reopenComment'(id: string, commentId: string): ChangeReview
  'reviews.reply'(id: string, commentId: string, text: string, replyId?: string): ChangeReview
  'reviews.removeReply'(id: string, commentId: string, replyId: string): ChangeReview
  'reviews.removeComment'(id: string, commentId: string): ChangeReview
  'reviews.resolveComment'(id: string, commentId: string): ChangeReview
  'reviews.sendComments'(
    id: string,
    commentIds: string[],
    note?: string,
    attachmentIds?: string[],
    context?: FileContext[],
  ): ChangeReview
  'reviews.ai'(id: string): ChangeReview
  'reviews.markReviewed'(id: string, reviewed: boolean): ChangeReview
  'reviews.undoPreview'(id: string): UndoPreview
  'reviews.undoApply'(token: string, fileIds: string[]): ChangeReview
  'reviews.chatUndoPreview'(sessionId: string, userSeq: number): UndoPreview
  'reviews.chatUndoApply'(token: string, fileIds: string[]): void
  'activity.status'(): BackgroundActivity[]
  /** What Ramu's work uses on this host. Owner devices only: it names running work. */
  'resources.snapshot'(): import('./resources').ResourceSnapshot
  /** Host memory and the low-memory state, without reading the process table. */
  'resources.host'(): import('./resources').HostResources
  'activity.cancel'(id: string): void
  'updates.status'(): Promise<AppUpdateStatus>
  'updates.check'(): Promise<AppUpdateStatus>
  'updates.download'(): Promise<AppUpdateStatus>
  'updates.restart'(): Promise<void>
  /** Installs the newest release on this host: through its desktop app, or by rebuilding a headless source checkout. Owner devices only. */
  'updates.apply'(): import('./types').HostUpdateResult
  /** Quits and reopens the desktop app; the background service keeps running. */
  'app.relaunch'(): void
  /** Chats working or waiting for the user. */
  'agent.counts'(): { running: number; needsInput: number }
  /** Notices waiting on a person, shared by every device paired with this computer. */
  'notices.list'(): import('./chat/notices').InboxNotice[]
  'notices.dismiss'(id: string): void
  'notices.clear'(): void
  'notifications.register'(token: string, computerId: string, categories?: string[]): void
  'notifications.unregister'(): void
  'liveActivity.status'(): { enabled: boolean }
  'liveActivity.register'(registration: MobileLiveActivityRegistration): { enabled: boolean }
  'liveActivity.unregister'(activityId: string): void
  'background.status'(): BackgroundStatus
  'background.stop'(): void
  'background.start'(): void
  'background.restart'(): void
  'background.keepAwake'(): { enabled: boolean; active: boolean; supported: boolean; error: string | null }
  'background.login'(enabled: boolean): { firstInstall: boolean }
  /** Access from other devices. These run only for the local desktop app, never for a paired device. */
  'network.status'(): NetworkStatus
  'network.configure'(input: NetworkSettingsInput): NetworkStatus
  /** A new one-time code. `owner` names the dialog that made it: its next offer replaces this one while unused. */
  'network.pair'(role?: 'owner' | 'viewer', owner?: string): PairingOffer
  /** Withdraws an unused offer; false when it was already used, expired or unknown. */
  'network.cancelOffer'(offerId: string): boolean
  /** What became of one offer: pending, redeemed by a device, cancelled or expired. */
  'network.offer'(offerId: string): PairingOfferStatus
  /** Pairs a device that asked, spending the given open offer (and its access). Host-only, like the rest of `network.*`. */
  'network.approveRequest'(requestId: string, access: 'owner' | 'viewer'): NetworkStatus
  'network.denyRequest'(requestId: string): NetworkStatus
  /** Grants a paired device a permission once, for a while or always, or revokes it. Host-only. */
  'network.setDevicePermission'(
    deviceId: string,
    permission: import('./devicePermissions').DevicePermission,
    duration: import('./devicePermissions').PermissionDuration | 'revoke' | 'never',
  ): NetworkStatus
  /** Answers a device's request for a permission. Host-only. */
  'network.decidePermission'(
    requestId: string,
    duration: import('./devicePermissions').PermissionDuration | 'deny' | 'never',
  ): NetworkStatus
  /** What newly paired full-access devices hold. Host-only. */
  'network.setDefaultPermissions'(permissions: import('./devicePermissions').DevicePermission[]): NetworkStatus
  /** What the calling device holds on this host. This computer itself holds everything. */
  'device.permissions'(): import('./devicePermissions').DevicePermissionsView
  /** Asks the person at the host for a permission this device lacks. */
  'device.requestPermission'(permission: import('./devicePermissions').DevicePermission): void
  /** A one-time code that only pairs this device's own computer for agents. Needs the Agents permission. */
  'device.agentPairing'(): { code: string }
  /** Invites the person at this host to connect back to the calling computer with the code it made for that. */
  'device.inviteBack'(invite: Pick<import('./types').PairBackInvite, 'name' | 'urls' | 'code' | 'expiresAt'>): void
  /** Invitations from paired computers to connect back to them. Host only. */
  'network.pairBackInvites'(): import('./types').PairBackInvite[]
  /** Answers an invitation, accepted or not, so it is not offered again. Host only. */
  'network.dismissPairBack'(id: string): void
  'network.revoke'(deviceId: string): NetworkStatus
  /** Days an unused device stays paired (1 to 3650), `never`, or null for the server default. Host-only, like the rest of `network.*`. */
  'network.setDeviceLifetime'(days: number | 'never' | null): NetworkStatus
  /** A tunnel's https:// address for this host, or null to remove it. */
  'network.setPublicUrl'(url: string | null): NetworkStatus
  /** Runs a tunnel for this host (turning on access for this computer only if it is off), or stops it with null. */
  'network.setTunnel'(choice: TunnelChoice | null): NetworkStatus
  /** One device's pairing lifetime: days, never, or back to this host's default. Host only. */
  'network.setDeviceExpiry'(deviceId: string, days: number | 'never' | 'default'): NetworkStatus
  /** A paired device saying what it runs on, so this host shows the right icon and OS for it. */
  'device.describe'(os: import('./types').DeviceOs): void
  /** Hosts only: the most access threads that paired host starts here may have. */
  'network.setHostAccess'(deviceId: string, access: 'edits' | 'auto' | 'full'): NetworkStatus
  /** Other hosts this host's agents may start threads on. */
  'network.agentHosts'(): import('./types').AgentHostSummary[]
  /** Pairs this host with another as a host pairing, using a code from `ramu pair` there. */
  'network.addAgentHost'(address: string, code: string, name?: string): import('./types').AgentHostSummary[]
  'network.forgetAgentHost'(id: string): import('./types').AgentHostSummary[]
  /** Computers this app is connected to, all at once. Handled by the desktop app itself. */
  'computers.settings.invoke'(id: string, method: string, args: unknown[]): unknown
  'computers.settings.get'(id: string): SettingsSnapshot
  'computers.settings.patch'(id: string, edits: SettingEdit[]): SettingsSnapshot
  'computers.list'(): Computers
  'computers.scope'(id: string | null): Computers
  'computers.tasks.invoke'<M extends HostTaskMethod>(
    id: string,
    method: M,
    args: Parameters<RamuMethods[M]>,
  ): ReturnType<RamuMethods[M]>
  /** Runs an allow-listed method on one host's server, whichever window asks. Same as `RamuBridge.invokeOn`. */
  'computers.invoke'(id: string, method: string, args: unknown[]): unknown
  'computers.overview'(id: string): HostOverview
  /** Opens the live view window above other apps, or closes it. Desktop only. */
  'live.window'(open: boolean, hideFromSharing?: boolean): void
  /** From the live view window: bring the main window forward on that thread. */
  'live.open'(hostId: string, taskId: string): void
  'live.close'(): void
  /** Memory the desktop app's own windows and browser tabs use, in bytes. */
  'computers.appMemory'(): number
  /** The threads this window shows from a host: only they stream in full, and the host's other threads arrive in brief. */
  'computers.threads'(id: string, sessionIds: string[]): void
  'computers.navigate'(id: string, destination: HostDestination): void
  'computers.navigation.ready'(): void
  /** The hosts whose workspace stores this window shows besides its own; their host events reach it while on screen. */
  'computers.recapAct'(
    id: string,
    recapId: string,
    action: 'open' | 'done' | 'dismissed' | 'snoozed',
    until?: number,
  ): void
  /** Brings a computer's window to the front. Rejects when it cannot be reached. */
  'computers.open'(id: string): void
  'computers.pair'(url: string, code: string, name?: string): Computers
  /** Asks a nearby host to pair; a person there allows it when both show the number sent as `computers:pairCode`. */
  'computers.pairByRequest'(url: string, name?: string): Computers
  'computers.cancelPairRequest'(): null
  'computers.sshHosts'(): string[]
  /** Nearby hosts heard on this computer's networks. Browsing runs here, never on a selected host, and lists only. */
  'computers.discovery.start'(): NearbyHostsState
  'computers.discovery.state'(): NearbyHostsState
  'computers.discovery.stop'(): NearbyHostsState
  /** Adds a computer over SSH: `target` is user@host or an alias from ~/.ssh/config. */
  'computers.pairSsh'(target: string, name?: string): Computers
  'computers.forget'(id: string): Computers
  'computers.retry'(id: string): Computers
  /** Moves a saved host to a new address after that address proves it is the host paired with; otherwise changes nothing. */
  'computers.reviewAddress'(id: string, url: string): ReviewAddressResult
  'computers.update'(
    id: string,
    changes: { name?: string; enabled?: boolean; retryMode?: 'events' | 'periodic' },
  ): Computers
  /** Renderer acknowledgement after its workspace has been safely persisted. */
  'skills.list'(taskId: string): SkillInfo[]
  'schedules.list'(): Schedule[]
  'schedules.save'(input: ScheduleInput, id?: string): Schedule
  'schedules.pause'(id: string, paused: boolean): Schedule
  'schedules.delete'(id: string): void
  'schedules.runNow'(id: string): ScheduleRun
  'schedules.runs'(id?: string): ScheduleRun[]
  'schedules.preview'(rule: ScheduleRule, timezone: string): number[]
  /** The latest requests a webhook schedule received, newest first. */
  'schedules.deliveries'(id: string): import('./types').WebhookDelivery[]
  /** Starts a run from a delivery again, whatever its outcome was (a filter that was too strict, a paused schedule). */
  'schedules.replay'(id: string, deliveryId: string): import('./types').WebhookDelivery
  /** Starts a run from a made-up request shaped like the preset expects. */
  'schedules.sendTest'(id: string): import('./types').WebhookDelivery
  /** Where senders reach this schedule, through every route the host has, and its signing secret for copying. */
  'schedules.webhook'(id: string): { path: string; urls: { url: string; via: string }[]; secret: string | null }
  /** A new address and secret; the old ones stop working at once. */
  'schedules.rotateWebhook'(id: string): Schedule
  /** A secret the sender chose (Sentry gives you one), or null to sign nothing. */
  'schedules.setWebhookSecret'(id: string, secret: string | null): Schedule
  /** The schedule project's repositories on GitHub, to create its webhook on. */
  'schedules.githubRepos'(id: string): { repoId: string; name: string; slug: string }[]
  /** Creates the webhook on that repository with the schedule's HTTPS address, secret and events. */
  'schedules.connectGithub'(id: string, repoId: string): Schedule
  'recaps.get'(): RecapSnapshot
  'recaps.refresh'(): RecapSnapshot
  'recaps.act'(id: string, action: 'open' | 'done' | 'dismissed' | 'snoozed', until?: number): void
  'memory.get'(): MemorySnapshot
  'memory.save'(input: MemoryInput, id?: string): Memory
  'memory.archive'(id: string): Memory
  'memory.restore'(id: string): Memory
  'memory.delete'(id: string): void
  'memory.history'(
    id: string,
  ): { action: string; actor: string; reason: string | null; before: Partial<Memory> | null; at: number }[]
  'memory.dream'(): MemorySnapshot
  'summaries.get'(): import('./types').SummariesSnapshot
  'summaries.read'(id: string): import('./types').LibrarySummary
  'summaries.dismiss'(id: string): void
  'summaries.run'(): import('./types').SummaryRunResult
  /** Starts a review chat seeded with the summary and links it back. */
  'summaries.discuss'(id: string, text: string, settings?: AgentSettings): { taskId: string; sessionId: string }
  /** What Continue on another host shows and sends, read on the thread's own host. */
  'threads.continuationPackage'(taskId: string): import('./continuation').ContinuationPackage
  /** What this host would do with a continued thread: its project, the model it would run, where a clone would go. */
  'threads.prepareContinuation'(
    repo: Pick<import('./continuation').ContinuationRepo, 'remoteUrl' | 'repoName'>,
    settings: AgentSettings,
  ): { match: import('./continuation').ContinuationMatch | null; settings: AgentSettings; parent: string }
  'threads.continueHere'(start: import('./continuation').ContinuationStart): StartedThread
  /** Continue in a new worktree: a linked thread on a new branch with this conversation and the uncommitted changes. */
  'threads.continueInWorktree'(sessionId: string, settings?: AgentSettings): StartedThread
  /** Labels the original thread once its continuation has started. */
  'threads.noteContinued'(taskId: string, event: import('./continuation').ContinuedEvent): void
  'folders.roots'(): string[]
  'folders.list'(path: string): { path: string; parent: string | null; folders: { name: string; path: string }[] }
  'folders.create'(parent: string, name: string): string
  /** Clones into a new folder. A client-chosen `cloneId` lets progress be read and the clone cancelled. */
  'folders.clone'(parent: string, name: string, url: string, cloneId?: string): string
  /** How far a running clone has got; null when it is not running (finished, cancelled or unknown). */
  'folders.cloneProgress'(cloneId: string): { phase: string; percent: number | null; running: boolean } | null
  /** Stops a running clone and removes the folder it was filling. */
  'folders.cancelClone'(cloneId: string): boolean
  'folders.addProject'(path: string): { project: Project; repositories: Repository[] }
  'projects.list'(): Project[]
  /**
   * Picks the destination project for a first prompt before any thread exists; ambiguous or unknown asks the person.
   * With `split`, a request that needs work in several projects returns `split`. `others` adds projects on the client's
   * other hosts (ids are the client's own), so one prompt can reach them; `localHost` is this host's name as the client
   * shows it, so a prompt can tell copies of a project apart.
   */
  'projects.route'(
    prompt: string,
    settings: AgentSettings,
    options?: { others?: RoutingCandidate[]; localHost?: string },
  ): RoutingOutcome
  'projects.setup'(projectId: string | null): ProjectSetup
  /**
   * A new project folder beside the person's other repositories, as `project_create` makes it: the stack's generator
   * (none writes an empty project), `ramu.json`, a first commit, then added as a project.
   */
  'projects.create'(input: { name: string; stack?: import('./stacks').StackId }): { project: Project; path: string }
  'projects.inspect'(dir: string): FolderInspection
  'projects.addFolder'(dir: string, repos?: string[]): { project: Project; repositories: Repository[] }
  'repos.list'(projectId: string): Repository[]
  'repos.add'(projectId: string, dir: string): Repository
  'repos.pick'(purpose?: 'project' | 'repository'): string | null
  'workspaces.list'(): WorktreeWorkspace[]
  'workspaces.rename'(workspaceId: string, name: string, before: string): WorktreeWorkspace
  'tasks.list'(): Task[]
  'tasks.agentDefaults'(
    projectId: string,
    defaultProvider: AgentSettings['provider'],
  ): import('./workspace/agentDefaults').ProjectAgentDefaults
  'tasks.workspaceOptions'(projectId: string): {
    defaultCheckoutMode: 'current' | 'worktree'
    branchPrefix: string
    branchNaming: BranchNamingStrategy
    branchInstructions: string
    configSource?: 'ramu.json' | '.ramu/config.json'
    configError?: string
    worktreeUnavailable: string | null
  }
  'tasks.plan'(
    projectId: string,
    title: string,
    repoIds: string[],
    choice?: BranchChoice,
    naming?: { branchPrefix: string; strategy: BranchNamingStrategy },
  ): WorktreePlanEntry[]
  'tasks.generateBranch'(projectId: string, title: string, intent: BranchNamingIntent, requestId?: string): BranchChoice
  'tasks.cancelBranch'(requestId: string): void
  'tasks.create'(input: CreateTaskInput, plan?: WorktreePlanEntry[]): Task
  'tasks.setup'(taskId: string): RepositoryBinding[]
  /**
   * `tasks.create`, then `tasks.setup` for a worktree, then `agent.start`, in one call. A failure after the thread
   * exists comes back as `error` with its `task` (and no session), so the caller can keep and retry it.
   */
  'thread.start'(
    input: CreateTaskInput,
    plan: WorktreePlanEntry[] | undefined,
    prompt: string,
    settings?: AgentSettings,
    attachments?: string[],
    context?: FileContext[],
  ): { task: Task; session: AgentSessionInfo | null; error?: string }
  /** Starts one thread in a project on this host for a person on another host's Home, at the project's default checkout. */
  'threads.startInProject'(
    input: { projectId: string; title: string; prompt: string },
    settings: AgentSettings,
  ): StartedThread
  'tasks.rename'(taskId: string, title: string): Task
  /** AI-written title. An automatic call leaves a title the user typed alone; `force` replaces it. */
  'tasks.generateTitle'(taskId: string, settings: AgentSettings, force?: boolean): Task
  'tasks.archive'(taskId: string, archived: boolean): Task
  'tasks.pin'(taskId: string, pinned: boolean): Task
  'tasks.done'(taskId: string, done: boolean): Task
  'tasks.delete'(
    taskId: string,
    removeWorktrees: boolean,
    review?: import('./chat/taskRemoval').TaskRemovalReview,
  ): void
  'projects.rename'(projectId: string, name: string): Project
  'projects.setRouting'(projectId: string, aliases: string[], description: string): Project
  'projects.reorder'(projectIds: string[]): Project[]
  'projects.remove'(projectId: string): void
  'projects.reveal'(projectId: string): void
  'projects.actions'(projectId: string): ProjectAction[]
  'projects.setActions'(projectId: string, actions: ProjectAction[]): ProjectAction[]
  'projects.actionSettings'(projectId: string): ProjectActionSettings
  'projects.setActionVisibility'(projectId: string, actionId: string, hidden: boolean): ProjectActionSettings
  'projects.resetActionOrder'(projectId: string): ProjectActionSettings
  'projects.reorderActions'(projectId: string, actionIds: string[]): ProjectActionSettings
  'repos.remove'(repoId: string): void
  'tasks.bindings'(taskId: string): RepositoryBinding[]
  'settings.models.get'(): ModelPreferences | null
  'providers.status'(
    configuration?: ProviderConfiguration,
    checkLatest?: boolean,
    refresh?: boolean,
  ): Promise<ProviderStatus[]>
  /** Sign-in email per provider and login ID, for the logins whose CLI reports one. */
  'providers.accountEmails'(): Promise<Record<string, Record<string, string>>>
  /** Each login's sign-in email and whether it uses an API key, by provider and account, for naming logins. */
  'providers.accountLogins'(): Promise<Record<string, Record<string, AccountLogin>>>
  'mcp.status'(): SharedMcpManagement & { canAdminister: boolean }
  'mcp.save'(input: Omit<SharedMcpConnection, 'id' | 'hostId' | 'revision'>, connectionId?: string): SharedMcpConnection
  'mcp.account'(account: SharedMcpProviderAccount): void
  /** Drops a provider account from shared approvals; its provider login is untouched. */
  'mcp.removeAccount'(provider: SharedMcpProviderAccount['provider'], accountId: string): void
  'mcp.check'(connectionId: string, selection: SharedMcpSelection): Promise<SharedMcpInspection>
  /** Checks every shared connection a login could use again and returns its readiness. */
  'mcp.recheckAccount'(
    provider: SharedMcpProviderAccount['provider'],
    accountId: string,
    projectId: string | null,
  ): Promise<SharedMcpAccountReadiness[]>
  'mcp.approve'(input: Omit<SharedMcpGrant, 'id' | 'accountIds' | 'shared'> & { accountId: string }): SharedMcpGrant
  /**
   * Starts OAuth sign-in on the host and returns the page to open there, or null when stored tokens already work.
   * Only the host's own window can run it: the callback is a loopback listener on the host.
   */
  'mcp.signIn'(connectionId: string): Promise<{ url: string } | null>
  'mcp.completeSignIn'(connectionId: string, address: string): Promise<boolean>
  'mcp.cancelSignIn'(connectionId: string): void
  /** Write-only: the value is stored on the host and never returned by any method. */
  'mcp.setCredential'(connectionId: string, name: string, value: string): Promise<void>
  'mcp.removeCredential'(connectionId: string, name: string): Promise<void>
  /** Removes Ramu's credentials and asks the service to revoke its OAuth tokens: `revoked`, `unsupported`, `failed` or `none`. */
  'mcp.disconnect'(connectionId: string): Promise<'none' | 'revoked' | 'unsupported' | 'failed'>
  'mcp.remove'(connectionId: string): Promise<void>
  'mcp.checkCredentialStore'(): Promise<'available' | 'unavailable' | 'not-checked'>
  /** Copy a declared server's non-secret definition into Shared MCP for one project. Connects nothing. */
  'mcp.import'(
    ...args:
      | [projectId: string, key: string]
      | [key: string, projectId: string, providers: SharedMcpProviderAccount['provider'][]]
  ): SharedMcpConnection
  /** Write-only: store one header or environment secret on the host. Nothing reads the value back. */
  'mcp.setSecret'(connectionId: string, kind: 'header' | 'env', name: string, value: string): Promise<void>
  /** Remove one secret from a connection and delete its stored value. */
  'mcp.removeSecret'(connectionId: string, kind: 'header' | 'env', name: string): Promise<void>
  /**
   * Give a declared server to every provider and account, or stop. With a project the choice covers that project
   * only; `null` removes that choice (or the host-wide one). Takes effect for new sessions.
   */
  'mcp.share'(key: string, shared: boolean | null, projectId?: string): void
  /** Copy a skill from the person's own provider folder to every provider and account. Applies to new threads. */
  'skills.share'(name: string, shared: boolean | null, projectId?: string): void
  'providers.loginCommand'(
    provider: ProviderStatus['provider'],
    configuration?: ProviderConfiguration,
  ): Promise<string | null>
  /** In-app sign-in for runtimes without a login command (Antigravity). Resolves after the browser flow completes. */
  'providers.signIn'(
    provider: ProviderStatus['provider'],
    accountId?: string,
    method?: AntigravitySignIn,
  ): Promise<void>
  /** Signs one login in with an API key on the execution host; `key` null removes it so the subscription login is used. */
  'providers.setApiKey'(
    provider: ProviderStatus['provider'],
    accountId: string,
    variable: string,
    key: string | null,
  ): Promise<void>
  'providers.update'(provider: ProviderStatus['provider']): Promise<ProviderStatus>
  /** Live ability checks for each provider's chosen login on its installed version, plus whether checks are running. */
  'abilities.checks'(): { checks: AbilityCheck[]; running: boolean }
  /** Runs one provider's ability checks again (one small request per ability). */
  'abilities.check'(provider: ProviderStatus['provider']): Promise<AbilityCheck[]>
  /** Runs a finished ability call again with the same input, on any provider or only on one other than the first. */
  'abilities.again'(sessionId: string, callId: string, otherProvider: boolean): Promise<AbilityCall>
  'providers.updates'(): Promise<ProviderStatus[]>
  'providers.dismissUpdate'(provider: ProviderStatus['provider'], binary: string, latestVersion: string): void
  'providers.environment'(retry?: boolean): Promise<ProviderEnvironmentStatus>
  'providers.setEnvironment'(values: ProviderEnvironmentValues): Promise<ProviderEnvironmentStatus>
  'providers.pickBinary'(): string | null
  'settings.app.snapshot'(): SettingsSnapshot
  'settings.app.patch'(edits: SettingEdit[]): SettingsSnapshot
  'settings.permissions.clear'(removal?: import('./types').PermissionRemoval): void
  'settings.permissions.list'(): import('./types').SavedPermissionRule[]
  'settings.permissions.remove'(id: string): void
  'settings.app.get'(): AppPreferences
  /** Shared mobile display preferences kept on the host the phones are paired with. */
  'preferences.layers.get'(): import('./modelFlow').PreferenceLayersSnapshot
  /** Sets or clears (no `value`) one shared mobile field; the host refuses any other field or value. */
  'preferences.layers.set'(edit: {
    id: import('./sharedFields').SharedMobileField
    value?: string | boolean
    at: number
    by: string
  }): import('./modelFlow').PreferenceLayersSnapshot & { applied: boolean }
  'settings.app.set'(preferences: AppPreferences): void
  'settings.models.set'(preferences: ModelPreferences): void
  'ui.get'(): { workspace: WorkspaceUiState; tasks: Record<string, TaskUiState> }
  'ui.setWorkspace'(ui: WorkspaceUiState): void
  'ui.setTask'(taskId: string, ui: TaskUiState): void
  'files.search'(taskId: string, options: SearchOptions): SearchResults
  'files.replacePreview'(taskId: string, options: SearchOptions, replacement: string): ReplaceFilePreview[]
  'files.replaceApply'(
    taskId: string,
    options: SearchOptions,
    replacement: string,
    expected: ReplaceFilePreview[],
  ): void
  'files.create'(taskId: string, repoId: string, path: string, kind: 'file' | 'dir'): void
  'files.rename'(taskId: string, repoId: string, path: string, destination: string): void
  'files.copy'(taskId: string, repoId: string, path: string, destination: string): void
  'files.import'(taskId: string, repoId: string, dir: string, paths: string[]): string[]
  'files.dropInfo'(paths: string[]): { path: string; kind: 'file' | 'dir' }[]
  /** Permanently deletes a file or folder inside the checkout. */
  'files.delete'(taskId: string, repoId: string, path: string): void
  /** Whether an agent is writing in this checkout, so a rename, move or delete can collide with its work. */
  'files.writer'(taskId: string, repoId: string): { active: boolean }
  'files.reveal'(taskId: string, repoId: string, path: string): void
  'files.explorerBindings'(context: string): RepositoryBinding[]
  'files.browse'(
    context: string,
    repoId: string,
    path: string,
    cursor?: string,
  ): {
    entries: DirEntry[]
    truncated: boolean
    nextCursor?: string
  }
  'files.list'(taskId: string, repoId: string, path: string): DirEntry[]
  'files.read'(taskId: string, repoId: string, path: string): FileContent
  'files.editorconfig'(taskId: string, repoId: string, path: string): EditorConfigProps
  'files.image'(taskId: string, repoId: string, path: string): string
  'files.media'(taskId: string, repoId: string, path: string): { mimeType: string; size: number; url: string }
  'files.write'(taskId: string, repoId: string, path: string, content: string, baseHash: string | null): SaveResult
  'git.status'(taskId: string, repoId: string): GitStatus
  'git.lineStats'(taskId: string, repoId: string): { added: number; removed: number }
  'git.diff'(taskId: string, repoId: string, path: string, staged: boolean | 'all'): DiffContents
  'git.stage'(taskId: string, repoId: string, paths: string[]): void
  'git.unstage'(taskId: string, repoId: string, paths: string[]): void
  'git.discardPreview'(
    taskId: string,
    repoId: string,
    paths: string[],
  ): { fingerprint: string; files: { path: string; untracked: boolean }[] }
  'git.discard'(taskId: string, repoId: string, paths: string[], fingerprint?: string): void
  'git.undoCommit'(taskId: string, repoId: string, expectedHead: string): string
  'git.commitBranchInfo'(taskId: string, repoId: string): { branch: string | null; defaultBranch: string | null }
  'git.createBranch'(taskId: string, repoId: string, name: string): void
  'git.createBranchFrom'(taskId: string, repoId: string, name: string, from: string): void
  'git.renameBranch'(taskId: string, repoId: string, name: string): void
  'git.mergeBranch'(taskId: string, repoId: string, name: string): void
  'git.deleteBranch'(taskId: string, repoId: string, name: string): void
  'git.stashes'(taskId: string, repoId: string): GitStash[]
  'git.stashFiles'(taskId: string, repoId: string, oid: string): GitCommitFile[]
  'git.stashFileDiff'(taskId: string, repoId: string, oid: string, path: string): DiffContents
  'git.stash'(taskId: string, repoId: string, name: string, stagedOnly?: boolean): void
  'git.popStash'(taskId: string, repoId: string, oid: string): void
  'git.applyStash'(taskId: string, repoId: string, oid: string): void
  'git.dropStash'(taskId: string, repoId: string, oid: string): void
  'git.commit'(
    taskId: string,
    repoId: string,
    message: string,
    fingerprint?: string,
    amendHead?: string,
    branchOptions?: CommitBranchOptions,
  ): string
  'git.history'(taskId: string, repoId: string): GitCommit[]
  'git.branches'(taskId: string, repoId: string): GitBranchInfo[]
  'git.checkout'(taskId: string, repoId: string, branch: string): void
  'git.init'(taskId: string, repoId: string): void
  'git.fetch'(taskId: string, repoId: string): void
  'git.pull'(taskId: string, repoId: string, mode?: PullMode): void
  'git.refreshRemote'(taskId: string, repoId: string, mayPull: boolean): boolean
  'git.autoPull'(taskId: string, repoId: string): boolean
  'git.sync'(taskId: string, repoId: string, approval?: import('./protectedBranch').SyncApproval): void
  'git.continueOperation'(taskId: string, repoId: string): void
  /** A conflicted file with its conflicts, for choosing a side in each. */
  'git.conflictFile'(taskId: string, repoId: string, path: string): import('./types').ConflictFile
  /** Keeps one side of one conflict (`hunk`) or of the whole file, and stages the file once nothing is left. */
  'git.resolveConflict'(
    taskId: string,
    repoId: string,
    path: string,
    choice: import('./conflicts').ConflictChoice,
    hunk?: number,
    hash?: string,
  ): { resolved: boolean }
  /** One side for every conflicted file; files that cannot take it are listed instead. */
  'git.resolveAllConflicts'(
    taskId: string,
    repoId: string,
    choice: import('./conflicts').ConflictChoice,
  ): { resolved: number; skipped: { path: string; error: string }[] }
  'git.abortOperation'(taskId: string, repoId: string): void
  'git.push'(taskId: string, repoId: string, expectedBranch?: string, remote?: string): void
  /** Remotes to choose between before publishing a branch with no upstream; null when nothing needs choosing. */
  'git.remoteChoices'(taskId: string, repoId: string): string[] | null
  'git.commitFiles'(taskId: string, repoId: string, oid: string): GitCommitFile[]
  'git.commitFileDiff'(taskId: string, repoId: string, oid: string, path: string): DiffContents
  'git.commitDetails'(taskId: string, repoId: string, oid: string): string
  'git.compareUpstream'(taskId: string, repoId: string): string
  'git.generateCommit'(taskId: string, repoId: string, settings: AgentSettings, includeBranch?: boolean): CommitDraft
  /** The pull request for the checked-out branch, through the GitHub CLI. */
  'forge.pullRequest'(taskId: string, repoId: string): ForgeStatus
  'forge.watchStatus'(taskId: string, repoId: string, url: string): PullRequestWatchStatus
  'forge.watch'(taskId: string, repoId: string, url: string, sessionId: string | null): void
  /** Delivers feedback to the watched thread, or returns null when no thread is watching. */
  'forge.sendFeedback'(taskId: string, repoId: string, kind: PullRequestFeedbackKind): string | null
  'forge.pullRequestDraft'(taskId: string, repoId: string): PullRequestDraft
  /** Publishes the branch when needed, then opens the pull request. */
  /** GitHub sign-ins this host already holds (read-only). Pass nothing; the host runs `gh auth status`. */
  'forge.connections'(): ForgeConnectionSummary
  /** GitLab servers this host can use; `check` asks each one who is signed in. */
  'forge.gitlab'(check: boolean): GitlabSummary
  /** Checks and saves a GitLab token for one server (`gitlab.com` or `host[:port]`). Host only. */
  'forge.saveGitlab'(input: { origin: string; token: string }): import('./types').GitlabSummary
  'forge.removeGitlab'(): import('./types').GitlabSummary
  /** Bitbucket Cloud's credential on this host; `check` asks Bitbucket whose it is. */
  'forge.bitbucket'(check: boolean): BitbucketSummary
  /** Checks and saves a Bitbucket API token (with its account email) or access token. Host only. */
  'forge.saveBitbucket'(input: { email?: string; token: string }): BitbucketSummary
  'forge.removeBitbucket'(): BitbucketSummary
  /** Azure DevOps on this host; `check` asks Azure DevOps whose token it is. */
  'forge.azure'(check: boolean): AzureSummary
  /** Checks and saves an Azure DevOps personal access token for an organization. Host only. */
  'forge.saveAzure'(input: { organization: string; token: string }): AzureSummary
  'forge.removeAzure'(): AzureSummary
  /** Instruction files providers read on their own (AGENTS.md, CLAUDE.md, rules folders) for a project and the user; read-only. */
  'rules.native'(projectId: string | null): NativeInstructions
  /** Saves or replaces a GitHub token on this host after the server vouches for it. Host administrators only. */
  'forge.saveConnection'(input: ForgeSaveConnectionInput): ForgeSavedConnection
  /** Verifies a saved token again; a failure records why and keeps the credential. */
  'forge.checkConnection'(connectionId: string): ForgeSavedConnection
  'forge.setConnectionEnabled'(connectionId: string, enabled: boolean): void
  /** Removes only Ramu's saved token; a detected CLI sign-in is untouched and watches that used it end. */
  'forge.removeConnection'(connectionId: string): void
  /** The account an origin uses: a saved connection id, `cli` or `cli:<login>`. */
  'forge.selectAccount'(origin: string, account: string): void
  /** Pins this repository to an account, or clears the pin with null. */
  'forge.setRepositoryAccount'(taskId: string, repoId: string, account: string | null): void
  /** API reads, writes and Git transport for this repository, separately; nothing is pushed. */
  'forge.checkAccess'(taskId: string, repoId: string): ForgeAccessReport
  'rules.list'(): Rule[]
  'rules.save'(input: RuleInput): Rule
  'rules.remove'(ruleId: string): void
  'rules.history'(ruleId: string): RuleRevision[]
  'rules.restore'(ruleId: string, revision: number): Rule
  'forge.publishRepository'(taskId: string, repoId: string, input: PublishRepositoryInput): void
  'forge.createPullRequest'(taskId: string, repoId: string, input: PullRequestInput): ForgeStatus
  /** An opening message that hands failing checks or open review comments to an agent. */
  'forge.pullRequestFeedback'(taskId: string, repoId: string, kind: PullRequestFeedbackKind): string
  /** The repository's pull requests in groups for the account in use; `force` skips the host's short cache. */
  'forge.pullRequests'(
    taskId: string,
    repoId: string,
    includeClosed: boolean,
    force: boolean,
  ): import('./types').PullRequestList
  'forge.mergeOptions'(taskId: string, repoId: string, url: string): import('./types').MergeOptions
  /** Merge, close, reopen, mark ready or update the branch. Never available to agents. */
  'forge.pullRequestAction'(
    taskId: string,
    repoId: string,
    url: string,
    action: import('./types').PullRequestAction,
  ): void
  'forge.reviewThreads'(taskId: string, repoId: string, url: string): import('./types').PullRequestThread[]
  /**
   * Brings the pull request up to date with its base: on the hosting service when it can, otherwise by merging the base
   * in the thread's checkout of the branch and pushing. Conflicts stay in that checkout to resolve.
   */
  'forge.updateBranch'(
    taskId: string,
    repoId: string,
    url: string,
  ): { where: 'service' | 'checkout'; taskId: string | null; conflicts: number; pushed: boolean }
  /** How to open a pull request in a thread: to work on it, or to review it with an agent. */
  'forge.pullRequestHandoff'(
    taskId: string,
    repoId: string,
    url: string,
    purpose: 'work' | 'review',
  ): import('./types').PullRequestHandoff
  /** Records that a new thread works on (or reviews) a pull request, after its first message started. */
  'forge.linkPullRequest'(taskId: string, repoId: string, url: string, purpose: 'work' | 'review'): void
  /** Drafted replies or review waiting for `url`, or null. */
  'forge.drafts'(url: string): import('./types').PullRequestDraftBatch | null
  /** Pushes when asked, then posts the checked replies; a failed push posts nothing. */
  'forge.sendReplies'(batchId: string, input: import('./types').SendRepliesInput): import('./types').SendRepliesResult
  'forge.sendReview'(
    batchId: string,
    review: {
      verdict: import('./types').ReviewVerdict
      body: string
      comments: { path: string; line: number; body: string }[]
    },
  ): void
  'forge.discardDrafts'(batchId: string): void
  /** Keeps the person's edits to drafted replies or a drafted review on the host, where the agent can read them. */
  'forge.editDrafts'(
    batchId: string,
    change:
      | {
          kind: 'replies'
          edits: { threadId: string; outcome: import('./types').ReviewReplyOutcome; reply: string }[]
        }
      | {
          kind: 'review'
          verdict: import('./types').ReviewVerdict
          body: string
          comments: { id: string; body: string }[]
        },
  ): void
  'forge.issues'(repoId: string, search: string): IssueSummary[]
  /** Repositories the host's GitHub account can see (yours when the search is empty), or one `owner/name`; to clone. */
  /** Repositories to clone. `origin` names a GitHub Enterprise server that has a saved connection on this host. */
  'forge.searchRepositories'(search: string, origin?: string): ForgeRepositorySummary[]
  /** The GitHub account this repository would use, with its source, before anything runs. */
  'forge.repositoryAccount'(taskId: string, repoId: string): ForgeRepositoryAccount
  'forge.issue'(repoId: string, number: number): { link: IssueLink; prompt: string }
  /** Records the issue a chat was started from, so its pull request can close it. */
  'forge.linkIssue'(taskId: string, link: IssueLink | null): void
  'forge.issueLink'(taskId: string): IssueLink | null
  'term.open'(taskId: string, repoId: string | null, cols: number, rows: number): TerminalInfo
  'term.openSetup'(cols: number, rows: number): TerminalInfo
  'term.write'(termId: string, data: string): void
  'term.resize'(termId: string, cols: number, rows: number): void
  'term.close'(termId: string): void
  /** How many of these terminals have a command running in the foreground. */
  'term.busy'(termIds: string[]): number
  'editor.menu'(
    options: { selection: string; editable: boolean; comment: boolean },
    point: { x: number; y: number },
  ): 'cut' | 'undo' | 'redo' | 'selectAll' | 'find' | 'comment' | { paste: string } | null
  /** Writes plain text, with an HTML version when there is one, so rich targets keep tables, lists and links. */
  'clipboard.write'(text: string, html?: string): void
  'term.menu'(selection: string, point: { x: number; y: number }): 'selectAll' | 'clear' | { paste: string } | null
  'agent.list'(taskId: string): AgentSessionInfo[]
  'agent.get'(sessionId: string): AgentSessionInfo
  'agent.goal'(sessionId: string): ChatGoal | null
  /** Records that the person has looked at this session's advisor consultations, clearing the unread count. */
  'agent.markAdviceRead'(sessionId: string): void
  'agent.goal.control'(sessionId: string, action: 'pause' | 'resume' | 'clear'): ChatGoal | null
  /**
   * Sets, changes or removes (null or blank) the command Ramu runs when the agent claims the goal is done. Only the user
   * can call this; the agent's goal tools cannot. Rejects with no goal, or a completed one. The command runs in the
   * thread's folder with a ten-minute limit.
   */
  'agent.goal.verify'(sessionId: string, command: string | null): ChatGoal
  'agent.events'(sessionId: string): AgentEvent[]
  /** The end of a transcript, bounded and starting at a turn where one fits, to show a long thread while the rest loads. */
  'agent.tail'(sessionId: string): { complete: boolean; events: { seq: number; event: AgentEvent }[] }
  /** Only the transcript rows that changed since `cursor` (a prior `cursor` from this call or a snapshot's revision counter); `reset` means a full snapshot. */
  'agent.changes'(
    sessionId: string,
    cursor: number,
    knownLastSeq: number,
  ): {
    reset: boolean
    cursor: number
    lastSeq: number
    revision: number
    events: { seq: number; event: AgentEvent }[]
  }
  'term.list'(taskId: string): TerminalInfo[]
  /** Starts a persistent command in the thread's folder; repeating a running one returns it instead of starting another. */
  'term.background.launch'(taskId: string, repoId: string | null, command: string): BackgroundTerminalInfo
  /** The thread's persistent commands, running first. Works while the thread is idle. */
  'term.background.list'(taskId: string): BackgroundTerminalInfo[]
  /** One command and its bounded output; rejects an id the thread does not own. */
  'term.background.inspect'(taskId: string, termId: string): BackgroundTerminalInfo & { output: string }
  /** Requests termination of that command's process group (`force` kills it). Safe to repeat and after it ended. */
  'term.background.stop'(taskId: string, termId: string, force?: boolean): BackgroundTerminalInfo
  /** With `since` (the cursor already shown), only the output after it when the host still holds that much; the output always ends at `cursor`. */
  'term.snapshot'(
    termId: string,
    since?: number,
  ): { output: string; cursor: number; exited: boolean; resume?: 'live' | 'replay' | 'snapshot' }
  /** Your messages and the agent's replies that contain `query`, newest first, across every chat. */
  'agent.searchMessages'(query: string): ChatSearchHit[]
  'agent.scope'(taskId: string): AgentScope
  'attachments.pick'(): Attachment[]
  'attachments.add'(name: string, base64: string): Attachment
  'attachments.status'(ids: string[]): { id: string; available: boolean }[]
  'attachments.text'(attachmentId: string): string | null
  'attachments.preview'(id: string): string | null
  'attachments.menu'(id: string, removable: boolean, point: { x: number; y: number }): 'preview' | 'remove' | null
  'attachments.save'(id: string): boolean
  'attachments.copy'(id: string): void
  'attachments.reveal'(id: string): void
  'agent.start'(
    taskId: string,
    prompt: string,
    settings?: AgentSettings,
    attachments?: string[],
    context?: FileContext[],
  ): AgentSessionInfo
  'agent.catalog'(refresh?: boolean): ProviderCatalog[]
  /** Models a provider started offering since the host first knew it, until a device dismisses them. */
  'models.news'(): ModelNotice[]
  'models.dismissNews'(provider: import('./types').AgentProvider, model: string): void
  'agent.configure'(sessionId: string, settings: AgentSettings): AgentSessionInfo
  'files.all'(taskId: string): { repoId: string; path: string }[]
  'files.resolveLink'(
    taskId: string,
    href: string,
    /** `folders` also resolves directories (`kind: 'folder'`); without it only files match. */
    options?: { folders?: boolean },
  ): { repoId: string; path: string; line?: number; column?: number; kind?: 'file' | 'folder' } | null
  'agent.send'(sessionId: string, text: string): void
  'agent.submit'(
    sessionId: string,
    text: string,
    mode: 'queue' | 'steer',
    attachments?: string[],
    context?: FileContext[],
  ): void
  'agent.removeQueued'(sessionId: string, messageId: string): void
  'agent.reorderQueued'(sessionId: string, order: string[]): void
  'agent.resumeQueue'(sessionId: string): void
  /** `interrupt` stops a running turn first and sends the message as the next one. */
  'agent.sendQueuedNow'(sessionId: string, messageId: string, interrupt?: boolean): void
  'agent.interrupt'(sessionId: string): void
  /**
   * Try again now for a thread held at a usage limit: re-checks usage and, only if there is room or the provider has no
   * reading, sends the continuation. Otherwise the thread stays in the limit wait with the updated reset time and no
   * failed turn. A thread that is not at a limit returns `{ resumed: false, retryAt: null, guessed: false }`.
   */
  'agent.retryLimitNow'(sessionId: string): LimitRetryResult
  /**
   * Sets this thread's own auto-resume choice (true or false), or clears it with null to follow the global
   * `fallback.autoResume`. Takes effect at once: it clears or re-arms the thread's limit timer. Does not touch the provider.
   */
  'agent.setAutoResume'(sessionId: string, autoResume: boolean | null): AgentSessionInfo
  /** Opening message for a new chat that continues this one, carrying the transcript as context. */
  'agent.continuationPrompt'(sessionId: string): string
  'agent.stop'(sessionId: string): void
  'agent.rewind'(sessionId: string, userSeq: number): void
  /** Latest plan usage per provider and window. */
  'usage.get'(): UsageReading[]
  /** Readings for every login of every provider, not just the selected one. */
  'usage.accounts'(): UsageReading[]
  /** Finished turns per day and provider for the last `days` days, with cost where the provider reports it. */
  'usage.activity'(days: number): import('./usageAcrossHosts').ActivityRow[]
  /** Reads Claude's plan usage now, without a turn, when the stored reading is old. */
  'usage.refresh'(): UsageReading[]
  /** The context window usage last reported for a chat, if any. */
  'agent.context'(sessionId: string): ContextUsage | null
  /** Whether Codex trusts Ramu's sub-agent hook. */
  'codex.hook.status'(): { trusted: boolean; error?: string }
  /** Claude Code's own advisor model from the user's Claude settings, or null when it is off. */
  'advisor.claude'(): { model: string | null }
  /** Writes the one trust entry for Ramu's hook into Codex's own config (~/.codex/config.toml). */
  'codex.hook.trust'(): { trusted: boolean; error?: string }
  /** Side questions about a chat; they never reach the main conversation. */
  'aside.list'(sessionId: string): Aside[]
  /** Starts an aside (asideId null) or continues one. Returns at once; the answer arrives as aside:changed. */
  'aside.ask'(
    sessionId: string,
    asideId: string | null,
    quote: string,
    quoteFrom: 'assistant' | 'user',
    question: string,
  ): Aside
  'aside.delete'(sessionId: string, asideId: string): void
  /**
   * A draft theme from this host's provider for a brief. `seed` is the theme being refined; locked roles come back
   * unchanged. The draft may carry readability issues after the repair rounds; applying it stays a device action.
   */
  'theme.generate'(
    brief: string,
    seed: RamuTheme,
    locked?: { light: ThemeRole[]; dark: ThemeRole[] },
    feedback?: string,
    /** Up to three reference images (ids from `attachments.add`) the model looks at for mood and palette. */
    referenceIds?: string[],
  ): { theme: RamuTheme; issues: ThemeIssue[]; provider: string; model: string }
  /** Up to three drafts in different directions for a brief, to choose between. Each uses a draft's provider usage. */
  'theme.candidates'(
    brief: string,
    seed: RamuTheme,
    locked?: { light: ThemeRole[]; dark: ThemeRole[] },
    referenceIds?: string[],
  ): { theme: RamuTheme; issues: ThemeIssue[]; provider: string; model: string }[]
  /** Keep the chat's current provider despite the usage threshold: for the next message, for this chat until its limit resets, or clear. */
  'agent.holdProvider'(sessionId: string, scope: 'message' | 'chat' | null): void
  'agent.mcpStatus'(sessionId: string): Promise<AgentMcpStatus>
  /** Rules, servers, skills and Shared MCP connections this thread has, with how far each got. Names and states only. */
  'agent.setup'(sessionId: string): Promise<AgentSetupSnapshot>
  /** For a shared connection this provider also loads itself: hide the shared copy (`native`) or serve both. Takes effect on the next launch of the thread. */
  'agent.chooseDuplicate'(sessionId: string, connectionId: string, use: 'native' | 'both'): void
  'agent.reloadMcp'(sessionId: string): Promise<void>
  'agent.reconnectMcp'(sessionId: string, name: string): Promise<void>
  'agent.providerHold'(sessionId: string): 'message' | 'chat' | 'picked' | null
  /** Where the thread's next message would run under the host's routing, without changing anything. */
  'agent.nextRoute'(sessionId: string): Promise<NextMessageRoute>
  /** Moves one running command to the background so the agent can carry on (Claude only). False when it already finished. */
  'agent.backgroundTool'(sessionId: string, toolUseId: string): boolean
  /** Stops one sub-agent or background task; the main agent keeps going. */
  'agent.stopTask'(sessionId: string, agentId: string): void
  /** Takes a teammate out of the thread: it stops if working, and nobody can address it afterwards. */
  'agent.dismissTeammate'(sessionId: string, agentId: string): void
  /** Sends a message to a sub-agent through the main agent (Claude SendMessage, Codex send_input). */
  'agent.messageTask'(sessionId: string, agentId: string, text: string): void
  'customAgents.list'(): import('./customAgents').CustomAgent[]
  'customAgents.save'(
    input: Omit<import('./customAgents').CustomAgent, 'id' | 'updatedAt'> & { id?: string },
  ): import('./customAgents').CustomAgent
  'customAgents.delete'(id: string): void
  /**
   * Saves a teammate in this thread as a custom agent named `name`: its model, its brief as instructions, and Review as
   * read-only, so it can be brought into another thread with `@name`.
   */
  'customAgents.saveTeammate'(sessionId: string, agentId: string, name: string): import('./customAgents').CustomAgent
  /** Drafts a custom agent from one sentence; nothing is saved until the person saves it. */
  'customAgents.draft'(
    sentence: string,
    settings: AgentSettings,
  ): Omit<import('./customAgents').CustomAgent, 'id' | 'updatedAt' | 'model'>
  /** Lets a teammate exchange that paused for the person go on, delivering the report it held back. */
  'agent.continueTeammates'(sessionId: string): void
  /** Adds a teammate: a second model the person chose, working in this thread. One per thread. */
  'agent.addTeammate'(
    sessionId: string,
    settings: AgentSettings,
    mode: import('./types').TeammateMode,
    request: string,
  ): { agentId: string; name: string }
  'agent.replyPermission'(
    sessionId: string,
    requestId: string,
    allow: boolean,
    message?: string,
    scope?: 'once' | 'project' | 'user',
    pattern?: string,
  ): void
  'agent.forgetPermission'(sessionId: string, requestId: string, scope: 'project' | 'user'): void
  'agent.replyQuestion'(sessionId: string, requestId: string, answers: Record<string, string>): void
  'agent.replyElicitation'(
    sessionId: string,
    requestId: string,
    action: import('./types').ElicitationAction,
    answers: Record<string, string>,
  ): void
  'agent.elicitationDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.questionDraft'(sessionId: string, requestId: string, drafts: Record<string, string>): void
  'agent.dismissQuestion'(sessionId: string, requestId: string): void
  'agent.answerSecret'(sessionId: string, requestId: string, answer: import('./types').SecretAnswer): void
}

export type PushEvents = {
  'settings:changed': AppPreferences
  'settings:models': ModelPreferences
  'activity:changed': BackgroundActivity[]
  'menu:action': { action: 'settings' | 'check-updates' }
  /** A `ramu://pair` link was opened; the text is validated by the screen that uses it. */
  'pair:link': { link: string }
  /** The live view window closed. */
  'live:closed': Record<string, never>
  /** The live view window asked to open its thread here. */
  'live:open': { hostId: string; taskId: string }
  'automation:changed': Record<string, never>
  /** Projects, repositories, chats or sessions were created, renamed, moved or removed (by any client). */
  'workspace:changed': Record<string, never>
  'memory:changed': Record<string, never>
  /** An artifact, its records or one of its runs changed; `run` carries a run's newest steps while it works. */
  'artifacts:changed': {
    artifactId: string
    run?: import('./artifacts').ArtifactRun
    notice?: { title: string; body: string }
  }
  /** `created` is the id of a summary that just became ready, so clients can raise one notification. */
  'summaries:changed': { created: string | null }
  'rules:changed': Record<string, never>
  /** `rejected`: the server no longer accepts this device's token, so reconnecting is pointless until it is paired again. */
  'background:connection': {
    connected: boolean
    rejected?: boolean
    restarted?: boolean
    /** Turned off on this desktop; it does not try to connect. */
    paused?: boolean
    /** What a lost connection waits for: the network to return, or the host itself. */
    waiting?: 'network' | 'computer'
    /** When the next attempt is due, for a host reached over SSH. */
    retryAt?: number
    error?: string
  }
  'computers:changed': Computers
  /** The number a nearby host shows while this computer asks it to pair (see `computers.pairByRequest`). */
  'computers:pairCode': { address: string; code: string }
  'computers:navigate': { hostId: string; destination: HostDestination }
  'computers:activity': { ids: string[] }
  'updates:changed': AppUpdateStatus
  'providers:updates': ProviderStatus[]
  'mcp:changed': Record<string, never>
  /** A paired device's permissions changed; each device reads its own again. */
  'device:permissions': Record<string, never>
  /** Nearby devices waiting for the person at this host to allow them. Sent only to apps on the host itself. */
  'pairing:requests': { requests: NetworkStatus['requests'] }
  'pairBack:invites': { invites: import('./types').PairBackInvite[] }
  /** Paired devices asking for a permission, waiting for the person here. Sent only to apps on the host itself. */
  'permission:requests': { requests: NetworkStatus['permissionRequests'] }
  'notify:inapp': {
    hostId?: string
    sessionId: string
    taskId: string
    kind: 'done' | 'input' | 'failed'
    title: string
    body: string
  }
  'notify:open': { sessionId: string; taskId: string }
  /** A clicked link the person chose to open in the integrated browser; the window opens it in the active thread. */
  'browser:open-link': { url: string }
  /** Native browser state changed on this desktop; clients refresh only their thread's tabs. */
  'browser:changed': Record<string, never>
  'hostBrowser:changed': Record<string, never>
  'hostBrowser:present': BrowserTabInfo
  /** Explicit agent presentation request; never navigates or activates another host/thread. */
  'browser:present': BrowserTabInfo
  'agent:event': { sessionId: string; event: AgentEvent; seq?: number; revision?: number }
  /** The chat's transcript was cut back: events from `seq` on are gone. */
  'agent:rewound': { sessionId: string; seq: number }
  'usage:changed': UsageReading[]
  /** The new-model notices changed: one appeared, or a device dismissed one. */
  'models:news': ModelNotice[]
  /** A login was signed in, signed out or given a key: names, emails and usage are read again. */
  'logins:changed': Record<string, never>
  'context:changed': { sessionId: string; context: ContextUsage }
  'aside:changed': { sessionId: string; aside: Aside | null; asideId: string }
  'term:data': { id: string; data: string; cursor?: number }
  'term:exit': { id: string; code: number }
  /** Output of terminal `id` was withheld from a slow connection; fetch `term.snapshot(id, since)` to catch up. */
  'term:behind': { id: string }
  /** A shell was opened, ended or closed in this workspace (`taskId` is the workspace context). */
  'term:changed': { taskId: string }
  'notices:changed': import('./chat/notices').InboxNotice[]
  'fs:changed': { cwd: string; path: string }
  /** Another window changed a device-wide UI value (`value` null means removed). */
  'device-state:changed': { key: string; value: string | null }
}

export interface RamuBridge {
  /** The host this window belongs to ('local' for the first window). Available before any call completes. */
  readonly hostId: string
  invoke<M extends keyof RamuMethods>(
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  /**
   * Like `invoke`, but on an explicit host. Only methods the main process allow-lists work on a host other than this
   * window's own; it rejects for an unknown, offline or paused host. `invoke` itself is unchanged (variadic).
   */
  invokeOn<M extends keyof RamuMethods>(
    host: string,
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  /**
   * Host events carry their server's host ID; window events carry the shell's host ID.
   */
  on<E extends keyof PushEvents>(event: E, listener: (payload: PushEvents[E], hostId?: string) => void): () => void
  /** Device-wide UI state (panel widths and the like) shared by every window, loaded synchronously at startup. */
  readonly deviceState: Readonly<Record<string, string>>
  setDeviceState(key: string, value: string | null): void
  /** The on-disk path of a file or folder dropped onto the window ('' when it has none). */
  pathForFile(file: File): string
  /** Local dictation. Only the desktop shell has it; audio never leaves this computer. */
  readonly voice?: VoiceBridge
}
