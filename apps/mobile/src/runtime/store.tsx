import { attemptStatus, failureStatus, mayConnect, restoredStatus } from './hostConnection'
import { appForeground } from './chatViewport'
import { PairRequestUnsupported, requestPairing } from '@ramu/shared/pairRequest'
import { secureRandom } from './secureRandom'
import { agentActivityLabel, currentStep, turnStartedAt, turnSteps } from '@ramu/shared/chat/agentActivity'
import { runningCommands } from '@ramu/shared/chat/helperPresentation'
import './socketTransport'
import { viewerMayInvoke } from '@ramu/shared/viewerAccess'
import { mayUse, type DevicePermission, type DevicePermissionsView } from '@ramu/shared/devicePermissions'
import { VIEW_ONLY_WRITE_NOTICE } from './viewerAccess'
import { saveIssuedCredential } from './saveCredential'
import { planLayerSync } from '@ramu/shared/sharedFields'
import { inputSummary } from '@ramu/shared/chat/inputSummary'
import type { BranchNamingIntent, BranchChoice } from '@ramu/shared/workspaceDefaults'
import { normalizeHelperGroups } from './threadActivity'
import { rememberExplorerNavigation, type ExplorerNavigation } from './explorerNavigation'
import { isCompacting } from '@ramu/shared/chat/compaction'
import { newChatHost } from './newChatHost'
import {
  addExplorerFile,
  consumeComposerDraft,
  type ComposerSnapshot,
  type ExplorerFileInput,
  type ExplorerDestination,
} from './composerDrafts'
import { createWorkspaceTask, workspaceCreation } from './workspaces'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState, NativeModules } from 'react-native'
import { fetch as nativeFetch } from 'expo/fetch'
import { shareRows } from './shareRows'
import * as Device from 'expo-device'
import { thisDeviceOs } from './deviceOs'
import Constants from 'expo-constants'
import type { PushEvents, RamuMethods, ReviewAddressResult } from '@ramu/shared/api'
import type { PushArgs } from '@ramu/shared/pushChannels'
import type { BackgroundActivity } from '@ramu/shared/chat/activity'
import { isUserPaused } from '@ramu/shared/chat/goalHold'
import type { InboxNotice } from '@ramu/shared/chat/notices'
import type { LimitRetryResult } from '@ramu/shared/chat/providerWait'
import type {
  AgentEvent,
  AgentProvider,
  AgentSettings,
  AppPreferences,
  FileContext,
  WorktreePlanEntry,
  ProviderCatalog,
  UsageReading,
} from '@ramu/shared/types'
import {
  deleteToken,
  readLocal,
  readRenewedAt,
  readDrafts,
  readSendJournal,
  writeDrafts,
  readToken,
  saveRenewedAt,
  saveToken,
  writeLocal,
  writeSendJournal,
} from '../storage'
import { remainingJournal, restoreOutbox } from './sendJournal'
import { mapBounded } from '@ramu/shared/mapBounded'
import { rebuildDelay, readsTranscript, type RefreshDepth } from './refreshDepth'
import { renewalDue, renewCredential } from './tokenRenewal'
import {
  HostClient,
  HostError,
  SuspendedError,
  normalizeAddress,
  operationKey,
  checkHostConnection,
  readConnectionStatus,
} from './transport'
import { probeReachableHosts, type ReachableHostProbe } from './reachableHosts'
import { verifyHost, findHostRoute, chooseHostRoute, rememberRoutes, developmentHostRoute } from './hostRoutes'
import { newerTaskSnapshot } from '@ramu/shared/chat/threadStatus'
import {
  ACCEPTED_HOLD_MS,
  deliveryBaseline,
  holdsQueue,
  reconcileDelivered,
  transcript,
  visibleText,
} from './transcript'
import type { Language } from './settingsModel'
import { PUSH_MUTED_KEY, registerCategories, type PushCategory, withCategory } from './pushCategories'
import { GOAL_VERIFY_METHOD } from './goalVerify'
import { mergeTranscript, transcriptRows, updateThreadMetadata, readTranscriptBundle } from './transcriptChanges'
import { STANDALONE, type Chat, type Computer, type MobileProject } from './types'
import type { Task } from '@ramu/shared/types'

const expoFetch = nativeFetch as unknown as typeof globalThis.fetch

/** Expo metadata also works in bridgeless builds where SourceCode is not exposed through NativeModules. */
function developmentBundleUrl(): string | undefined {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return undefined
  const host = Constants?.expoConfig?.hostUri
  if (host) return /^https?:\/\//.test(host) ? host : `http://${host}`
  const source = NativeModules?.SourceCode
  return source?.scriptURL ?? source?.getConstants?.().scriptURL
}

export type { Language }

