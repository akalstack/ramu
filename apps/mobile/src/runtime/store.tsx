import { appForeground } from './chatViewport'
import { agentActivityLabel } from '@ramu/shared/chat/agentActivity'
import './socketTransport'
import { viewerMayInvoke } from '@ramu/shared/viewerAccess'
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
import { AppState } from 'react-native'
import { fetch as expoFetch } from 'expo/fetch'
import * as Device from 'expo-device'
import type { PushEvents, RamuMethods, ReviewAddressResult } from '@ramu/shared/api'
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
import { deleteToken, readLocal, readRenewedAt, readToken, saveRenewedAt, saveToken, writeLocal } from '../storage'
import { renewalDue, renewCredential } from './tokenRenewal'
import { HostClient, HostError, normalizeAddress, operationKey } from './transport'
import { verifyHost } from '@ramu/shared/hostProof'
import { newerTaskSnapshot } from '@ramu/shared/chat/threadStatus'
import { transcript, visibleText, deliveryBaseline, reconcileDelivered } from './transcript'
import { isOutdated, type Language } from './settingsModel'
import { PUSH_MUTED_KEY, registerCategories, type PushCategory, withCategory } from './pushCategories'
import { GOAL_VERIFY_METHOD, isMethodMissing } from './goalVerify'
import { mergeTranscript, transcriptRows, updateThreadMetadata, readTranscriptBundle } from './transcriptChanges'
import { STANDALONE, type Chat, type Computer, type MobileProject } from './types'

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
  /** Moves a saved host to a new address only after that address proves it is the host this phone paired with. */
  reviewAddress(id: string, address: string): Promise<ReviewAddressResult>
  forget(id: string): Promise<void>
  retry(id: string): void
  invoke<M extends keyof RamuMethods>(
    computerId: string,
    method: M,
    ...args: Parameters<RamuMethods[M]>
  ): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  subscribe(computerId: string, listener: (channel: keyof PushEvents, payload: any) => void): () => void
  /** `full` re-reads every transcript (after a reconnect); otherwise chats already streaming keep their live transcript. */
  refresh(computerId: string, full?: boolean): Promise<void>
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
  decide(id: string, request: string, decision: 'allow' | 'deny'): void
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
  /** Methods a host has answered "Unknown method" to, per computer: it predates them, so their controls are hidden. */
  missingMethods: Record<string, string[]>
  /** Checks a thread held at a usage limit now instead of at the timer; resolves with whether it continued. */
  retryLimitNow(id: string): Promise<LimitRetryResult | null>
  /** This thread's own auto-resume choice at a limit; null clears it so the thread follows the host's default. */
  setAutoResume(id: string, autoResume: boolean | null): void
  removeQueued(id: string, message: string): void
  /** Resolves once the computer has applied it (or refused, which restores the old values and reports why). */
  setModel(
    id: string,
    provider: AgentProvider,
    model: string,
    effort: string,
    settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier'>,
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const saved = readLocal(defaults)
    return {
      ...defaults,
      ...saved,
      ready: false,
      chats: saved.chats.map((chat) => ({ ...chat, items: normalizeHelperGroups(chat.items) })),
      computers: saved.computers.map((c) => ({ ...c, status: c.status === 'revoked' ? 'revoked' : 'connecting' })),
      outbox: saved.outbox.map((o) =>
        o.state === 'sending'
          ? { ...o, state: 'uncertain', error: 'App closed during delivery. Check the host before retrying.' }
          : o,
      ),
    }
  })
  const ref = useRef(state)
  ref.current = state
  const connections = useRef(new Map<string, { client: HostClient; controller: AbortController; generation: number }>())
  const generations = useRef(new Map<string, number>())
  const eventRows = useRef(new Map<string, Map<number, AgentEvent>>())
  // The host's change counter for each transcript held in `eventRows`, so a refresh reads only what changed.
  const changeCursors = useRef(new Map<string, number>())
  const changesSupported = useRef(new Map<string, boolean>())
  const listeners = useRef(new Map<string, Set<(channel: keyof PushEvents, payload: any) => void>>())
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
  const [mobileLayers, setMobileLayers] = useState<
    Record<string, import('@ramu/shared/preferenceScopes').PreferenceLayer | null>
  >({})
  const [missingMethods, setMissingMethods] = useState<Record<string, string[]>>({})
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
  }, [mobileLayers])
  const loadDefaults = (id: string) => {
    // Older computers have no shared mobile layer; they keep working with the computer's own setting and this phone's.
    void invoke(id, 'preferences.layers.get').then(
      (snapshot) => setMobileLayers((p) => ({ ...p, [id]: snapshot.mobile })),
      (error) => {
        if (isOutdated(error)) setMobileLayers((p) => ({ ...p, [id]: null }))
      },
    )
    loadModels(id)
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
  const report = (error: unknown) =>
    change((s) => ({ ...s, error: error instanceof Error ? error.message : String(error) }))
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
  /** Registers this phone's push token with a host, along with the alert categories that are on (hosts that predate them ignore it). */
  const registerPushOn = (id: string) =>
    invoke(
      id,
      'notifications.register',
      pushToken.current!,
      id,
      ...registerCategories(ref.current.drafts[PUSH_MUTED_KEY]),
    )
  const rebuilds = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // Publish completed text blocks and coalesce other activity updates, leaving time for native input.
  const rebuild = (computerId: string, sessionId: string) => {
    const key = scoped(computerId, sessionId)
    if (rebuilds.current.has(key)) return
    rebuilds.current.set(
      key,
      setTimeout(() => {
        rebuilds.current.delete(key)
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
                  items,
                  activityLabel: agentActivityLabel(chat.executionState, events),
                  preview: preview?.kind === 'text' ? preview.text.slice(-140) : chat.preview,
                  inputSummary: ['stopped', 'failed'].includes(chat.executionState ?? '')
                    ? null
                    : inputSummary(events, sessionId),
                  compacting:
                    chat.executionState !== 'stopped' && chat.executionState !== 'failed' && isCompacting(events),
                }
              : chat,
          ),
        }))
      }, 50),
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
  const receive = (id: string, channel: keyof PushEvents, payload: any) => {
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
    for (const listener of listeners.current.get(id) ?? []) listener(channel, payload)
  }
  const refresh = (id: string, full = false): Promise<void> => {
    // A full refresh must not be satisfied by a light one already in flight.
    if (refreshing.current.has(id))
      return full ? refreshing.current.get(id)!.then(() => refresh(id, true)) : refreshing.current.get(id)!
    const connection = connections.current.get(id)
    if (!connection) return Promise.resolve()
    const current = () => connections.current.get(id) === connection && !connection.controller.signal.aborted
    const read = <M extends keyof RamuMethods>(method: M, ...args: Parameters<RamuMethods[M]>) => {
      if (!current()) throw new HostError('Connection suspended during refresh')
      return invoke(id, method, ...args)
    }
    buffers.current.set(id, [])
    const promise = (async () => {
      const [projects, tasks, catalogs, usage] = await Promise.all([
        read('projects.list'),
        read('tasks.list'),
        read('agent.catalog'),
        read('usage.get'),
      ])
      const projectViews = await Promise.all(
        projects.map(async (p) => {
          const repos = await read('repos.list', p.id)
          return {
            ...p,
            id: scoped(id, p.id),
            computerId: id,
            kind: repos.length === 1 ? ('repo' as const) : ('workspace' as const),
            repos: repos.map((r) => r.name),
          }
        }),
      )
      const revisions = new Map<string, number>()
      const chats: Chat[] = []
      // Bound concurrency for large workspaces and many saved computers.
      for (let index = 0; index < tasks.length; index += 6)
        await Promise.all(
          tasks
            .slice(index, index + 6)
            .filter((t) => t.status !== 'archived')
            .map(async (task) => {
              const sessions = await read('agent.list', task.id)
              const session = sessions.filter((s) => !s.parentId).sort((a, b) => b.createdAt - a.createdAt)[0]
              const known = ref.current.chats.find((c) => c.computerId === id && c.taskId === task.id)
              if (
                !full &&
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
                if (changesSupported.current.get(id) !== false) {
                  try {
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
                  } catch (error) {
                    // A host from before agent.changes sends the whole transcript every time.
                    if (!isMethodMissing(error)) throw error
                    changesSupported.current.set(id, false)
                  }
                }
                return { ...(await read('agent.snapshot', session.id)), cursor: undefined }
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
              const latestState = [...events].reverse().find((e) => e.kind === 'state')
              const sessionState = latestState?.kind === 'state' ? latestState.state : session?.state
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
                status:
                  sessionState === 'running' || sessionState === 'starting'
                    ? 'running'
                    : sessionState === 'needs-input'
                      ? 'needs-input'
                      : sessionState === 'failed'
                        ? 'failed'
                        : task.status === 'archived'
                          ? 'archived'
                          : task.status === 'ready-for-review'
                            ? 'ready-for-review'
                            : 'idle',
                inputSummary: ['stopped', 'failed'].includes(sessionState ?? '')
                  ? null
                  : inputSummary(events, session?.id ?? ''),
                executionState: sessionState,
                activityLabel: agentActivityLabel(sessionState, events),
                compacting: sessionState !== 'stopped' && sessionState !== 'failed' && isCompacting(events),
                items: transcript(
                  events,
                  snapshot.events.map((x) => x.seq),
                  sessionState === 'running' || sessionState === 'starting',
                ),
                queue: queue?.kind === 'queue' ? queue.messages : [],
                queuePaused: queue?.kind === 'queue' ? !!queue.paused : false,
                goal,
                branch: bindings[0]?.taskBranch ?? '',
              })
            }),
        )
      if (!current()) return
      void read('activity.status').then(
        (list) => setActivity((a) => ({ ...a, [id]: list })),
        () => {},
      )
      loadDefaults(id)
      void read('notices.list').then(
        (list) => setInbox((i) => ({ ...i, [id]: list })),
        () => {},
      )
      change((s) => ({
        ...s,
        projects: [...s.projects.filter((p) => p.computerId !== id), ...projectViews],
        chats: [
          ...s.chats.filter(
            (c) => c.computerId !== id || (c.pending && !chats.some((next) => c.taskId && next.taskId === c.taskId)),
          ),
          // A read that finished late never brings back a state the host has since moved past: of two reads of the same
          // thread, the one with the newer `snapshotAt` stays (an older host sends none, so its read always replaces).
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
  const deliver = async (item: OutboxItem) => {
    const chat = ref.current.chats.find((c) => c.id === item.chatId)
    if (!chat) throw new Error('Thread not found')
    let sessionId = chat.sessionId
    if (item.kind === 'chat') {
      let taskId = chat.taskId
      if (!taskId) {
        const projectId = item.projectId === STANDALONE ? STANDALONE : raw(item.projectId!)
        const repos = projectId === STANDALONE ? [] : await invoke(item.computerId, 'repos.list', projectId)
        const title = item.text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments'
        const task = await createWorkspaceTask(
          workspaceCreation({
            projectId,
            title,
            checkout: item.checkout,
            workspaceId: item.workspaceId,
            branchPrefix: item.branchPrefix,
            branchNaming: item.branchNaming,
            branchChoice: item.branchChoice,
            requestId: item.id,
          }),
          () =>
            invoke(
              item.computerId,
              'tasks.plan',
              projectId,
              title,
              repos.map((r) => r.id),
            ),
          (input, plan) => invoke(item.computerId, 'tasks.create', input, plan),
          item.reviewedPlan,
        )
        taskId = task.id
        // Persist the host task immediately; if agent.start fails, it remains reviewable.
        change((s) => ({
          ...s,
          chats: s.chats.map((c) =>
            c.id === chat.id
              ? { ...c, taskId, workspaceId: task.workspaceId, branchNamingFallback: task.branchNamingFallback }
              : c,
          ),
        }))
      }
      await invoke(item.computerId, 'tasks.setup', taskId)
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
      outbox: s.outbox.map((o) => (o.id === item.id ? { ...o, state: 'accepted', error: undefined } : o)),
      chats: s.chats.map((c) => (c.id === chat.id ? { ...c, sessionId, pending: false } : c)),
    }))
    // Keep the acknowledged bubble until the authoritative message or queue entry is mounted.
    // Finish reconciliation before another identical message takes its history baseline.
    await refresh(item.computerId, true).catch(report)
  }
  const flush = async (id: string) => {
    if (flushing.current.has(id) || ref.current.outbox.some((o) => o.computerId === id && o.state === 'accepted'))
      return
    flushing.current.add(id)
    try {
      while (
        active.current &&
        !connections.current.get(id)?.controller.signal.aborted &&
        ref.current.computers.find((c) => c.id === id)?.status === 'online' &&
        ref.current.computers.find((c) => c.id === id)?.access !== 'viewer'
      ) {
        const item = ref.current.outbox.find((o) => o.computerId === id && o.state !== 'accepted')
        if (!item || item.state === 'uncertain' || item.state === 'sending' || item.state === 'review') break
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
          await writeLocal({
            ...ref.current,
            ready: undefined,
            error: undefined,
            usage: undefined,
            catalogs: undefined,
          })
          if (!active.current || connections.current.get(id)?.controller.signal.aborted) {
            change((s) => ({ ...s, outbox: s.outbox.map((o) => (o.id === item.id ? { ...o, state: 'waiting' } : o)) }))
            break
          }
          await deliver(item)
          if (ref.current.outbox.some((o) => o.computerId === id && o.state === 'accepted')) break
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
    if (!computer?.hostId || !computer.deviceId || !due(`learn:${id}`, 3_600_000)) return
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
    if (result?.state !== 'verified') return
    change((s) => ({ ...s, computers: s.computers.map((c) => (c.id === id ? { ...c, routes: result.routes } : c)) }))
  }

  /** When the saved address stops answering, try the learned ones; each must prove it is this host before it is used. */
  async function tryRoutes(id: string) {
    if (!due(`try:${id}`, 60_000)) return
    for (const route of ref.current.computers.find((c) => c.id === id)?.routes ?? []) {
      if (!active.current || !ref.current.computers.some((c) => c.id === id)) return
      if ((await reviewAddressFor(id, route).catch(() => 'unreachable')) === 'moved') return
    }
  }

  async function reviewAddressFor(id: string, address: string): Promise<ReviewAddressResult> {
    const computer = ref.current.computers.find((c) => c.id === id)
    if (!computer) throw new Error('That host is no longer saved')
    const url = normalizeAddress(address, true)
    if (url === computer.address) return 'unchanged'
    if (!computer.hostId || !computer.deviceId) return 'unsupported'
    // A credential issued over HTTPS never moves to plain HTTP on its own.
    if (computer.address.startsWith('https:') && url.startsWith('http:')) return 'insecure'
    const token = await readToken(id)
    if (!token) return 'unsupported'
    const result = await verifyHost({
      fetch: (target, init) => expoFetch(target, init) as ReturnType<Parameters<typeof verifyHost>[0]['fetch']>,
      baseUrl: url,
      deviceId: computer.deviceId,
      token,
      expectedHostId: computer.hostId,
      challenge: operationKey(),
      signal: AbortSignal.timeout(8000),
    })
    if (result.state !== 'verified') return result.state
    const moved: Computer = { ...computer, address: url, routes: result.routes, status: 'connecting', error: undefined }
    change((s) => ({ ...s, computers: s.computers.map((c) => (c.id === id ? moved : c)) }))
    void connect(moved).catch(report)
    return 'moved'
  }

  const connect = async (computer: Computer, resuming = false) => {
    const old = connections.current.get(computer.id)
    old?.controller.abort()
    old?.client.close()
    connections.current.delete(computer.id)
    const generation = (generations.current.get(computer.id) ?? 0) + 1
    generations.current.set(computer.id, generation)
    if (!active.current) return
    if (!resuming || computer.status !== 'online') status(computer.id, 'connecting')
    const token = await readToken(computer.id)
    if (generations.current.get(computer.id) !== generation || !active.current) return
    if (!token) {
      status(computer.id, 'revoked', 'Missing device credential. Pair again.')
      return
    }
    const connection = {
      client: new HostClient(computer.address, token, expoFetch as typeof globalThis.fetch),
      controller: new AbortController(),
      generation,
    }
    connections.current.set(computer.id, connection)
    let attempt = 0
    while (!connection.controller.signal.aborted && active.current) {
      try {
        const info = await connection.client.invoke('background.status')
        if (!connection.controller.signal.aborted)
          change((s) => ({
            ...s,
            computers: s.computers.map((c) =>
              c.id === computer.id
                ? {
                    ...c,
                    access: info.access ?? c.access,
                    os: info.platform === 'darwin' ? 'macos' : info.platform === 'win32' ? 'windows' : 'linux',
                    ...(c.auto && info.hostname ? { name: info.hostname, auto: false } : {}),
                  }
                : c,
            ),
          }))
        if (info.protocol !== 1 || !info.capabilities?.includes('mobile-companion'))
          throw new HostError('Update Ramu on this host: its protocol is incompatible.', 426)
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
          (channel, payload) => {
            if (connections.current.get(computer.id) === connection && !connection.controller.signal.aborted)
              receive(computer.id, channel, payload)
          },
          async () => {
            if (connection.controller.signal.aborted || connections.current.get(computer.id) !== connection) return
            await refreshing.current.get(computer.id)?.catch(() => {})
            if (connection.controller.signal.aborted || connections.current.get(computer.id) !== connection) return
            await refresh(computer.id, true)
            if (!connection.controller.signal.aborted) {
              attempt = 0
              status(computer.id, 'online')
              void learnRoutes(computer.id)
              if (pushToken.current) void registerPushOn(computer.id).catch(report)
              void flush(computer.id)
            }
          },
          connection.controller.signal,
        )
      } catch (error) {
        if (connection.controller.signal.aborted) break
        if (error instanceof HostError && [401, 426].includes(error.status)) {
          status(computer.id, 'revoked', error.message)
          break
        }
        status(computer.id, 'offline', error instanceof Error ? error.message : 'Host unreachable')
        void tryRoutes(computer.id)
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer)
            connection.controller.signal.removeEventListener('abort', done)
            resolve()
          }
          const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** attempt++) + Math.random() * 500)
          connection.controller.signal.addEventListener('abort', done, { once: true })
        })
      }
    }
  }
  useEffect(() => {
    active.current = AppState.currentState !== 'background'
    for (const computer of ref.current.computers)
      if (computer.status !== 'revoked') void connect(computer).catch(report)
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
          if (computer.status !== 'revoked') void connect(computer, true).catch(report)
    })
    const poll = setInterval(() => {
      if (active.current)
        for (const computer of ref.current.computers)
          if (computer.status === 'online') void refresh(computer.id, true).catch(report)
    }, 20_000)
    return () => {
      app.remove()
      clearInterval(poll)
      for (const timer of [...changeTimers.current.values(), ...rebuilds.current.values()]) clearTimeout(timer)
      changeTimers.current.clear()
      rebuilds.current.clear()
      active.current = false
      for (const connection of connections.current.values()) {
        connection.controller.abort()
        connection.client.close()
      }
    }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => {
      void writeLocal({
        computers: ref.current.computers,
        projects: ref.current.projects,
        chats: ref.current.chats,
        selected: ref.current.selected,
        language: ref.current.language,
        outbox: ref.current.outbox,
        drafts: ref.current.drafts,
      })
        .then(clearSaveError)
        .catch((error) =>
          report(new Error(`Could not save phone data. ${error instanceof Error ? error.message : String(error)}`)),
        )
    }, 250)
    return () => clearTimeout(timer)
  }, [state.computers, state.projects, state.chats, state.selected, state.language, state.outbox, state.drafts])
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
    missingMethods,
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
        // The host's own id says which computer this is, so pairing it again at a new address keeps its entry (and the
        // drafts, unread state and queued messages keyed to it). The address decides only for a host without an id.
        const known =
          (typeof result.hostId === 'string'
            ? ref.current.computers.find((c) => c.hostId === result.hostId)
            : undefined) ?? ref.current.computers.find((c) => c.address === url)
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
      } finally {
        clearTimeout(timer)
      }
    },
    reviewAddress: reviewAddressFor,
    forget: async (id) => {
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
      changesSupported.current.delete(id)
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
      const options = await invoke(item.computerId, 'tasks.workspaceOptions', projectId)
      if (!options.branchNameControls) throw new Error('Update this host to review worktree base commits.')
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
    decide: (id, request, decision) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.replyPermission', session, request, decision === 'allow')),
    elicitation: (id, request, action, answers) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.replyElicitation', session, request, action, answers)),
    removeQueued: (id, message) =>
      sessionAction(id, (pc, session) => invoke(pc, 'agent.removeQueued', session, message)),
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
      try {
        await invoke(chat.computerId, GOAL_VERIFY_METHOD, chat.sessionId, command)
      } catch (error) {
        if (isMethodMissing(error))
          setMissingMethods((m) => ({ ...m, [chat.computerId]: [...(m[chat.computerId] ?? []), GOAL_VERIFY_METHOD] }))
        throw error
      }
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
      // Only these three come from the caller; a full settings object here once carried the old model back in.
      const options = extra
        ? {
            access: extra.access,
            autoFallback: extra.autoFallback,
            ...(extra.serviceTier ? { serviceTier: extra.serviceTier } : {}),
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
