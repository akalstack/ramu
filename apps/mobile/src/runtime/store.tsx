import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import { fetch as expoFetch } from 'expo/fetch'
import type { PushEvents, RamuMethods } from '@ramu/shared/api'
import type { AgentEvent, AgentProvider, AgentSettings, FileContext, ProviderCatalog, UsageReading } from '@ramu/shared/types'
import { deleteToken, readLocal, readToken, saveToken, writeLocal } from '../storage'
import { HostClient, HostError, normalizeAddress } from './transport'
import { transcript } from './transcript'
import { STANDALONE, type Chat, type Computer, type MobileProject } from './types'

export type Language = 'en' | 'id'
export interface OutboxItem { id: string; computerId: string; chatId: string; kind: 'message' | 'chat'; text: string; mode: 'send' | 'queue' | 'steer'; createdAt: number; state?: 'waiting' | 'sending' | 'uncertain'; error?: string; settings?: AgentSettings; projectId?: string; checkout?: 'current' | 'worktree'; attachments?: string[]; context?: FileContext[] }
interface State { computers: Computer[]; projects: MobileProject[]; chats: Chat[]; selected: string; language: Language; outbox: OutboxItem[]; drafts: Record<string, string>; usage: Record<string, UsageReading[]>; catalogs: Record<string, ProviderCatalog[]>; ready: boolean; error: string | null }
interface Store extends State {
  resolveChat(computerId: string, taskId: string): string
  select(id: string): void
  setLanguage(language: Language): void
  pair(name: string, address: string, code: string, allowHttp: boolean): Promise<string>
  forget(id: string): Promise<void>
  retry(id: string): void
  invoke<M extends keyof RamuMethods>(computerId: string, method: M, ...args: Parameters<RamuMethods[M]>): Promise<Awaited<ReturnType<RamuMethods[M]>>>
  subscribe(computerId: string, listener: (channel: keyof PushEvents, payload: any) => void): () => void
  refresh(computerId: string): Promise<void>
  send(id: string, text: string, mode: 'send' | 'queue' | 'steer', attachments?: string[], context?: FileContext[]): Promise<void>
  createChat(input: { projectId: string; text: string; provider: AgentProvider; model: string; effort: string; mode: 'current' | 'worktree'; attachments?: string[]; settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier'>; context?: FileContext[] }): Promise<string>
  cancelOutbox(id: string): string | undefined
  stop(id: string): void
  answer(id: string, request: string, answers: Record<string, string>): void
  decide(id: string, request: string, decision: 'allow' | 'deny'): void
  elicitation(id: string, request: string, action: 'accept' | 'decline' | 'cancel', answers: Record<string, string>): void
  toggleGoal(id: string): void
  clearGoal(id: string): void
  removeQueued(id: string, message: string): void
  setModel(id: string, provider: AgentProvider, model: string, effort: string, settings?: Pick<AgentSettings, 'access' | 'autoFallback' | 'serviceTier'>): void
  isOnline(id: string): boolean
  setDraft(key: string, text: string): void
  dismissError(): void
  enablePush(): Promise<void>
  disablePush(): Promise<void>
  notifications: { computerId: string; chatId: string; title: string; body: string }[]
  dismissNotification(index: number): void
}
const Context = createContext<Store | null>(null)
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
export const scoped = (computer: string, id: string) => `${computer}:${id}`
const raw = (id: string) => id.slice(id.indexOf(':') + 1)
const defaults: State = { computers: [], projects: [], chats: [], selected: '', language: 'en', outbox: [], drafts: {}, usage: {}, catalogs: {}, ready: false, error: null }
const settingsFor = (provider: AgentProvider, model: string, effort: string): AgentSettings => ({ provider, model, effort: (effort || null) as AgentSettings['effort'], access: 'auto', autoFallback: true })

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(() => {
    const saved = readLocal(defaults)
    return { ...defaults, ...saved, ready: false, computers: saved.computers.map(c => ({ ...c, status: c.status === 'revoked' ? 'revoked' : 'connecting' })), outbox: saved.outbox.map(o => o.state === 'sending' ? { ...o, state: 'uncertain', error: 'App closed during delivery. Check the host before retrying.' } : o) }
  })
  const ref = useRef(state); ref.current = state
  const connections = useRef(new Map<string, { client: HostClient; controller: AbortController; generation: number }>())
  const generations = useRef(new Map<string, number>())
  const eventRows = useRef(new Map<string, Map<number, AgentEvent>>())
  const listeners = useRef(new Map<string, Set<(channel: keyof PushEvents, payload: any) => void>>())
  const refreshing = useRef(new Map<string, Promise<void>>())
  const buffers = useRef(new Map<string, PushEvents['agent:event'][] >())
  const flushing = useRef(new Set<string>())
  const active = useRef(AppState.currentState !== 'background')
  const pushToken = useRef<string | null>(null)
  const [notifications, setNotifications] = useState<Store['notifications']>([])
  const change = (fn: (s: State) => State) => { const next = fn(ref.current); ref.current = next; setState(next) }
  const report = (error: unknown) => change(s => ({ ...s, error: error instanceof Error ? error.message : String(error) }))
  const status = (id: string, value: Computer['status'], error?: string) => change(s => ({ ...s, computers: s.computers.map(c => c.id === id ? { ...c, status: value, error, lastSeen: value === 'online' ? Date.now() : c.lastSeen } : c) }))
  async function invoke<M extends keyof RamuMethods>(id: string, method: M, ...args: Parameters<RamuMethods[M]>): Promise<Awaited<ReturnType<RamuMethods[M]>>> {
    const connection = connections.current.get(id)
    if (!connection || connection.controller.signal.aborted) throw new HostError('This computer is offline. Reconnect before taking this action.')
    try { return await connection.client.invoke(method, ...args) }
    catch (error) { if (error instanceof HostError && error.status === 401) { connection.controller.abort(); connection.client.close(); status(id, 'revoked', error.message) }; throw error }
  }
  const applyEvent = (computerId: string, payload: PushEvents['agent:event']) => {
    const key = scoped(computerId, payload.sessionId)
    const rows = eventRows.current.get(key)
    if (!rows) return
    if (payload.seq != null) rows.set(payload.seq, payload.event)
    const events = [...rows.entries()].sort((a, b) => a[0] - b[0]).map(x => x[1])
    change(s => ({ ...s, chats: s.chats.map(chat => {
      if (chat.computerId !== computerId || chat.sessionId !== payload.sessionId) return chat
      const e = payload.event
      return { ...chat, items: transcript(events), preview: e.kind === 'text' ? e.text.slice(-140) : chat.preview, status: e.kind === 'state' ? e.state === 'running' || e.state === 'starting' ? 'running' : e.state === 'needs-input' ? 'needs-input' : e.state === 'failed' ? 'failed' : 'idle' : chat.status, queue: e.kind === 'queue' ? e.messages : chat.queue, goal: e.kind === 'goal' ? e.goal : chat.goal, ...(e.kind === 'settings' ? { provider: e.settings.provider, model: e.settings.model, effort: e.settings.effort ?? '', settings: e.settings } : {}) }
    }) }))
  }
  const receive = (id: string, channel: keyof PushEvents, payload: any) => {
    if (channel === 'agent:event') {
      if (buffers.current.has(id)) buffers.current.get(id)!.push(payload)
      else { applyEvent(id, payload); if (!eventRows.current.has(scoped(id, payload.sessionId))) void refresh(id).catch(report) }
      const chat = ref.current.chats.find(c => c.computerId === id && c.sessionId === payload.sessionId)
      const e = payload.event as AgentEvent
      const notify = chat && ((e.kind === 'state' && ['idle', 'failed', 'needs-input'].includes(e.state)) || e.kind === 'question' || (e.kind === 'goal' && e.goal?.status === 'blocked'))
      if (notify) setNotifications(n => [...n.filter(x => !(x.computerId === id && x.chatId === chat.id)), { computerId: id, chatId: chat.id, title: chat.title, body: e.kind === 'state' && e.state === 'idle' ? 'Finished' : e.kind === 'state' && e.state === 'failed' ? 'Stopped with an error' : 'Needs your input' }].slice(-30))
    } else if (channel === 'usage:changed') change(s => ({ ...s, usage: { ...s.usage, [id]: payload } }))
    else if (channel === 'notify:inapp') {
      const chatId = ref.current.chats.find(c => c.computerId === id && c.taskId === payload.taskId)?.id ?? scoped(id, payload.taskId)
      setNotifications(n => [...n.filter(x => !(x.computerId === id && x.chatId === chatId)), { computerId: id, chatId, title: payload.title, body: payload.body }].slice(-30))
    }
    for (const listener of listeners.current.get(id) ?? []) listener(channel, payload)
  }
  const refresh = (id: string): Promise<void> => {
    if (refreshing.current.has(id)) return refreshing.current.get(id)!
    const connection = connections.current.get(id)
    if (!connection) return Promise.resolve()
    const current = () => connections.current.get(id) === connection && !connection.controller.signal.aborted
    buffers.current.set(id, [])
    const promise = (async () => {
      const [projects, tasks, catalogs, usage] = await Promise.all([invoke(id, 'projects.list'), invoke(id, 'tasks.list'), invoke(id, 'agent.catalog'), invoke(id, 'usage.get')])
      const projectViews = await Promise.all(projects.map(async p => { const repos = await invoke(id, 'repos.list', p.id); return { ...p, id: scoped(id, p.id), computerId: id, kind: repos.length === 1 ? 'repo' as const : 'workspace' as const, repos: repos.map(r => r.name) } }))
      const revisions = new Map<string, number>()
      const chats: Chat[] = []
      // Bound concurrency for large workspaces and many saved computers.
      for (let index = 0; index < tasks.length; index += 6) await Promise.all(tasks.slice(index, index + 6).filter(t => t.status !== 'archived').map(async task => {
        const sessions = await invoke(id, 'agent.list', task.id)
        const session = sessions.filter(s => !s.parentId).sort((a,b) => b.createdAt - a.createdAt)[0]
        const [snapshot, bindings, goal] = await Promise.all([session ? invoke(id, 'agent.snapshot', session.id) : Promise.resolve({ revision: 0, events: [] }), invoke(id, 'tasks.bindings', task.id), session ? invoke(id, 'agent.goal', session.id) : Promise.resolve(null)])
        if (!current()) return
        const events = snapshot.events.map(x => x.event)
        if (session) { eventRows.current.set(scoped(id, session.id), new Map(snapshot.events.map(x => [x.seq, x.event]))); revisions.set(session.id, snapshot.revision) }
        const queue = [...events].reverse().find(e => e.kind === 'queue')
        const text = [...events].reverse().find(e => e.kind === 'text' || e.kind === 'user')
        const latestState = [...events].reverse().find(e => e.kind === 'state')
        const sessionState = latestState?.kind === 'state' ? latestState.state : session?.state
        chats.push({ ...task, id: ref.current.chats.find(c => c.computerId === id && c.taskId === task.id)?.id ?? scoped(id, task.id), taskId: task.id, sessionId: session?.id ?? null, projectId: task.projectId === STANDALONE ? STANDALONE : scoped(id, task.projectId), computerId: id, provider: session?.provider ?? 'claude-code', model: session?.settings.model ?? '', effort: session?.settings.effort ?? '', settings: session?.settings, preview: text && 'text' in text ? text.text.slice(-140) : '', status: sessionState === 'running' || sessionState === 'starting' ? 'running' : sessionState === 'needs-input' ? 'needs-input' : sessionState === 'failed' ? 'failed' : task.status === 'archived' ? 'archived' : 'idle', items: transcript(events), queue: queue?.kind === 'queue' ? queue.messages : [], goal, branch: bindings[0]?.taskBranch ?? '' })
      }))
      if (!current()) return
      change(s => ({ ...s, projects: [...s.projects.filter(p => p.computerId !== id), ...projectViews], chats: [...s.chats.filter(c => c.computerId !== id || c.pending && !chats.some(next => c.taskId && next.taskId === c.taskId)), ...chats], catalogs: { ...s.catalogs, [id]: catalogs }, usage: { ...s.usage, [id]: usage } }))
      for (const payload of buffers.current.get(id) ?? []) if (payload.revision == null || payload.revision > (revisions.get(payload.sessionId) ?? 0)) applyEvent(id, payload)
    })().finally(() => { if (refreshing.current.get(id) === promise) { refreshing.current.delete(id); buffers.current.delete(id) } })
    refreshing.current.set(id, promise)
    return promise
  }
  const deliver = async (item: OutboxItem) => {
    const chat = ref.current.chats.find(c => c.id === item.chatId)
    if (!chat) throw new Error('Chat not found')
    let sessionId = chat.sessionId
    if (item.kind === 'chat') {
      let taskId = chat.taskId
      if (!taskId) {
        const projectId = item.projectId === STANDALONE ? STANDALONE : raw(item.projectId!)
        const repos = projectId === STANDALONE ? [] : await invoke(item.computerId, 'repos.list', projectId)
        const title = item.text.split('\n')[0]!.slice(0, 60) || 'Discuss attachments'
        const plan = item.checkout === 'worktree' ? await invoke(item.computerId, 'tasks.plan', projectId, title, repos.map(r => r.id)) : undefined
        const task = await invoke(item.computerId, 'tasks.create', { projectId, title, mode: item.checkout ?? 'current' }, plan)
        taskId = task.id
        // Persist the host task immediately; if agent.start fails, it remains reviewable.
        change(s => ({ ...s, chats: s.chats.map(c => c.id === chat.id ? { ...c, taskId } : c) }))
      }
      await invoke(item.computerId, 'tasks.setup', taskId)
      const session = await invoke(item.computerId, 'agent.start', taskId, item.text, item.settings, item.attachments, item.context)
      sessionId = session.id
      change(s => ({ ...s, chats: s.chats.map(c => c.id === chat.id ? { ...c, taskId, sessionId, pending: false } : c) }))
    } else if (!sessionId) {
      const session = await invoke(item.computerId, 'agent.start', chat.taskId, item.text, chat.settings ?? settingsFor(chat.provider, chat.model, chat.effort), item.attachments, item.context)
      sessionId = session.id
    } else {
      // submit handles idle chats too and preserves attachments; the host decides queue/steer semantics.
      await invoke(item.computerId, 'agent.submit', sessionId, item.text, item.mode === 'steer' ? 'steer' : 'queue', item.attachments, item.context)
    }
    change(s => ({ ...s, outbox: s.outbox.filter(o => o.id !== item.id), chats: s.chats.map(c => c.id === chat.id ? { ...c, sessionId, pending: false } : c) }))
    await refresh(item.computerId)
  }
  const flush = async (id: string) => {
    if (flushing.current.has(id)) return
    flushing.current.add(id)
    try {
      while (ref.current.computers.find(c => c.id === id)?.status === 'online') {
        const item = ref.current.outbox.find(o => o.computerId === id)
        if (!item || item.state === 'uncertain' || item.state === 'sending') break
        change(s => ({ ...s, outbox: s.outbox.map(o => o.id === item.id ? { ...o, state: 'sending' } : o) }))
        try { writeLocal({ ...ref.current, ready: undefined, error: undefined, usage: undefined, catalogs: undefined }); await deliver(item) }
        catch (error) {
          change(s => ({ ...s, outbox: s.outbox.map(o => o.id === item.id ? { ...o, state: 'uncertain', error: error instanceof Error ? error.message : String(error) } : o) }))
          report(error); break
        }
      }
    } finally { flushing.current.delete(id) }
  }
  const connect = async (computer: Computer) => {
    const old = connections.current.get(computer.id); old?.controller.abort(); old?.client.close()
    connections.current.delete(computer.id)
    const generation = (generations.current.get(computer.id) ?? 0) + 1; generations.current.set(computer.id, generation)
    if (!active.current) return
    status(computer.id, 'connecting')
    const token = await readToken(computer.id)
    if (generations.current.get(computer.id) !== generation || !active.current) return
    if (!token) { status(computer.id, 'revoked', 'Missing device credential. Pair again.'); return }
    const connection = { client: new HostClient(computer.address, token, expoFetch as typeof globalThis.fetch), controller: new AbortController(), generation }
    connections.current.set(computer.id, connection)
    let attempt = 0
    while (!connection.controller.signal.aborted && active.current) {
      try {
        const info = await connection.client.invoke('background.status')
        if (!connection.controller.signal.aborted) change(s => ({ ...s, computers: s.computers.map(c => c.id === computer.id ? { ...c, os: info.platform === 'darwin' ? 'macos' : info.platform === 'win32' ? 'windows' : 'linux' } : c) }))
        if (info.protocol !== 1 || !info.capabilities?.includes('mobile-companion')) throw new HostError('Update Ramu on this computer: its protocol is incompatible.', 426)
        await connection.client.stream((channel, payload) => { if (connections.current.get(computer.id) === connection) receive(computer.id, channel, payload) }, async () => { await refreshing.current.get(computer.id)?.catch(() => {}); await refresh(computer.id); if (!connection.controller.signal.aborted) { attempt = 0; status(computer.id, 'online'); if (pushToken.current) void invoke(computer.id, 'notifications.register', pushToken.current, computer.id).catch(report); void flush(computer.id) } }, connection.controller.signal)
      } catch (error) {
        if (connection.controller.signal.aborted) break
        if (error instanceof HostError && [401, 426].includes(error.status)) { status(computer.id, 'revoked', error.message); break }
        status(computer.id, 'offline', error instanceof Error ? error.message : 'Computer unreachable')
        await new Promise<void>(resolve => { const done = () => { clearTimeout(timer); connection.controller.signal.removeEventListener('abort', done); resolve() }; const timer = setTimeout(done, Math.min(30_000, 1000 * 2 ** attempt++) + Math.random() * 500); connection.controller.signal.addEventListener('abort', done, { once: true }) })
      }
    }
  }
  useEffect(() => {
    for (const computer of ref.current.computers) if (computer.status !== 'revoked') void connect(computer).catch(report)
    change(s => ({ ...s, ready: true }))
    if (ref.current.drafts['push-enabled'] === 'yes') void import('./push').then(module => module.registerPush()).then(token => { pushToken.current = token; for (const c of ref.current.computers) if (c.status === 'online') void invoke(c.id, 'notifications.register', token, c.id).catch(report) }).catch(report)
    const app = AppState.addEventListener('change', next => {
      const foreground = next === 'active'
      if (foreground === active.current) return
      active.current = foreground
      if (!foreground) { try { writeLocal({ ...ref.current, usage: undefined, catalogs: undefined, ready: undefined, error: undefined }) } catch { report(new Error('Could not save phone data.')) } }
      if (!foreground) for (const [id, connection] of connections.current) { generations.current.set(id, connection.generation + 1); connection.controller.abort(); connection.client.close(); status(id, 'offline') }
      else for (const computer of ref.current.computers) if (computer.status !== 'revoked') void connect(computer).catch(report)
    })
    const poll = setInterval(() => { if (active.current) for (const computer of ref.current.computers) if (computer.status === 'online') void refresh(computer.id).catch(report) }, 20_000)
    return () => { app.remove(); clearInterval(poll); active.current = false; for (const connection of connections.current.values()) { connection.controller.abort(); connection.client.close() } }
  }, [])
  useEffect(() => {
    const timer = setTimeout(() => { try { writeLocal({ computers: ref.current.computers, projects: ref.current.projects, chats: ref.current.chats, selected: ref.current.selected, language: ref.current.language, outbox: ref.current.outbox, drafts: ref.current.drafts }) } catch { report(new Error('Could not save phone data. Check available storage.')) } }, 250)
    return () => clearTimeout(timer)
  }, [state.computers, state.projects, state.chats, state.selected, state.language, state.outbox, state.drafts])
  const sessionAction = (id: string, fn: (computer: string, session: string) => Promise<unknown>) => {
    const chat = ref.current.chats.find(c => c.id === id)
    if (chat?.sessionId) void fn(chat.computerId, chat.sessionId).then(() => refresh(chat.computerId)).catch(report)
  }
  const store: Store = {
    ...state, notifications, invoke, refresh,
    enablePush: async () => {
      const { registerPush } = await import('./push')
      const token = await registerPush()
      pushToken.current = token
      change(s => ({ ...s, drafts: { ...s.drafts, 'push-enabled': 'yes' } }))
      await Promise.all(ref.current.computers.filter(c => c.status === 'online').map(c => invoke(c.id, 'notifications.register', token, c.id)))
    },
    disablePush: async () => {
      if (ref.current.computers.some(c => c.status !== 'online')) throw new Error('Reconnect every computer before disabling push so each registration can be removed.')
      await Promise.all(ref.current.computers.map(c => invoke(c.id, 'notifications.unregister')))
      pushToken.current = null; change(s => ({ ...s, drafts: { ...s.drafts, 'push-enabled': '' } }))
    },
    resolveChat: (computerId, taskId) => ref.current.chats.find(c => c.computerId === computerId && c.taskId === taskId)?.id ?? scoped(computerId, taskId),
    select: selected => change(s => ({ ...s, selected })),
    setLanguage: language => change(s => ({ ...s, language })),
    pair: async (name, address, code, allowHttp) => {
      const url = normalizeAddress(address, allowHttp)
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15_000)
      try {
        const response = await expoFetch(`${url}/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-ramu-protocol': '1' }, body: JSON.stringify({ name: name || 'Ramu phone', code }), signal: controller.signal })
        const result = await response.json().catch(() => ({}))
        if (response.status === 429) throw new Error('Too many pairing attempts. Wait a minute, then use a fresh code from the host.')
        if (!response.ok || !result.token || !result.deviceId) throw new Error(result.error || `Pairing failed (${response.status})`)
        const id = ref.current.computers.find(c => c.address === url)?.id ?? uid(); await saveToken(id, result.token)
        const computer: Computer = { id, name: name || new URL(url).hostname, address: url, os: 'linux', status: 'connecting', lastSeen: 0 }
        change(s => ({ ...s, selected: id, computers: [...s.computers.filter(c => c.id !== id), computer] }))
        void connect(computer).catch(report)
        return id
      } finally { clearTimeout(timer) }
    },
    forget: async id => {
      await invoke(id, 'notifications.unregister').catch(() => {})
      generations.current.set(id, (generations.current.get(id) ?? 0) + 1)
      const connection = connections.current.get(id); connection?.controller.abort(); connection?.client.close(); connections.current.delete(id)
      await deleteToken(id)
      for (const key of eventRows.current.keys()) if (key.startsWith(`${id}:`)) eventRows.current.delete(key)
      listeners.current.delete(id); buffers.current.delete(id)
      setNotifications(n => n.filter(x => x.computerId !== id))
      change(s => { const computers = s.computers.filter(c => c.id !== id); return { ...s, computers, selected: s.selected === id ? computers[0]?.id ?? '' : s.selected, projects: s.projects.filter(p => p.computerId !== id), chats: s.chats.filter(c => c.computerId !== id), outbox: s.outbox.filter(o => o.computerId !== id), drafts: Object.fromEntries(Object.entries(s.drafts).filter(([key]) => !key.startsWith(`${id}:`))), usage: Object.fromEntries(Object.entries(s.usage).filter(([key]) => key !== id)), catalogs: Object.fromEntries(Object.entries(s.catalogs).filter(([key]) => key !== id)) } })
    },
    retry: id => { const computer = ref.current.computers.find(c => c.id === id); if (computer) void connect(computer).catch(report) },
    subscribe: (id, listener) => { const set = listeners.current.get(id) ?? new Set(); set.add(listener); listeners.current.set(id, set); return () => { set.delete(listener) } },
    isOnline: id => ref.current.computers.find(c => c.id === id)?.status === 'online',
    send: async (id, text, mode, attachments, context) => {
      const chat = ref.current.chats.find(c => c.id === id); if (!chat) throw new Error('Chat not found')
      if (ref.current.computers.find(c => c.id === chat.computerId)?.status === 'revoked') throw new Error('Pair this computer again before sending.')
      const item: OutboxItem = { id: uid(), chatId: id, computerId: chat.computerId, kind: 'message', text, mode, createdAt: Date.now(), attachments, context, state: 'waiting' }
      change(s => ({ ...s, outbox: [...s.outbox, item] }))
      void flush(chat.computerId)
    },
    createChat: async input => {
      const computerId = ref.current.selected
      if (!computerId || ref.current.computers.find(c => c.id === computerId)?.status === 'revoked') throw new Error('Pair a computer first.')
      const id = scoped(computerId, `pending-${uid()}`)
      const chat: Chat = { id, taskId: '', sessionId: null, computerId, projectId: input.projectId, title: input.text.slice(0, 60) || 'Discuss attachments', mode: input.mode, workspaceId: null, status: 'idle', createdAt: Date.now(), pinnedAt: null, lastActiveAt: Date.now(), provider: input.provider, model: input.model, effort: input.effort, settings: { ...settingsFor(input.provider, input.model, input.effort), ...input.settings }, preview: 'Waiting to send', items: [], queue: [], goal: null, branch: '', pending: true }
      const item: OutboxItem = { id: uid(), chatId: id, computerId, kind: 'chat', text: input.text, mode: 'send', createdAt: Date.now(), projectId: input.projectId, checkout: input.mode, settings: { ...settingsFor(input.provider, input.model, input.effort), ...input.settings }, attachments: input.attachments, context: input.context, state: 'waiting' }
      change(s => ({ ...s, chats: [chat, ...s.chats], outbox: [...s.outbox, item] })); void flush(computerId)
      return id
    },
    cancelOutbox: id => { const item = ref.current.outbox.find(o => o.id === id); if (!item || item.state === 'sending') return; change(s => ({ ...s, outbox: s.outbox.filter(o => o.id !== id), chats: item.kind === 'chat' && !s.chats.find(c => c.id === item.chatId)?.taskId ? s.chats.filter(c => c.id !== item.chatId) : s.chats })); return item.text },
    stop: id => sessionAction(id, (pc, session) => invoke(pc, 'agent.stop', session)),
    answer: (id, request, answers) => sessionAction(id, (pc, session) => answers._ === 'Dismissed' ? invoke(pc, 'agent.dismissQuestion', session, request) : invoke(pc, 'agent.replyQuestion', session, request, answers)),
    decide: (id, request, decision) => sessionAction(id, (pc, session) => invoke(pc, 'agent.replyPermission', session, request, decision === 'allow')),
    elicitation: (id, request, action, answers) => sessionAction(id, (pc, session) => invoke(pc, 'agent.replyElicitation', session, request, action, answers)),
    removeQueued: (id, message) => sessionAction(id, (pc, session) => invoke(pc, 'agent.removeQueued', session, message)),
    toggleGoal: id => sessionAction(id, (pc, session) => invoke(pc, 'agent.goal.control', session, ref.current.chats.find(c => c.id === id)?.goal?.status === 'paused' ? 'resume' : 'pause')),
    clearGoal: id => sessionAction(id, (pc, session) => invoke(pc, 'agent.goal.control', session, 'clear')),
    setModel: (id, provider, model, effort, options) => {
      const chat = ref.current.chats.find(c => c.id === id)
      if (!chat) return
      if (!chat.sessionId) { const settings = { ...settingsFor(provider, model, effort), ...options }; change(s => ({ ...s, chats: s.chats.map(c => c.id === id ? { ...c, provider, model, effort, settings } : c), outbox: s.outbox.map(o => o.chatId === id && o.kind === 'chat' ? { ...o, settings } : o) })); return }
      sessionAction(id, (pc, session) => invoke(pc, 'agent.get', session).then(info => invoke(pc, 'agent.configure', session, { ...info.settings, provider, model, effort: (effort || null) as AgentSettings['effort'], ...options })))
    },
    setDraft: (key, text) => change(s => ({ ...s, drafts: { ...s.drafts, [key]: text } })),
    dismissError: () => change(s => ({ ...s, error: null })),
    dismissNotification: index => setNotifications(n => n.filter((_, i) => i !== index)),
  }
  return <Context.Provider value={store}>{children}</Context.Provider>
}
export function useStore() { const store = useContext(Context); if (!store) throw new Error('StoreProvider missing'); return store }
export function useChat(id?: string) { return useStore().chats.find(c => c.id === id) }
export function counts(chats: Chat[], computerId: string) { const mine = chats.filter(c => c.computerId === computerId && !c.pending); return { running: mine.filter(c => c.status === 'running').length, waiting: mine.filter(c => c.status === 'needs-input').length } }