export interface OutboxItem {
  id: string
  computerId: string
  chatId: string
  kind: 'message' | 'chat'
  text: string
  mode: 'send' | 'queue' | 'steer'
  createdAt: number
  state?: 'waiting' | 'sending' | 'accepted' | 'uncertain' | 'review'
  /** When the host acknowledged it; an accepted message stops holding the queue after ACCEPTED_HOLD_MS. */
  acceptedAt?: number
  deliveryBaseline?: { userCount: number; queueIds: string[] }
  error?: string
  settings?: AgentSettings
  projectId?: string
  checkout?: 'current' | 'worktree'
  workspaceId?: string
  branchNaming?: BranchNamingIntent
  branchChoice?: BranchChoice
  reviewedPlan?: WorktreePlanEntry[]
  branchPrefix?: string
  attachments?: string[]
  context?: FileContext[]
}
interface State {
  computers: Computer[]
  projects: MobileProject[]
  chats: Chat[]
  selected: string
  language: Language
  outbox: OutboxItem[]
  drafts: Record<string, string>
  usage: Record<string, UsageReading[]>
  catalogs: Record<string, ProviderCatalog[]>
  ready: boolean
  error: string | null
}
interface Store extends State {
  resolveChat(computerId: string, taskId: string): string
  select(id: string): void
  setLanguage(language: Language): void
  pair(name: string, address: string, code: string, allowHttp: boolean): Promise<string>
  /**
   * Asks a nearby host to pair this phone; `onCode` shows the number the host must match. Rejects with
   * `PairRequestUnsupported` when the host or this build cannot, so the person types a code instead.
   */
  pairByRequest(
    name: string,
    address: string,
    allowHttp: boolean,
    onCode: (code: string, expiresAt: number) => void,
    signal: AbortSignal,
  ): Promise<string>
  /** Moves a saved host to a new address only after that address proves it is the host this phone paired with. */
  reviewAddress(id: string, address: string, signal?: AbortSignal): Promise<ReviewAddressResult>
  probeHosts: ReachableHostProbe
  /** Turns a host's connection off without forgetting it, or back on. */
  setConnected(id: string, on: boolean): Promise<void>
  forget(id: string): Promise<void>
  retry(id: string): void
  invoke<M extends keyof RamuMethods>(
    computerId: string,
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  subscribe(computerId: string, listener: (...args: PushArgs) => void): () => void
  /** Asks a host for on-demand channels (file changes, a thread's context size, terminal output) while a screen shows them. */
  watch(computerId: string, channels: readonly string[], keys?: Record<string, readonly string[]>): () => void
  /** `full` re-reads every transcript (after a reconnect); otherwise chats already streaming keep their live transcript. */
  refresh(computerId: string, depth?: RefreshDepth): Promise<void>
  send(
    id: string,
    text: string,
    mode: 'send' | 'queue' | 'steer',
    attachments?: string[],
    context?: FileContext[],
  ): Promise<void>
  createChat(input: {
    computerId: string
    projectId: string
    text: string
    provider: AgentProvider
    model: string
    effort: string
    mode: 'current' | 'worktree'
    workspaceId?: string
    branchNaming?: BranchNamingIntent
    branchChoice?: BranchChoice
    reviewedPlan?: WorktreePlanEntry[]
    branchPrefix?: string
    attachments?: string[]
    settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier'>
    context?: FileContext[]
  }): Promise<string>
  previewOutbox(id: string): Promise<WorktreePlanEntry[]>
  resumeOutbox(id: string, plan: WorktreePlanEntry[]): Promise<void>
  cancelOutbox(id: string): string | undefined
  stop(id: string): void
  answer(id: string, request: string, answers: Record<string, string>): void
  /** Answers an approval; `project` or `user` also saves it, for this exact request or the chosen `pattern`. */
  decide(
    id: string,
    request: string,
    decision: 'allow' | 'deny',
    scope?: 'once' | 'project' | 'user',
    pattern?: string,
  ): void
  /** Removes a saved approval, so the same request asks again. */
  forgetApproval(id: string, request: string, scope: 'project' | 'user'): void
  elicitation(
    id: string,
    request: string,
    action: 'accept' | 'decline' | 'cancel',
    answers: Record<string, string>,
  ): void
  toggleGoal(id: string): void
  clearGoal(id: string): void
  /** Sets, changes or (null) removes the goal's verification command; rejects with the host's reason so the editor can show it. */
  setGoalVerify(id: string, command: string | null): Promise<void>
  /** Checks a thread held at a usage limit now instead of at the timer; resolves with whether it continued. */
  retryLimitNow(id: string): Promise<LimitRetryResult | null>
  /** This thread's own auto-resume choice at a limit; null clears it so the thread follows the host's default. */
  setAutoResume(id: string, autoResume: boolean | null): void
  removeQueued(id: string, message: string): void
  /** Sends one queued message now, stopping a running turn first. */
  sendQueuedNow(id: string, message: string): void
  /** Resolves once the computer has applied it (or refused, which restores the old values and reports why). */
  setModel(
    id: string,
    provider: AgentProvider,
    model: string,
    effort: string,
    settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier' | 'accountId'>,
  ): Promise<void>
  isOnline(id: string): boolean
  setDraft(key: string, text: string): void
  rememberExplorer(host: string, context: string, navigation: Omit<ExplorerNavigation, 'at'>): void
  addExplorerFile(input: ExplorerFileInput): Promise<ExplorerDestination>
  clearComposerDraft(key: string, expected: ComposerSnapshot): boolean

  dismissError(): void
  enablePush(): Promise<void>
  disablePush(): Promise<void>
  /** Switches one kind of background alert on or off, and tells every online host. */
  setPushCategory(category: PushCategory, on: boolean): void
  notifications: { computerId: string; chatId: string; title: string; body: string }[]
  /** Work the computer does on its own (cleanups, indexing…), per computer. */
  activity: Record<string, BackgroundActivity[]>
  /** What a new chat starts with on each computer: its default model step and default access, as set in its Settings. */
  defaults: Record<string, AgentSettings>
  /** Shared preferences on each paired computer, refreshed when its settings change. */
  appPreferences: Record<string, AppPreferences>
  /** Whether this phone should be offered a control that needs a host permission; unknown counts as yes. */
  mayUse(computerId: string, permission: DevicePermission): boolean
  /** Reads this phone's permissions on a host again, as after asking for one. */
  reloadPermissions(computerId: string): void
  /** The computer's model sets and steps (Settings › Models), which the step slider walks through. */
  modelPrefs: Record<string, import('@ramu/shared/types').ModelPreferences | null>
  /** The mobile layer of shared display preferences each computer keeps; null when the computer is too old to offer it. */
  mobileLayers: Record<string, import('@ramu/shared/preferenceScopes').PreferenceLayer | null>
  setMobileLayer(computerId: string, layer: import('@ramu/shared/preferenceScopes').PreferenceLayer): void
  /** What the computer keeps for every device: finished, failed or waiting chats nobody has dealt with yet. */
  inbox: Record<string, InboxNotice[]>
  /** The chat has been looked at (here or anywhere); its notice is cleared on every device. */
  acknowledge(chatId: string): void
  dismissNotice(computerId: string, id: string): void
  clearNotices(computerId: string): void
  dismissNotification(index: number): void
}
const Context = createContext<Store | null>(null)
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
export const scoped = (computer: string, id: string) => `${computer}:${id}`
const raw = (id: string) => id.slice(id.indexOf(':') + 1)
const defaults: State = {
  computers: [],
  projects: [],
  chats: [],
  selected: '',
  language: 'en',
  outbox: [],
  drafts: {},
  usage: {},
  catalogs: {},
  ready: false,
  error: null,
}
const settingsFor = (provider: AgentProvider, model: string, effort: string): AgentSettings => ({
  provider,
  model,
  effort: (effort || null) as AgentSettings['effort'],
  access: 'full',
  autoFallback: true,
})

/** Outbox ids handed to the network but not yet recorded in the saved profile; see `sendJournal.ts`. */
let sendJournal: string[] = []

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const saved = readLocal(defaults)
    sendJournal = readSendJournal()
    return {
      ...defaults,
      ...saved,
      ready: false,
      chats: saved.chats.map((chat) => ({ ...chat, items: normalizeHelperGroups(chat.items) })),
      computers: saved.computers.map((c) => ({ ...c, status: restoredStatus(c.status) })),
      outbox: restoreOutbox(saved.outbox, sendJournal),
      // The drafts file is newer than the profile's copy whenever both exist.
      drafts: readDrafts() ?? saved.drafts,
    }
  })
  const ref = useRef(state)
  ref.current = state
  const connections = useRef(
    new Map<string, { client: HostClient; controller: AbortController; generation: number; live?: boolean }>(),
  )
  const generations = useRef(new Map<string, number>())
  const eventRows = useRef(new Map<string, Map<number, AgentEvent>>())
  // The host's change counter for each transcript held in `eventRows`, so a refresh reads only what changed.
  const changeCursors = useRef(new Map<string, number>())
  // Threads on screen, by scoped session id: they always read in full.
  const shownSessions = useRef(new Set<string>())
  const listeners = useRef(new Map<string, Set<(...args: PushArgs) => void>>())
  const refreshing = useRef(new Map<string, Promise<void>>())
  const buffers = useRef(new Map<string, PushEvents['agent:event'][]>())
  const flushing = useRef(new Set<string>())
  const changeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const active = useRef(AppState.currentState !== 'background')
  const pushToken = useRef<string | null>(null)
  const [notifications, setNotifications] = useState<Store['notifications']>([])
  const [activity, setActivity] = useState<Record<string, BackgroundActivity[]>>({})
  const [inbox, setInbox] = useState<Record<string, InboxNotice[]>>({})
  const [modelPrefs, setModelPrefs] = useState<Record<string, import('@ramu/shared/types').ModelPreferences | null>>({})
  const [appPreferences, setAppPreferences] = useState<Record<string, AppPreferences>>({})
  const [permissions, setPermissions] = useState<Record<string, DevicePermissionsView | null>>({})
  const loadPermissions = (id: string) =>
    void invoke(id, 'device.permissions').then(
      (view) => setPermissions((p) => ({ ...p, [id]: view })),
      () => setPermissions((p) => ({ ...p, [id]: null })),
    )
  const [mobileLayers, setMobileLayers] = useState<
    Record<string, import('@ramu/shared/preferenceScopes').PreferenceLayer | null>
  >({})
  const [startSettings, setStartSettings] = useState<Record<string, AgentSettings>>({})
  // The phone carries shared mobile settings between its paired hosts: any host holding an older value (or none) is
  // given the newest one, and a clear spreads as a clear. Each (host, field, revision) is tried once at a time; a failure clears
  // it, so a viewer-role or unreachable host causes no retry loop and is tried again on the next change to the layers.
  const syncAttempts = useRef(new Set<string>())
  useEffect(() => {
    const plan = planLayerSync(mobileLayers)
    for (const [host, edits] of Object.entries(plan))
      for (const edit of edits) {
        const key = `${host}|${edit.id}|${edit.at}|${edit.by}|${edit.value ?? ''}`
        if (syncAttempts.current.has(key)) continue
        syncAttempts.current.add(key)
        void invoke(host, 'preferences.layers.set', edit).then(
          (result) => setMobileLayers((p) => ({ ...p, [host]: result.mobile })),
          // A failed attempt is not final: the next change to the layers plans it again.
          () => syncAttempts.current.delete(key),
        )
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mobileLayers] by design; the values it reads beyond these are current as of that run
  }, [mobileLayers])
  const loadDefaults = (id: string) => {
    void invoke(id, 'preferences.layers.get').then(
      (snapshot) => setMobileLayers((p) => ({ ...p, [id]: snapshot.mobile })),
      () => {},
    )
    loadModels(id)
    loadPermissions(id)
  }
  const loadModels = (id: string) =>
    void Promise.all([invoke(id, 'settings.models.get'), invoke(id, 'settings.app.get')]).then(
      ([models, app]) => {
        setAppPreferences((p) => ({ ...p, [id]: app }))
        setModelPrefs((p) => ({ ...p, [id]: models }))
        const step =
          models?.sets
            .find((set) => set.id === models.defaultSetId)
            ?.steps.find((item) => item.id === models.defaultStepId) ?? models?.sets[0]?.steps[0]
        setStartSettings((d) => ({
          ...d,
          [id]: {
            provider: step?.provider ?? 'claude-code',
            model: step?.model ?? '',
            effort: step?.effort ?? null,
            access: app.defaultAccess,
            autoFallback: app.defaultAutoFallback,
            serviceTier: 'standard',
          },
        }))
      },
      () => {},
    )
  const inboxRef = useRef(inbox)
  inboxRef.current = inbox
  const change = (fn: (s: State) => State) => {
    const changed = fn(ref.current)
    const next = { ...changed, outbox: reconcileDelivered(changed.outbox, changed.chats) }
    ref.current = next
    setState(next)
  }
  const report = (error: unknown) => {
    // A request the phone stopped on purpose (backgrounded, connection replaced) is not an error to show.
    if (error instanceof SuspendedError) return
    change((s) => ({ ...s, error: error instanceof Error ? error.message : String(error) }))
  }
  const clearSaveError = () => {
    if (ref.current.error?.startsWith('Could not save phone data.')) change((state) => ({ ...state, error: null }))
  }
  const status = (id: string, value: Computer['status'], error?: string) =>
    change((s) => ({
      ...s,
      computers: s.computers.map((c) =>
        c.id === id ? { ...c, status: value, error, lastSeen: value === 'online' ? Date.now() : c.lastSeen } : c,
      ),
    }))
  async function invoke<M extends keyof RamuMethods>(
    id: string,
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>> {
    if (ref.current.computers.find((computer) => computer.id === id)?.access === 'viewer' && !viewerMayInvoke(method))
      throw new HostError(VIEW_ONLY_WRITE_NOTICE[ref.current.language], 403)
    const connection = connections.current.get(id)
    if (!connection || connection.controller.signal.aborted)
      throw new HostError('This host is offline. Reconnect before taking this action.')
    try {
      return await connection.client.invoke(method, ...args)
    } catch (error) {
      if (
        error instanceof HostError &&
        error.status === 401 &&
        connections.current.get(id) === connection &&
        !connection.controller.signal.aborted
      ) {
        connection.controller.abort()
        connection.client.close()
        status(id, 'revoked', error.message)
      }
      throw error
    }
  }
  /** Registers this phone's push token with a host, along with the alert categories that are on. */
  const registerPushOn = (id: string) =>
    invoke(
      id,
      'notifications.register',
      pushToken.current!,
      id,
      ...registerCategories(ref.current.drafts[PUSH_MUTED_KEY]),
    )
  const rebuilds = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const rebuildCosts = useRef(new Map<string, number>())
  // Publish completed text blocks and coalesce other activity updates, leaving time for native input.
  const rebuild = (computerId: string, sessionId: string) => {
    const key = scoped(computerId, sessionId)
    if (rebuilds.current.has(key)) return
    rebuilds.current.set(
      key,
      setTimeout(
        () => {
          rebuilds.current.delete(key)
          const startedAt = Date.now()
          const rows = eventRows.current.get(key)
          if (!rows) return
          const ordered = [...rows.entries()].sort((a, b) => a[0] - b[0])
          const events = ordered.map((x) => x[1])
          const items = transcript(
            events,
            ordered.map((x) => x[0]),
            ref.current.chats.some(
              (chat) =>
                chat.computerId === computerId &&
                chat.sessionId === sessionId &&
                (chat.executionState === 'running' || chat.executionState === 'starting'),
            ),
          )
          const preview = events.findLast((event) => event.kind === 'text' && !event.agentId)
          change((s) => ({
            ...s,
            chats: s.chats.map((chat) =>
              chat.computerId === computerId && chat.sessionId === sessionId
                ? {
                    ...chat,
                    items: shareRows(chat.items, items),
                    activityLabel: agentActivityLabel(chat.executionState, events),
                    turnStartedAt: turnStartedAt(events),
                    step: currentStep(chat.executionState, events),
                    steps: turnSteps(events),
                    preview: preview?.kind === 'text' ? preview.text.slice(-140) : chat.preview,
                    inputSummary: ['stopped', 'failed'].includes(chat.executionState ?? '')
                      ? null
                      : inputSummary(events, sessionId),
                    compacting:
                      chat.executionState !== 'stopped' && chat.executionState !== 'failed' && isCompacting(events),
                    commands: runningCommands(events),
                  }
                : chat,
            ),
          }))
          rebuildCosts.current.set(key, Date.now() - startedAt)
          // The message this host's outbox waited on may have just appeared.
          if (ref.current.outbox.some((o) => o.computerId === computerId && o.state === 'waiting'))
            void flush(computerId)
        },
        rebuildDelay(rebuildCosts.current.get(key) ?? 0),
      ),
    )
  }
  const applyEvent = (computerId: string, payload: PushEvents['agent:event']) => {
    const key = scoped(computerId, payload.sessionId)
    const rows = eventRows.current.get(key)
    if (!rows) return
    const previous = payload.seq != null ? rows.get(payload.seq) : undefined
    if (payload.seq != null) rows.set(payload.seq, payload.event)
    const chat = ref.current.chats.find(
      (chat) => chat.computerId === computerId && chat.sessionId === payload.sessionId,
    )
    if (chat) {
      const updated = updateThreadMetadata(chat, payload.event)
      if (updated !== chat) change((s) => ({ ...s, chats: s.chats.map((entry) => (entry === chat ? updated : entry)) }))
    }
    if (!previous || !['text', 'thinking'].includes(payload.event.kind)) rebuild(computerId, payload.sessionId)
  }
  const receive = (id: string, ...[channel, payload]: PushArgs) => {
    if (channel === 'agent:event') {
      if (buffers.current.has(id)) buffers.current.get(id)!.push(payload)
      else {
        applyEvent(id, payload)
        if (!eventRows.current.has(scoped(id, payload.sessionId))) void refresh(id).catch(report)
      }
      const chat = ref.current.chats.find((c) => c.computerId === id && c.sessionId === payload.sessionId)
      const e = payload.event as AgentEvent
      const notify =
        chat &&
        ((e.kind === 'state' && ['idle', 'failed', 'needs-input'].includes(e.state)) ||
          e.kind === 'question' ||
          (e.kind === 'goal' && e.goal?.status === 'blocked'))
      if (notify)
        setNotifications((n) =>
          [
            ...n.filter((x) => !(x.computerId === id && x.chatId === chat.id)),
            {
              computerId: id,
              chatId: chat.id,
              title: chat.title,
              body:
                e.kind === 'state' && e.state === 'idle'
                  ? 'Finished'
                  : e.kind === 'state' && e.state === 'failed'
                    ? 'Stopped with an error'
                    : 'Needs your input',
            },
          ].slice(-30),
        )
    } else if (channel === 'agent:rewound') {
      // Edit from here, on this device or another, removed the turns from this message on; a refresh only adds rows.
      const rows = eventRows.current.get(scoped(id, payload.sessionId))
      for (const seq of rows?.keys() ?? []) if (seq >= payload.seq) rows!.delete(seq)
      const buffered = buffers.current.get(id)
      if (buffered)
        buffers.current.set(
          id,
          buffered.filter(
            (event) => event.sessionId !== payload.sessionId || event.seq == null || event.seq < payload.seq,
          ),
        )
      if (rows) rebuild(id, payload.sessionId)
    } else if (channel === 'workspace:changed') {
      // Chats and projects changed on the computer or another device: reload the lists right away instead of at the next poll.
      clearTimeout(changeTimers.current.get(id))
      changeTimers.current.set(
        id,
        setTimeout(() => {
          changeTimers.current.delete(id)
          void refresh(id).catch(report)
        }, 120),
      )
    } else if (channel === 'settings:models' || channel === 'settings:changed') loadDefaults(id)
    else if (channel === 'device:permissions') loadPermissions(id)
    else if (channel === 'notices:changed') setInbox((i) => ({ ...i, [id]: payload }))
    else if (channel === 'activity:changed') setActivity((a) => ({ ...a, [id]: payload }))
    else if (channel === 'usage:changed') change((s) => ({ ...s, usage: { ...s.usage, [id]: payload } }))
    else if (channel === 'notify:inapp') {
      const chatId =
        ref.current.chats.find((c) => c.computerId === id && c.taskId === payload.taskId)?.id ??
        scoped(id, payload.taskId)
      setNotifications((n) =>
        [
          ...n.filter((x) => !(x.computerId === id && x.chatId === chatId)),
          { computerId: id, chatId, title: payload.title, body: payload.body },
        ].slice(-30),
      )
    }
    for (const listener of listeners.current.get(id) ?? []) listener(...([channel, payload] as PushArgs))
  }
  const refresh = (id: string, depth: RefreshDepth = false): Promise<void> => {
    // A deeper refresh must not be satisfied by a light one already in flight.
    if (refreshing.current.has(id))
      return depth ? refreshing.current.get(id)!.then(() => refresh(id, depth)) : refreshing.current.get(id)!
    const connection = connections.current.get(id)
    if (!connection) return Promise.resolve()
    const current = () => connections.current.get(id) === connection && !connection.controller.signal.aborted
    const read = <M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>) => {
      if (!current()) throw new SuspendedError('Connection suspended during refresh')
      return invoke(id, method, ...args)
    }
    buffers.current.set(id, [])
    const promise = (async () => {
      // Catalogs and usage change rarely and usage is pushed, so only a reconnect or a first read asks for them.
      const known = ref.current
      const [projects, tasks, allSessions, catalogs, usage] = await Promise.all([
        read('projects.list'),
        read('tasks.list'),
        read('agent.all'),
        depth !== true && known.catalogs[id] ? known.catalogs[id] : read('agent.catalog'),
        depth !== true && known.usage[id] ? known.usage[id] : read('usage.get'),
      ])
      // One read for the host's sessions, not one per thread: a phone pays a round trip for each.
      const newestSessions = new Map<string, (typeof allSessions)[number]>()
      for (const candidate of allSessions) {
        const held = newestSessions.get(candidate.taskId)
        if (!candidate.parentId && (!held || candidate.createdAt > held.createdAt))
          newestSessions.set(candidate.taskId, candidate)
      }
      const projectViews = await mapBounded(projects, 8, async (p) => {
        const repos = await read('repos.list', p.id)
        return {
          ...p,
          id: scoped(id, p.id),
          computerId: id,
          kind: repos.length === 1 ? ('repo' as const) : ('workspace' as const),
          repos: repos.map((r) => r.name),
        }
      })
      const revisions = new Map<string, number>()
      const chats: Chat[] = []
      // Bound concurrency for large workspaces and many saved computers.
      for (let index = 0; index < tasks.length; index += 6)
        await Promise.all(
          tasks
            .slice(index, index + 6)
            .filter((t) => t.status !== 'archived')
            .map(async (task) => {
              const session = newestSessions.get(task.id)
              const known = ref.current.chats.find((c) => c.computerId === id && c.taskId === task.id)
              if (
                !readsTranscript(depth, {
                  taskId: task.id,
                  state: session?.state,
                  knownState: known?.executionState,
                  awaitingDelivery:
                    !!known && ref.current.outbox.some((o) => o.chatId === known.id && o.state === 'accepted'),
                }) &&
                known &&
                session &&
                known.sessionId === session.id &&
                eventRows.current.has(scoped(id, session.id))
              ) {
                // The event stream already keeps this transcript current; only the task's own fields (title, pin, branch) may differ.
                if (current())
                  chats.push({
                    ...known,
                    ...task,
                    id: known.id,
                    taskId: task.id,
                    sessionId: session.id,
                    projectId: task.projectId === STANDALONE ? STANDALONE : scoped(id, task.projectId),
                    computerId: id,
                    status: known.status,
                    provider: known.provider,
                    model: known.model,
                    effort: known.effort,
                    settings: known.settings,
                    preview: known.preview,
                    items: known.items,
                    queue: known.queue,
                    goal: known.goal,
                    branch: known.branch,
                  })
                return
              }
              const readTranscript = async () => {
                if (!session)
                  return {
                    revision: 0,
                    cursor: undefined as number | undefined,
                    events: [] as { seq: number; event: AgentEvent }[],
                  }
                const key = scoped(id, session.id)
                // A thread nobody has open reads only its last turns; opening it reads the rest. So a cold start costs a
                // list and a preview per thread, not every transcript on the host.
                const focused = typeof depth === 'object' && depth.has(task.id)
                if (!focused && !changeCursors.current.has(key) && !shownSessions.current.has(key)) {
                  const tail = await read('agent.tail', session.id)
                  return { revision: 0, cursor: undefined, events: tail.events }
                }
                const held = eventRows.current.get(key)
                const result = await read(
                  'agent.changes',
                  session.id,
                  held ? (changeCursors.current.get(key) ?? 0) : 0,
                  held ? Math.max(0, ...held.keys()) : 0,
                )
                // Rows that arrived live while this read was in flight are in the map now; apply over those.
                const rows = mergeTranscript(eventRows.current.get(key), result)
                return { revision: result.revision, cursor: result.cursor, events: transcriptRows(rows) }
              }
              const bundle = await readTranscriptBundle(
                [
                  readTranscript(),
                  read('tasks.bindings', task.id),
                  session ? read('agent.goal', session.id) : Promise.resolve(null),
                ],
                current,
                (snapshot) => {
                  if (!session) return
                  const key = scoped(id, session.id)
                  eventRows.current.set(key, new Map(snapshot.events.map((x) => [x.seq, x.event])))
                  if (snapshot.cursor !== undefined) changeCursors.current.set(key, snapshot.cursor)
                  revisions.set(session.id, snapshot.revision)
                },
              )
              if (!bundle) return
              const [snapshot, bindings, goal] = bundle
              const events = snapshot.events.map((x) => x.event)
              const queue = [...events].reverse().find((e) => e.kind === 'queue')
              const text = [...events].reverse().find((e) => e.kind === 'text' || e.kind === 'user')
              // The host's own reading, as the desktop uses it: the main session's state and the task's status. Rebuilding
              // them from events disagreed with it, since hosts do not record a state event for every run and finish.
              const sessionState = task.executionState ?? session?.state
              chats.push({
                ...task,
                id:
                  ref.current.chats.find((c) => c.computerId === id && c.taskId === task.id)?.id ?? scoped(id, task.id),
                taskId: task.id,
                sessionId: session?.id ?? null,
                projectId: task.projectId === STANDALONE ? STANDALONE : scoped(id, task.projectId),
                computerId: id,
                provider: session?.provider ?? 'claude-code',
                model: session?.settings.model ?? '',
                effort: session?.settings.effort ?? '',
                settings: session?.settings,
                preview: text && 'text' in text ? visibleText(text.text).slice(-140) : '',
                status: task.status,
                inputSummary: ['stopped', 'failed'].includes(sessionState ?? '')
                  ? null
                  : inputSummary(events, session?.id ?? ''),
                executionState: sessionState,
                activityLabel: agentActivityLabel(sessionState, events),
                turnStartedAt: turnStartedAt(events),
                step: currentStep(sessionState, events),
                steps: turnSteps(events),
                compacting: sessionState !== 'stopped' && sessionState !== 'failed' && isCompacting(events),
                commands: runningCommands(events),
                items: transcript(
                  events,
                  snapshot.events.map((x) => x.seq),
                  sessionState === 'running' || sessionState === 'starting',
                ),
                queue: queue?.kind === 'queue' ? queue.messages : [],
                queuePaused: queue?.kind === 'queue' ? !!queue.paused : false,
                goal,
                // A worktree's own branch, or the branch its checkout has out; a current-checkout thread has none of its own.
                branch: bindings[0]?.taskBranch ?? bindings[0]?.checkedOut ?? '',
              })
            }),
        )
      if (!current()) return
      // All three are pushed as they change; only a reconnect can have missed anything.
      if (depth === true) {
        void read('activity.status').then(
          (list) => setActivity((a) => ({ ...a, [id]: list })),
          () => {},
        )
        loadDefaults(id)
        void read('notices.list').then(
          (list) => setInbox((i) => ({ ...i, [id]: list })),
          () => {},
        )
      }
      change((s) => ({
        ...s,
        projects: [...s.projects.filter((p) => p.computerId !== id), ...projectViews],
        chats: [
          ...s.chats.filter(
            (c) => c.computerId !== id || (c.pending && !chats.some((next) => c.taskId && next.taskId === c.taskId)),
          ),
          // A read that finished late never brings back a state the host has since moved past: of two reads of the same
          // thread, the one with the newer `snapshotAt` stays.
          ...chats.map((next) =>
            newerTaskSnapshot(
              s.chats.find((c) => c.computerId === id && c.taskId === next.taskId),
              next,
            ),
          ),
        ],
        catalogs: { ...s.catalogs, [id]: catalogs },
        usage: { ...s.usage, [id]: usage },
      }))
      for (const payload of buffers.current.get(id) ?? [])
        if (payload.revision == null || payload.revision > (revisions.get(payload.sessionId) ?? 0))
          applyEvent(id, payload)
      void flush(id)
    })().finally(() => {
      if (refreshing.current.get(id) === promise) {
        refreshing.current.delete(id)
        buffers.current.delete(id)
      }
    })
    refreshing.current.set(id, promise)
    return promise
  }
  /** Brings one thread up to date from where its last read stopped, without touching the rest of the host. */
  const reconcileThread = async (id: string, taskId: string, sessionId: string) => {
    const key = scoped(id, sessionId)
    const held = eventRows.current.get(key)
    const cursor = changeCursors.current.get(key)
    if (!held || !cursor) return refresh(id, new Set([taskId]))
    const result = await invoke(id, 'agent.changes', sessionId, cursor, Math.max(0, ...held.keys()))
    if (result.reset) return refresh(id, new Set([taskId]))
    changeCursors.current.set(key, result.cursor)
    for (const row of result.events) applyEvent(id, { sessionId, seq: row.seq, event: row.event })
  }
  const deliver = async (item: OutboxItem) => {
    const chat = ref.current.chats.find((c) => c.id === item.chatId)
    if (!chat) throw new Error('Thread not found')
    let sessionId = chat.sessionId
    if (item.kind === 'chat') {
      let taskId = chat.taskId
      if (!taskId) {
        const projectId = item.projectId === STANDALONE ? STANDALONE : raw(item.projectId!)
        const title = item.text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments'
        const creation = workspaceCreation({
          projectId,
          title,
          checkout: item.checkout,
          workspaceId: item.workspaceId,
          branchPrefix: item.branchPrefix,
          branchNaming: item.branchNaming,
          branchChoice: item.branchChoice,
          requestId: item.id,
        })
        // Only a new worktree needs a plan, and only a plan needs the repository list: skip both round trips otherwise.
        const planned = () =>
          createWorkspaceTask(
            creation,
            async () => {
              const repos = projectId === STANDALONE ? [] : await invoke(item.computerId, 'repos.list', projectId)
              return invoke(
                item.computerId,
                'tasks.plan',
                projectId,
                title,
                repos.map((r) => r.id),
              )
            },
            async (_input, plan) => plan,
            item.reviewedPlan,
          )
        // Persist the host task immediately; if the start fails, the thread remains reviewable.
        const adopt = (task: Task) =>
          change((s) => ({
            ...s,
            chats: s.chats.map((c) =>
              c.id === chat.id
                ? {
                    ...c,
                    taskId: task.id,
                    workspaceId: task.workspaceId,
                    branchNamingFallback: task.branchNamingFallback,
                  }
                : c,
            ),
          }))
        // One host call creates the thread, sets a worktree up and starts the agent.
        const plan = await planned()
        const result = await invoke(
          item.computerId,
          'thread.start',
          creation,
          plan,
          item.text,
          item.settings,
          item.attachments,
          item.context,
        )
        adopt(result.task)
        if (result.error || !result.session) throw new Error(result.error ?? 'The agent did not start.')
        taskId = result.task.id
        sessionId = result.session.id
      } else {
        // Only a worktree has anything to set up; the host's setup of a current checkout does nothing.
        if (item.checkout === 'worktree') await invoke(item.computerId, 'tasks.setup', taskId)
        const session = await invoke(
          item.computerId,
          'agent.start',
          taskId,
          item.text,
          item.settings,
          item.attachments,
          item.context,
        )
        sessionId = session.id
      }
      change((s) => ({
        ...s,
        chats: s.chats.map((c) => (c.id === chat.id ? { ...c, taskId, sessionId, pending: false } : c)),
      }))
    } else if (!sessionId) {
      const session = await invoke(
        item.computerId,
        'agent.start',
        chat.taskId,
        item.text,
        chat.settings ?? settingsFor(chat.provider, chat.model, chat.effort),
        item.attachments,
        item.context,
      )
      sessionId = session.id
    } else {
      // submit handles idle chats too and preserves attachments; the host decides queue/steer semantics.
      await invoke(
        item.computerId,
        'agent.submit',
        sessionId,
        item.text,
        item.mode === 'steer' ? 'steer' : 'queue',
        item.attachments,
        item.context,
      )
    }
    change((s) => ({
      ...s,
      outbox: s.outbox.map((o) =>
        o.id === item.id ? { ...o, state: 'accepted', acceptedAt: Date.now(), error: undefined } : o,
      ),
      chats: s.chats.map((c) => (c.id === chat.id ? { ...c, sessionId, pending: false } : c)),
    }))
    // If its history entry never appears (a renamed or archived thread), stop holding the queue once the hold ends.
    setTimeout(() => {
      change((s) => s)
      void flush(item.computerId)
    }, ACCEPTED_HOLD_MS + 500)
    // Keep the acknowledged bubble until the authoritative message or queue entry is mounted.
    // Finish reconciliation before another identical message takes its history baseline.
    const delivered = ref.current.chats.find((c) => c.id === chat.id)
    const reconcile = (
      delivered?.taskId && sessionId
        ? reconcileThread(item.computerId, delivered.taskId, sessionId)
        : refresh(item.computerId, true)
    ).catch(report)
    // Another message for this host takes its history baseline next, so only then wait for the refresh.
    if (ref.current.outbox.some((o) => o.computerId === item.computerId && o.id !== item.id && o.state !== 'accepted'))
      await reconcile
  }
  const flush = async (id: string) => {
    if (flushing.current.has(id) || ref.current.outbox.some((o) => o.computerId === id && holdsQueue(o))) return
    flushing.current.add(id)
    try {
      while (
        active.current &&
        !connections.current.get(id)?.controller.signal.aborted &&
        (ref.current.computers.find((c) => c.id === id)?.status === 'online' || connections.current.get(id)?.live) &&
        ref.current.computers.find((c) => c.id === id)?.access !== 'viewer'
      ) {
        const item = ref.current.outbox.find((o) => o.computerId === id && o.state !== 'accepted')
        if (!item || item.state === 'uncertain' || item.state === 'sending' || item.state === 'review') break
        // While the first refresh after reconnecting still runs, only a follow-up on a thread this phone already has
        // may go out: a new thread or session is created against the refreshed lists.
        if (
          ref.current.computers.find((c) => c.id === id)?.status !== 'online' &&
          !(item.kind === 'message' && ref.current.chats.find((c) => c.id === item.chatId)?.sessionId)
        )
          break
        change((s) => ({
          ...s,
          outbox: s.outbox.map((o) =>
            o.id === item.id
              ? {
                  ...o,
                  state: 'sending',
                  deliveryBaseline: deliveryBaseline(
                    s.chats.find((chat) => chat.id === o.chatId)!,
                    o.text,
                  ),
                }
              : o,
          ),
        }))
        // Let the tap, composer clear and sending state paint before the durable profile save below.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (ref.current.computers.find((computer) => computer.id === id)?.access === 'viewer') {
          change((s) => ({
            ...s,
            outbox: s.outbox.map((queued) =>
              queued.id === item.id
                ? { ...queued, state: 'waiting', error: VIEW_ONLY_WRITE_NOTICE[s.language] }
                : queued,
            ),
          }))
          break
        }
        try {
          // Record only this message before the call; the full profile (every transcript) saves on its own schedule.
          sendJournal = [...sendJournal, item.id]
          writeSendJournal(sendJournal)
          if (!active.current || connections.current.get(id)?.controller.signal.aborted) {
            change((s) => ({ ...s, outbox: s.outbox.map((o) => (o.id === item.id ? { ...o, state: 'waiting' } : o)) }))
            break
          }
          await deliver(item)
          if (ref.current.outbox.some((o) => o.computerId === id && holdsQueue(o))) break
        } catch (error) {
          // Only a confirmed pre-allocation rejection can approve new bases. An unknown outcome
          // keeps its original request and plan until delivery is reconciled.
          const review =
            item.kind === 'chat' &&
            !!item.reviewedPlan &&
            error instanceof HostError &&
            !error.ambiguous &&
            error.message === 'Repository HEAD changed since preview. Review the worktree plan and try again.'
          change((s) => ({
            ...s,
            outbox: s.outbox.map((o) =>
              o.id === item.id
                ? {
                    ...o,
                    state: review ? 'review' : 'uncertain',
                    error: error instanceof Error ? error.message : String(error),
                  }
                : o,
            ),
          }))
          report(error)
          break
        }
      }
    } finally {
      flushing.current.delete(id)
    }
  }
  const routeTimes = useRef(new Map<string, number>())
  const due = (key: string, every: number) => {
    const now = Date.now()
    if (now - (routeTimes.current.get(key) ?? -Infinity) < every) return false
    routeTimes.current.set(key, now)
    return true
  }

  /** While the host answers, keep the other addresses it names. Only a proven answer is believed. */
  async function learnRoutes(id: string) {
    const computer = ref.current.computers.find((c) => c.id === id)
    if (!computer?.hostId || !computer.deviceId || !due(`learn:${id}`, 60_000)) return
    const token = await readToken(id)
    if (!token) return
    const result = await verifyHost({
      fetch: (target, init) => expoFetch(target, init) as ReturnType<Parameters<typeof verifyHost>[0]['fetch']>,
      baseUrl: computer.address,
      deviceId: computer.deviceId,
      token,
      expectedHostId: computer.hostId,
      challenge: operationKey(),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null)
    if (result?.state !== 'verified' || !active.current) return
    change((s) => ({
      ...s,
      computers: s.computers.map((c) =>
        c.id === id && c.address === computer.address && c.deviceId === computer.deviceId
          ? { ...c, routes: rememberRoutes(c.address, result.routes, c.routes) }
          : c,
      ),
    }))
  }

  const reconnectTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>())

  /** Saves a host this phone just paired with, by code or by request, and connects to it. */
  async function savePairing(
    name: string,
    url: string,
    result: { deviceId: string; token: string; hostId?: unknown },
  ): Promise<string> {
    // The host's own id says which computer this is, so pairing it again at a new address keeps its entry (and the
    // drafts, unread state and queued messages keyed to it). The address decides only for a host without an id.
    const known =
      (typeof result.hostId === 'string' ? ref.current.computers.find((c) => c.hostId === result.hostId) : undefined) ??
      ref.current.computers.find((c) => c.address === url)
    const id = known?.id ?? uid()
    await saveIssuedCredential(() => saveToken(id, result.token))
    const computer: Computer = {
      id,
      name: name || (known && !known.auto ? known.name : new URL(url).hostname),
      auto: name ? false : known ? known.auto : true,
      address: url,
      os: 'linux',
      status: 'connecting',
      lastSeen: 0,
      deviceId: result.deviceId,
      ...(typeof result.hostId === 'string' ? { hostId: result.hostId } : {}),
    }
    change((s) => ({ ...s, selected: id, computers: [...s.computers.filter((c) => c.id !== id), computer] }))
    void connect(computer).catch(report)
    return id
  }
  async function reviewAddressFor(id: string, address: string, signal?: AbortSignal): Promise<ReviewAddressResult> {
    const computer = ref.current.computers.find((c) => c.id === id)
    if (!computer) throw new Error('That host is no longer saved')
    if (signal?.aborted) return 'unreachable'
    const url = normalizeAddress(address, true)
    if (url === computer.address) return 'unchanged'
    if (!computer.deviceId) return 'unsupported'
    if (computer.address.startsWith('https:') && url.startsWith('http:')) return 'insecure'
    const token = await readToken(id)
    if (!token) return 'unsupported'
    let failure: ReviewAddressResult = 'unreachable'
    const result = await findHostRoute({
      address: computer.address,
      routes: [url],
      signal: signal ?? new AbortController().signal,
      verify: async (candidate, probeSignal) => {
        const identity = await verifyHost({
          fetch: (target, init) => expoFetch(target, init) as ReturnType<Parameters<typeof verifyHost>[0]['fetch']>,
          baseUrl: candidate,
          deviceId: computer.deviceId!,
          token,
          expectedHostId: computer.hostId,
          challenge: operationKey(),
          signal: probeSignal,
        })
        if (identity.state !== 'verified') failure = identity.state
        return identity
      },
      usable: (candidate, probeSignal) =>
        checkHostConnection(candidate, token, expoFetch as typeof globalThis.fetch, probeSignal),
    })
    if (!result) return failure
    const current = ref.current.computers.find((c) => c.id === id)
    if (
      !current ||
      current.deviceId !== computer.deviceId ||
      (current.hostId && current.hostId !== result.hostId) ||
      !active.current ||
      signal?.aborted
    )
      return 'unreachable'
    const moved: Computer = {
      ...current,
      address: url,
      hostId: result.hostId,
      routes: rememberRoutes(current.address, result.routes, current.routes),
      status: 'connecting',
      error: undefined,
    }
    change((s) => ({ ...s, computers: s.computers.map((c) => (c.id === id ? moved : c)) }))
    void connect(moved).catch(report)
    return 'moved'
  }

  const connect = async (computer: Computer, resuming = false, retries = 0): Promise<void> => {
    clearTimeout(reconnectTimers.current.get(computer.id))
    reconnectTimers.current.delete(computer.id)
    const old = connections.current.get(computer.id)
    old?.controller.abort()
    old?.client.close()
    connections.current.delete(computer.id)
    const generation = (generations.current.get(computer.id) ?? 0) + 1
    generations.current.set(computer.id, generation)
    // A connection the person turned off stays off: no connecting and no retries.
    if (!active.current || ref.current.computers.find((c) => c.id === computer.id)?.status === 'paused') return
    const shown = ref.current.computers.find((c) => c.id === computer.id)?.status ?? computer.status
    const starting = attemptStatus(shown, retries > 0)
    if (starting && (!resuming || shown !== 'online')) status(computer.id, starting)
    const token = await readToken(computer.id)
    if (generations.current.get(computer.id) !== generation || !active.current) return
    if (!token) {
      status(computer.id, 'revoked', 'Missing device credential. Pair again.')
      return
    }
    const connection: { client: HostClient; controller: AbortController; generation: number; live?: boolean } = {
      client: new HostClient(computer.address, token, expoFetch as typeof globalThis.fetch),
      controller: new AbortController(),
      generation,
    }
    connections.current.set(computer.id, connection)
    const current = () =>
      active.current && !connection.controller.signal.aborted && connections.current.get(computer.id) === connection
    let backoff = retries
    try {
      if (computer.deviceId) {
        const hint = developmentHostRoute(computer.address, developmentBundleUrl())
        const route = await chooseHostRoute({
          address: computer.address,
          routes: [...(hint ? [hint] : []), ...(computer.routes ?? [])],
          signal: connection.controller.signal,
          verify: (address, signal) =>
            verifyHost({
              fetch: (target, init) => expoFetch(target, init) as ReturnType<Parameters<typeof verifyHost>[0]['fetch']>,
              baseUrl: address,
              deviceId: computer.deviceId!,
              token,
              expectedHostId: computer.hostId,
              challenge: operationKey(),
              signal,
            }),
          usable: (address, signal) =>
            checkHostConnection(address, token, expoFetch as typeof globalThis.fetch, signal),
        })
        if (!current()) return
        if (!route) throw new HostError('Host unreachable. Checking saved addresses again shortly.')
        const saved = ref.current.computers.find((c) => c.id === computer.id)
        if (!saved || saved.deviceId !== computer.deviceId) return
        const resolved: Computer = {
          ...saved,
          address: route.address,
          hostId: route.hostId,
          routes: rememberRoutes(saved.address, route.routes, saved.routes),
          error: undefined,
        }
        routeTimes.current.set(`learn:${computer.id}`, Date.now())
        change((s) => ({ ...s, computers: s.computers.map((c) => (c.id === computer.id ? resolved : c)) }))
        if (route.address !== computer.address) {
          void connect(resolved).catch(report)
          return
        }
      }
      const info = await readConnectionStatus(connection.client, connection.controller.signal)
      if (!current()) return
      if (info.protocol !== 1 || !info.capabilities?.includes('mobile-companion'))
        throw new HostError('Update Ramu on this host: its protocol is incompatible.', 426)
      change((s) => ({
        ...s,
        computers: s.computers.map((c) =>
          c.id === computer.id
            ? {
                ...c,
                access: info.access ?? c.access,
                os: info.platform === 'darwin' ? 'macos' : info.platform === 'win32' ? 'windows' : 'linux',
                ...(info.os ? { system: info.os } : {}),
                ...(c.auto && info.hostname ? { name: info.hostname, auto: false } : {}),
              }
            : c,
        ),
      }))
      // The host shows this phone with its own icon and OS; an older host without the method just refuses it.
      void connection.client.invoke('device.describe', thisDeviceOs()).catch(() => {})
      // Rotate the device token about monthly on hosts that support it; a failure only retries next connect.
      if (info.capabilities?.includes('renewal'))
        void readRenewedAt(computer.id)
          .then((renewedAt) =>
            renewalDue(Date.now(), renewedAt)
              ? renewCredential(
                  {
                    address: connection.client.address,
                    token: () => connection.client.currentToken(),
                    useToken: (next) => connection.client.useToken(next),
                  },
                  connection.client.fetch,
                  (next) => saveToken(computer.id, next),
                  (at) => saveRenewedAt(computer.id, at),
                )
              : false,
          )
          .catch(() => {})
      await connection.client.stream(
        (...args) => {
          if (current()) receive(computer.id, ...args)
        },
        async () => {
          if (!current()) return
          connection.live = true
          backoff = 0
          // Reachability and history synchronization are separate. A long transcript must not keep the host Connecting.
          status(computer.id, 'online')
          void flush(computer.id)
          void learnRoutes(computer.id)
          if (pushToken.current) void registerPushOn(computer.id).catch(report)
          try {
            await refreshing.current.get(computer.id)?.catch(() => {})
            if (!current()) return
            await refresh(computer.id, true)
            if (current()) void flush(computer.id)
          } catch (error) {
            if (current()) report(error)
          }
        },
        connection.controller.signal,
      )
    } catch (error) {
      const wasLive = !!connection.live
      connection.live = false
      if (!current()) return
      if (error instanceof HostError && [401, 426].includes(error.status)) {
        status(computer.id, 'revoked', error.message)
        return
      }
      status(computer.id, failureStatus(wasLive), error instanceof Error ? error.message : 'Host unreachable')
      // Retire this generation now, so late history reads cannot hold up or overwrite the next connection.
      connection.controller.abort()
      connection.client.close()
      connections.current.delete(computer.id)
      const timer = setTimeout(
        () => {
          reconnectTimers.current.delete(computer.id)
          if (!active.current || generations.current.get(computer.id) !== generation) return
          const saved = ref.current.computers.find((c) => c.id === computer.id)
          if (saved && mayConnect(saved.status)) void connect(saved, false, backoff + 1).catch(report)
        },
        Math.min(30_000, 1000 * 2 ** Math.min(backoff, 5)) + Math.random() * 500,
      )
      reconnectTimers.current.set(computer.id, timer)
    }
  }
  useEffect(() => {
    active.current = AppState.currentState !== 'background'
    for (const computer of ref.current.computers) if (mayConnect(computer.status)) void connect(computer).catch(report)
    change((s) => ({ ...s, ready: true }))
    if (ref.current.drafts['push-enabled'] === 'yes')
      void import('./push')
        .then((module) => module.registerPush())
        .then((token) => {
          pushToken.current = token
          for (const c of ref.current.computers) if (c.status === 'online') void registerPushOn(c.id).catch(report)
        })
        .catch(report)
    const app = AppState.addEventListener('change', (next) => {
      // Native sheets and permission prompts briefly report inactive; only background suspends transport.
      const foreground = appForeground(active.current, next)
      if (foreground === active.current) return
      active.current = foreground
      if (!foreground) {
        for (const timer of reconnectTimers.current.values()) clearTimeout(timer)
        reconnectTimers.current.clear()
        void writeLocal({
          ...ref.current,
          usage: undefined,
          catalogs: undefined,
          ready: undefined,
          error: undefined,
        })
          .then(clearSaveError)
          .catch((error) =>
            report(new Error(`Could not save phone data. ${error instanceof Error ? error.message : String(error)}`)),
          )
      }
      if (!foreground)
        for (const [id, connection] of connections.current) {
          generations.current.set(id, connection.generation + 1)
          connection.controller.abort()
          connection.client.close()
          // Suspending this phone says nothing about the host's availability.
        }
      else
        for (const computer of ref.current.computers)
          if (mayConnect(computer.status)) void connect(computer, true).catch(report)
    })
    const poll = setInterval(() => {
      if (active.current)
        for (const computer of ref.current.computers)
          if (computer.status === 'online') {
            void refresh(computer.id, 'live').catch(report)
            void learnRoutes(computer.id)
          }
    }, 20_000)
    return () => {
      app.remove()
      clearInterval(poll)
      // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
      for (const timer of reconnectTimers.current.values()) clearTimeout(timer)
      reconnectTimers.current.clear()
      // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
      for (const timer of [...changeTimers.current.values(), ...rebuilds.current.values()]) clearTimeout(timer)
      changeTimers.current.clear()
      rebuilds.current.clear()
      active.current = false
      // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup must see the latest value, not the one from mount
      for (const connection of connections.current.values()) {
        connection.controller.abort()
        connection.client.close()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
  }, [])
  // The profile holds every transcript, so saving it is the phone's heaviest work: a queued message is saved promptly,
  // and anything else waits for a pause in streaming. Typing never triggers it (drafts save on their own below).
  const savedOutbox = useRef(state.outbox)
  useEffect(() => {
    const timer = setTimeout(
      () => {
        const outbox = ref.current.outbox
        savedOutbox.current = outbox
        void writeLocal({
          computers: ref.current.computers,
          projects: ref.current.projects,
          chats: ref.current.chats,
          selected: ref.current.selected,
          language: ref.current.language,
          outbox,
          drafts: ref.current.drafts,
        })
          .then(() => {
            // The profile now records these messages' outcomes, so the journal no longer needs them.
            const left = remainingJournal(sendJournal, outbox)
            if (left.length !== sendJournal.length) {
              sendJournal = left
              writeSendJournal(left)
            }
          })
          .then(clearSaveError)
          .catch((error) =>
            report(new Error(`Could not save phone data. ${error instanceof Error ? error.message : String(error)}`)),
          )
      },
      savedOutbox.current === state.outbox ? 1500 : 250,
    )
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [state.computers, state.projects, state.chats, state.selected, state...] by design; the values it reads beyond these are current as of that run
  }, [state.computers, state.projects, state.chats, state.selected, state.language, state.outbox])
  // Drafts save on their own, small and soon after typing pauses; the profile keeps a copy whenever it saves.
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        writeDrafts(ref.current.drafts)
      } catch (error) {
        report(new Error(`Could not save drafts. ${error instanceof Error ? error.message : String(error)}`))
      }
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [state.drafts] by design; it reads the latest drafts when it fires
  }, [state.drafts])
  const sessionAction = (id: string, fn: (computer: string, session: string) => Promise<unknown>) => {
    const chat = ref.current.chats.find((c) => c.id === id)
    if (chat?.sessionId)
      void fn(chat.computerId, chat.sessionId)
        .then(() => refresh(chat.computerId))
        .catch(report)
  }
  const store: Store = {
    ...state,
    notifications,
    activity,
    inbox,
    defaults: startSettings,
    modelPrefs,
    mobileLayers,
    setMobileLayer: (id, layer) => setMobileLayers((p) => ({ ...p, [id]: layer })),
    appPreferences,
    mayUse: (id, permission) => mayUse(permissions[id], permission, Date.now()),
    reloadPermissions: loadPermissions,
    invoke,
    refresh,
    acknowledge: (chatId) => {
      const chat = ref.current.chats.find((c) => c.id === chatId)
      if (chat?.sessionId) store.dismissNotice(chat.computerId, `agent:${chat.sessionId}`)
    },
    dismissNotice: (computerId, noticeId) => {
      if (!(inboxRef.current[computerId] ?? []).some((n) => n.id === noticeId)) return
      setInbox((i) => ({ ...i, [computerId]: (i[computerId] ?? []).filter((n) => n.id !== noticeId) }))
      void invoke(computerId, 'notices.dismiss', noticeId).catch(() => {})
    },
    clearNotices: (computerId) => {
      setInbox((i) => ({ ...i, [computerId]: [] }))
      void invoke(computerId, 'notices.clear').catch(() => {})
    },
    enablePush: async () => {
      const { registerPush } = await import('./push')
      const token = await registerPush()
      pushToken.current = token
      change((s) => ({ ...s, drafts: { ...s.drafts, 'push-enabled': 'yes' } }))
      await Promise.all(ref.current.computers.filter((c) => c.status === 'online').map((c) => registerPushOn(c.id)))
    },
    setPushCategory: (category, on) => {
      const muted = withCategory(ref.current.drafts[PUSH_MUTED_KEY], category, on)
      change((s) => ({ ...s, drafts: { ...s.drafts, [PUSH_MUTED_KEY]: muted } }))
      if (pushToken.current)
        for (const c of ref.current.computers) if (c.status === 'online') void registerPushOn(c.id).catch(report)
    },
    disablePush: async () => {
      if (ref.current.computers.some((c) => c.status !== 'online'))
        throw new Error('Reconnect every host before disabling push so each registration can be removed.')
      await Promise.all(ref.current.computers.map((c) => invoke(c.id, 'notifications.unregister')))
      pushToken.current = null
      change((s) => ({ ...s, drafts: { ...s.drafts, 'push-enabled': '' } }))
    },
    resolveChat: (computerId, taskId) =>
      ref.current.chats.find((c) => c.computerId === computerId && c.taskId === taskId)?.id ??
      scoped(computerId, taskId),
    select: (selected) => change((s) => ({ ...s, selected })),
    setLanguage: (language) => change((s) => ({ ...s, language })),
    pair: async (name, address, code, allowHttp) => {
      const url = normalizeAddress(address, allowHttp)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await expoFetch(`${url}/pair`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-ramu-protocol': '1' },
          body: JSON.stringify({ name: Device.deviceName || Device.modelName || 'Ramu phone', code }),
          signal: controller.signal,
        })
        const result = await response.json().catch(() => ({}))
        if (response.status === 429)
          throw new Error('Too many pairing attempts. Wait a minute, then use a fresh code from the host.')
        if (!response.ok || !result.token || !result.deviceId)
          throw new Error(result.error || `Pairing failed (${response.status})`)
        return await savePairing(name, url, result)
      } finally {
        clearTimeout(timer)
      }
    },
    pairByRequest: async (name, address, allowHttp, onCode, signal) => {
      const url = normalizeAddress(address, allowHttp)
      const random = await secureRandom()
      if (!random) throw new PairRequestUnsupported()
      const result = await requestPairing({
        post: async (path, body, aborted) => {
          const response = await expoFetch(`${url}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-ramu-protocol': '1' },
            body: JSON.stringify(body),
            signal: aborted,
          })
          const text = await response.text()
          let parsed: unknown = null
          try {
            parsed = text ? JSON.parse(text) : null
          } catch {}
          return { status: response.status, body: parsed }
        },
        name: Device.deviceName || Device.modelName || 'Ramu phone',
        random,
        onCode,
        signal,
      })
      return savePairing(name, url, result)
    },
    reviewAddress: reviewAddressFor,
    probeHosts: (signal, found) => {
      const computers = ref.current.computers
      return probeReachableHosts({
        computers,
        bundleUrl: developmentBundleUrl(),
        signal,
        found: (host) => {
          if (signal.aborted) return
          if (host.pairedHostId) {
            const original = computers.find((c) => c.id === host.pairedHostId)
            const current = ref.current.computers.find((c) => c.id === host.pairedHostId)
            if (
              !current ||
              current.deviceId !== original?.deviceId ||
              (current.hostId && current.hostId !== host.hostId)
            )
              return
            // A device proof can upgrade older pairings that saved their device id but not the host id.
            change((s) => ({
              ...s,
              computers: s.computers.map((c) =>
                c.id === current.id
                  ? {
                      ...c,
                      hostId: host.hostId,
                      routes: rememberRoutes(
                        c.address,
                        host.routes.map((route) => route.url),
                        c.routes,
                      ),
                    }
                  : c,
              ),
            }))
          }
          found(host)
        },
        tokenFor: readToken,
        fetch: expoFetch as typeof globalThis.fetch,
        usable: async (address, token, probeSignal) => {
          // Reuse a live client: closing a temporary probe of its pooled socket would disconnect the conversation.
          const existing = [...connections.current.values()].find(
            (connection) =>
              !connection.controller.signal.aborted &&
              connection.client.address === address &&
              connection.client.currentToken() === token,
          )
          if (existing) {
            const info = await existing.client.invoke('background.status')
            return info.protocol === 1 && !!info.capabilities?.includes('mobile-companion')
          }
          return checkHostConnection(address, token, expoFetch as typeof globalThis.fetch, probeSignal)
        },
      })
    },
    setConnected: async (id, on) => {
      const computer = ref.current.computers.find((c) => c.id === id)
      if (!computer || computer.status === 'revoked') return
      if (!on) {
        clearTimeout(reconnectTimers.current.get(id))
        reconnectTimers.current.delete(id)
        const connection = connections.current.get(id)
        generations.current.set(id, (generations.current.get(id) ?? 0) + 1)
        connection?.controller.abort()
        connection?.client.close()
        connections.current.delete(id)
        status(id, 'paused')
      } else {
        status(id, 'offline')
        const saved = ref.current.computers.find((c) => c.id === id)
        if (saved) await connect(saved)
      }
      await writeLocal({ ...ref.current, usage: undefined, catalogs: undefined, ready: undefined, error: undefined })
    },
    forget: async (id) => {
      clearTimeout(reconnectTimers.current.get(id))
      reconnectTimers.current.delete(id)
      await invoke(id, 'notifications.unregister').catch(() => {})
      const current = ref.current
      const computers = current.computers.filter((c) => c.id !== id)
      const next = {
        ...current,
        computers,
        selected: current.selected === id ? (computers[0]?.id ?? '') : current.selected,
        projects: current.projects.filter((p) => p.computerId !== id),
        chats: current.chats.filter((c) => c.computerId !== id),
        outbox: current.outbox.filter((o) => o.computerId !== id),
        drafts: Object.fromEntries(Object.entries(current.drafts).filter(([key]) => !key.startsWith(`${id}:`))),
        usage: Object.fromEntries(Object.entries(current.usage).filter(([key]) => key !== id)),
        catalogs: Object.fromEntries(Object.entries(current.catalogs).filter(([key]) => key !== id)),
      }
      await writeLocal(
        {
          computers: next.computers,
          projects: next.projects,
          chats: next.chats,
          selected: next.selected,
          language: next.language,
          outbox: next.outbox,
          drafts: next.drafts,
        },
        { replaceBackups: true },
      )
      generations.current.set(id, (generations.current.get(id) ?? 0) + 1)
      const connection = connections.current.get(id)
      connection?.controller.abort()
      connection?.client.close()
      connections.current.delete(id)
      for (const key of eventRows.current.keys()) if (key.startsWith(`${id}:`)) eventRows.current.delete(key)
      for (const key of changeCursors.current.keys()) if (key.startsWith(`${id}:`)) changeCursors.current.delete(key)
      listeners.current.delete(id)
      buffers.current.delete(id)
      setNotifications((n) => n.filter((x) => x.computerId !== id))
      setActivity((a) => Object.fromEntries(Object.entries(a).filter(([key]) => key !== id)))
      change((latest) => ({
        ...latest,
        computers: latest.computers.filter((c) => c.id !== id),
        selected: latest.selected === id ? next.selected : latest.selected,
        projects: latest.projects.filter((p) => p.computerId !== id),
        chats: latest.chats.filter((c) => c.computerId !== id),
        outbox: latest.outbox.filter((o) => o.computerId !== id),
        drafts: Object.fromEntries(Object.entries(latest.drafts).filter(([key]) => !key.startsWith(`${id}:`))),
        usage: Object.fromEntries(Object.entries(latest.usage).filter(([key]) => key !== id)),
        catalogs: Object.fromEntries(Object.entries(latest.catalogs).filter(([key]) => key !== id)),
      }))
      // Drain snapshots queued during removal and purge both recovery slots before removing credentials.
      await writeLocal(
        { ...ref.current, usage: undefined, catalogs: undefined, ready: undefined, error: undefined },
        { replaceBackups: true },
      )
      await deleteToken(id)
    },
    retry: (id) => {
      const computer = ref.current.computers.find((c) => c.id === id)
      if (computer) void connect(computer).catch(report)
    },
    watch: (id, channels, keys) => {
      const off = connections.current.get(id)?.client.watch(channels, keys)
      // Threads other than the ones on screen arrive in brief, so a thread just asked for is read up to date, from where
      // its last read left off, as the periodic refresh does.
      const shown = (channels.includes('agent:event') && keys?.['agent:event']) || []
      for (const sessionId of shown) shownSessions.current.add(scoped(id, sessionId))
      if (off && channels.includes('agent:event')) {
        if (!keys?.['agent:event']) void refresh(id, true).catch(report)
        for (const sessionId of shown) {
          const chat = ref.current.chats.find((c) => c.computerId === id && c.sessionId === sessionId)
          if (chat?.taskId) void reconcileThread(id, chat.taskId, sessionId).catch(report)
        }
      }
      return () => {
        off?.()
        for (const sessionId of shown) shownSessions.current.delete(scoped(id, sessionId))
      }
    },
    subscribe: (id, listener) => {
      const set = listeners.current.get(id) ?? new Set()
      set.add(listener)
      listeners.current.set(id, set)
      return () => {
        set.delete(listener)
      }
    },
    isOnline: (id) => ref.current.computers.find((c) => c.id === id)?.status === 'online',
    send: async (id, text, mode, attachments, context) => {
      const chat = ref.current.chats.find((c) => c.id === id)
      if (!chat) throw new Error('Thread not found')
      if (ref.current.computers.find((computer) => computer.id === chat.computerId)?.access === 'viewer')
        throw new Error(VIEW_ONLY_WRITE_NOTICE[ref.current.language])
      if (ref.current.computers.find((c) => c.id === chat.computerId)?.status === 'revoked')
        throw new Error('Pair this host again before sending.')
      const item: OutboxItem = {
        id: uid(),
        chatId: id,
        computerId: chat.computerId,
        kind: 'message',
        text,
        mode,
        createdAt: Date.now(),
        attachments,
        context,
        state: 'waiting',
        deliveryBaseline: deliveryBaseline(chat, text),
      }
      change((s) => ({ ...s, outbox: [...s.outbox, item] }))
      void flush(chat.computerId)
    },
    createChat: async (input) => {
      const computerId = newChatHost(
        input.computerId,
        input.projectId,
        ref.current.computers,
        ref.current.projects,
        STANDALONE,
      )
      if (ref.current.computers.find((computer) => computer.id === computerId)?.access === 'viewer')
        throw new Error(VIEW_ONLY_WRITE_NOTICE[ref.current.language])
      const id = scoped(computerId, `pending-${uid()}`)
      const chat: Chat = {
        id,
        taskId: '',
        sessionId: null,
        computerId,
        projectId: input.projectId,
        title: input.text.slice(0, 60) || 'Discuss attachments',
        mode: input.mode,
        workspaceId: input.workspaceId ?? null,
        status: 'idle',
        createdAt: Date.now(),
        pinnedAt: null,
        lastActiveAt: Date.now(),
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        settings: { ...settingsFor(input.provider, input.model, input.effort), ...input.settings },
        preview: 'Waiting to send',
        items: [],
        queue: [],
        goal: null,
        branch: '',
        pending: true,
      }
      const item: OutboxItem = {
        id: uid(),
        chatId: id,
        computerId,
        kind: 'chat',
        text: input.text,
        mode: 'send',
        createdAt: Date.now(),
        projectId: input.projectId,
        checkout: input.mode,
        workspaceId: input.workspaceId,
        branchNaming:
          input.mode === 'worktree' && !input.workspaceId
            ? {
                ...(input.branchNaming ?? {
                  strategy: appPreferences[computerId]?.worktreeBranchNaming ?? 'fixed',
                  instructions: appPreferences[computerId]?.worktreeBranchInstructions ?? '',
                  prompt: input.text.slice(0, 6000),
                }),
              }
            : undefined,
        branchChoice:
          input.mode === 'worktree' && !input.workspaceId && input.branchChoice ? { ...input.branchChoice } : undefined,
        reviewedPlan:
          input.mode === 'worktree' && !input.workspaceId
            ? input.reviewedPlan?.map((entry) => ({ ...entry }))
            : undefined,
        branchPrefix:
          input.mode === 'worktree' && !input.workspaceId
            ? (input.branchPrefix ?? appPreferences[computerId]?.worktreeBranchPrefix ?? 'ramu/')
            : undefined,
        settings: { ...settingsFor(input.provider, input.model, input.effort), ...input.settings },
        attachments: input.attachments,
        context: input.context,
        state: 'waiting',
      }
      change((s) => ({ ...s, chats: [chat, ...s.chats], outbox: [...s.outbox, item] }))
      void flush(computerId)
      return id
    },
    previewOutbox: async (id) => {
      const item = ref.current.outbox.find((o) => o.id === id)
      if (
        !item ||
        item.state !== 'review' ||
        !item.projectId ||
        item.workspaceId ||
        item.checkout !== 'worktree' ||
        ref.current.chats.find((c) => c.id === item.chatId)?.taskId
      )
        throw new Error('This item is not awaiting base review')
      const projectId = raw(item.projectId)
      const repos = await invoke(item.computerId, 'repos.list', projectId)
      return invoke(
        item.computerId,
        'tasks.plan',
        projectId,
        item.text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments',
        repos.map((r) => r.id),
        item.branchChoice,
        { branchPrefix: item.branchPrefix ?? 'ramu/', strategy: item.branchNaming?.strategy ?? 'fixed' },
      )
    },
    resumeOutbox: async (id, plan) => {
      const item = ref.current.outbox.find((o) => o.id === id)
      if (
        !item ||
        item.state !== 'review' ||
        ref.current.chats.find((c) => c.id === item.chatId)?.taskId ||
        !plan.length ||
        plan.some((entry) => !entry.baseOid)
      )
        throw new Error('This item is not awaiting base review')
      const next: State = {
        ...ref.current,
        outbox: ref.current.outbox.map((o) =>
          o.id === id
            ? { ...o, reviewedPlan: plan.map((entry) => ({ ...entry })), state: 'waiting', error: undefined }
            : o,
        ),
      }
      // Commit approval before changing visible state or retrying. Storage failure leaves review intact.
      await writeLocal({ ...next, ready: undefined, error: undefined, usage: undefined, catalogs: undefined })
      change((latest) => ({
        ...latest,
        outbox: latest.outbox.map((entry) =>
          entry.id === id ? next.outbox.find((updated) => updated.id === id)! : entry,
        ),
      }))
      void flush(item.computerId)
    },
    cancelOutbox: (id) => {
      const item = ref.current.outbox.find((o) => o.id === id)
      if (!item || item.state === 'sending' || item.state === 'accepted') return
      change((s) => ({
        ...s,
        outbox: s.outbox.filter((o) => o.id !== id),
        chats:
          item.kind === 'chat' && !s.chats.find((c) => c.id === item.chatId)?.taskId
            ? s.chats.filter((c) => c.id !== item.chatId)
            : s.chats,
      }))
      return item.text
    },
    stop: (id) => sessionAction(id, (pc, session) => invoke(pc, 'agent.stop', session)),
    answer: (id, request, answers) =>
      sessionAction(id, (pc, session) =>
        answers._ === 'Dismissed'
          ? invoke(pc, 'agent.dismissQuestion', session, request)
          : invoke(pc, 'agent.replyQuestion', session, request, answers),
      ),
    decide: (id, request, decision, scope = 'once', pattern) =>
      sessionAction(id, (pc, session) =>
        invoke(pc, 'agent.replyPermission', session, request, decision === 'allow', undefined, scope, pattern),
      ),
    forgetApproval: (id, request, scope) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.forgetPermission', session, request, scope)),
    elicitation: (id, request, action, answers) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.replyElicitation', session, request, action, answers)),
    removeQueued: (id, message) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.removeQueued', session, message)),
    sendQueuedNow: (id, message) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.sendQueuedNow', session, message, true)),
    toggleGoal: (id) =>
      sessionAction(id, (pc, session) =>
        invoke(
          pc,
          'agent.goal.control',
          session,
          isUserPaused(ref.current.chats.find((c) => c.id === id)?.goal) ? 'resume' : 'pause',
        ),
      ),
    clearGoal: (id) => sessionAction(id, (pc, session) => invoke(pc, 'agent.goal.control', session, 'clear')),
    setGoalVerify: async (id, command) => {
      const chat = ref.current.chats.find((c) => c.id === id)
      if (!chat?.sessionId) throw new Error('This thread has not started on the host yet.')
      await invoke(chat.computerId, GOAL_VERIFY_METHOD, chat.sessionId, command)
      void refresh(chat.computerId).catch(report)
    },
    retryLimitNow: async (id) => {
      const chat = ref.current.chats.find((c) => c.id === id)
      if (!chat?.sessionId) return null
      try {
        const result = (await invoke(chat.computerId, 'agent.retryLimitNow', chat.sessionId)) as LimitRetryResult
        void refresh(chat.computerId).catch(report)
        return result
      } catch (error) {
        report(error)
        return null
      }
    },
    setAutoResume: (id, autoResume) => {
      const chat = ref.current.chats.find((c) => c.id === id)
      if (!chat?.sessionId) return
      // Show the choice at once; the computer clears or re-arms the thread's timer, and the refresh confirms it.
      change((s) => ({
        ...s,
        chats: s.chats.map((c) => {
          if (c.id !== id || !c.settings) return c
          const { autoResume: _previous, ...rest } = c.settings
          return { ...c, settings: autoResume === null ? rest : { ...rest, autoResume } }
        }),
      }))
      void invoke(chat.computerId, 'agent.setAutoResume', chat.sessionId, autoResume)
        .then(() => refresh(chat.computerId))
        .catch((error) => {
          report(error)
          void refresh(chat.computerId)
        })
    },
    setModel: (id, provider, model, effort, extra) => {
      // Only these come from the caller; a full settings object here once carried the old model back in. The login was
      // left out, so choosing another account in the model picker did nothing.
      const options = extra
        ? {
            access: extra.access,
            autoFallback: extra.autoFallback,
            ...(extra.serviceTier ? { serviceTier: extra.serviceTier } : {}),
            ...(extra.accountId ? { accountId: extra.accountId } : {}),
          }
        : {}
      const chat = ref.current.chats.find((c) => c.id === id)
      if (!chat) return Promise.resolve()
      if (!chat.sessionId) {
        const settings = { ...settingsFor(provider, model, effort), ...options }
        change((s) => ({
          ...s,
          chats: s.chats.map((c) => (c.id === id ? { ...c, provider, model, effort, settings } : c)),
          outbox: s.outbox.map((o) => (o.chatId === id && o.kind === 'chat' ? { ...o, settings } : o)),
        }))
        return Promise.resolve()
      }
      // Show the choice at once, then let the computer apply it; a refusal puts the old values back and says why.
      const before = { provider: chat.provider, model: chat.model, effort: chat.effort, settings: chat.settings }
      change((s) => ({
        ...s,
        chats: s.chats.map((c) =>
          c.id === id
            ? {
                ...c,
                provider,
                model,
                effort,
                settings: c.settings
                  ? { ...c.settings, provider, model, effort: (effort || null) as AgentSettings['effort'], ...options }
                  : c.settings,
              }
            : c,
        ),
      }))
      return invoke(chat.computerId, 'agent.get', chat.sessionId)
        .then((info) =>
          invoke(chat.computerId, 'agent.configure', chat.sessionId!, {
            ...info.settings,
            ...(provider !== info.settings.provider ? { accountId: undefined } : {}),
            provider,
            model,
            effort: (effort || null) as AgentSettings['effort'],
            ...options,
          }),
        )
        .then(() => refresh(chat.computerId, true))
        .catch((error) => {
          change((s) => ({ ...s, chats: s.chats.map((c) => (c.id === id ? { ...c, ...before } : c)) }))
          report(error)
        })
    },
    clearComposerDraft: (key, expected) => {
      if (!ref.current.computers.some((host) => key.startsWith(`${host.id}:`))) return false
      const drafts = consumeComposerDraft(ref.current.drafts, key, expected)
      if (!drafts) return false
      change((s) => ({ ...s, drafts }))
      return true
    },
    addExplorerFile: async (input) => {
      const originalDrafts = ref.current.drafts
      const next = addExplorerFile(ref.current, input)
      // Persist before navigating. Storage failure leaves the original composer and navigation intact.
      await writeLocal({
        computers: ref.current.computers,
        projects: ref.current.projects,
        chats: ref.current.chats,
        selected: ref.current.selected,
        language: ref.current.language,
        outbox: ref.current.outbox,
        drafts: next.drafts,
      })
      if (!ref.current.computers.some((host) => host.id === input.computerId))
        throw new Error('This host was forgotten while saving. Pair it again to add the file.')
      const changedKeys = Object.keys(next.drafts).filter((key) => next.drafts[key] !== originalDrafts[key])
      if (changedKeys.some((key) => ref.current.drafts[key] !== originalDrafts[key]))
        throw new Error('The draft changed while saving. Try adding the file again.')
      change((s) => ({
        ...s,
        drafts: { ...s.drafts, ...Object.fromEntries(changedKeys.map((key) => [key, next.drafts[key]!])) },
      }))
      return next.destination
    },
    setDraft: (key, text) => change((s) => ({ ...s, drafts: { ...s.drafts, [key]: text } })),
    rememberExplorer: (host, context, navigation) =>
      change((s) => ({ ...s, drafts: rememberExplorerNavigation(s.drafts, host, context, navigation) })),
    dismissError: () => change((s) => ({ ...s, error: null })),
    dismissNotification: (index) => setNotifications((n) => n.filter((_, i) => i !== index)),
  }
  return <Context.Provider value={store}>{children}</Context.Provider>
}
export function useStore() {
  const store = useContext(Context)
  if (!store) throw new Error('StoreProvider missing')
  return store
}
/** The store when one is mounted; app chrome shown before startup finishes gets `null`. */
export function useOptionalStore() {
  return useContext(Context)
}
export function useChat(id?: string) {
  return useStore().chats.find((c) => c.id === id)
}
export function counts(chats: Chat[], computerId: string) {
  const mine = chats.filter((c) => c.computerId === computerId && !c.pending)
  return {
    running: mine.filter((c) => c.status === 'running' && !c.inputSummary?.count).length,
    waiting: mine.filter((c) => c.status === 'needs-input' || !!c.inputSummary?.count).length,
  }
}
