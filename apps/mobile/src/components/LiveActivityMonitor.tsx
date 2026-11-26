import { useEffect, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { LiveActivity } from 'expo-widgets'
import type { MobileLiveActivityContent } from '@ramu/shared/api'
import {
  LIVE_ACTIVITY_DONE_MS,
  LIVE_ACTIVITY_STALE_MS,
  liveActivityContent,
  liveActivityOrder,
} from '@ramu/shared/liveActivity'
import { useStore } from '../runtime/store'
import { liveActivityStep, liveActivityThreads } from '../runtime/liveActivity'
import { isThreadViewed, onThreadViewed } from '../runtime/threadViewing'

type Activity = LiveActivity<MobileLiveActivityContent>
type Current = {
  instance: Activity
  computerId: string
  startedAt: number
  remote: boolean
  token?: string
  registrationKey?: string
  registrationAt?: number
  registering?: boolean
  subscription?: { remove(): void }
  content?: MobileLiveActivityContent
}

/** The activity that showed finished work and stays on the Lock Screen a few minutes, with the threads it named. */
type Ending = { instance: Activity; computerId: string; sessions: Set<string> }

/**
 * One user-controllable ActivityKit activity for the selected computer's ongoing work. It starts when a thread there
 * starts working or needs the person, follows every thread of that stretch, shows them finished when nothing runs or
 * waits, and leaves a few minutes later, or at once when the person opens the thread that finished.
 */
export function LiveActivityMonitor() {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const current = useRef<Current | null>(null)
  const foreground = useRef(AppState.currentState === 'active')
  /** Set for the one update made as Ramu leaves the foreground, so the activity keeps its latest state. */
  const leaving = useRef(false)
  /** The threads of the current stretch of work, so finished ones are still shown as done. */
  const followed = useRef(new Set<string>())
  const ending = useRef<Ending | null>(null)
  const factory = useRef<Promise<typeof import('../activities/WorkActivity')> | null>(null)
  const busy = useRef(false),
    pending = useRef(false),
    recovered = useRef(false),
    suppressed = useRef<string | null>(null)
  const syncRef = useRef<() => void>(() => {})
  const startKey = useRef('')
  const enabled = store.drafts['live-activities-enabled'] !== 'no'
  const pc = store.computers.find((c) => c.id === store.selected)
  const chats = store.chats.filter((c) => c.computerId === store.selected && c.status !== 'archived')
  // Changes whenever a thread of the stretch changes state or title, which is when the activity has something new.
  const shown = liveActivityThreads(chats, followed.current)
    .map((t) => `${t.id}:${t.status}:${t.title}`)
    .join('\n')
  // iOS reports point releases like "17.5.1", which Number() reads as NaN, so only major.minor is compared.
  const available =
    Platform.OS === 'ios' &&
    Number(String(Platform.Version).split('.').slice(0, 2).join('.')) >= 16.2 &&
    !!requireOptionalNativeModule('ExpoWidgets')
  const persist = (value: Current | null) =>
    latest.current.setDraft(
      'live-activity-meta',
      value ? JSON.stringify({ computerId: value.computerId, startedAt: value.startedAt, remote: value.remote }) : '',
    )
  const suppress = (scope: string | null) => {
    const changed = suppressed.current !== scope
    suppressed.current = scope
    latest.current.setDraft('live-activity-dismissed-scope', scope ?? '')
    // A dismissed activity also stops the host starting one, and showing it again lets the host start it again.
    if (changed) syncRef.current()
  }
  const registerToken = async (value: Current, token: string) => {
    if (current.current !== value || latest.current.drafts['live-activities-enabled'] === 'no') return
    value.token = token
    const key = `${token}:${latest.current.language}`
    if (
      value.registering ||
      (value.registrationKey === key && (value.remote || Date.now() - (value.registrationAt ?? 0) < 60_000))
    )
      return
    value.registering = true
    value.registrationKey = key
    value.registrationAt = Date.now()
    try {
      const reply = await latest.current.invoke(value.computerId, 'liveActivity.register', {
        activityId: value.instance.getId(),
        token,
        computerId: value.computerId,
        startedAt: value.startedAt,
        locale: latest.current.language,
        environment: __DEV__ ? 'sandbox' : 'production',
      })
      if (current.current === value) {
        const changed = value.remote !== reply.enabled
        value.remote = reply.enabled
        persist(value)
        if (changed) syncRef.current()
      } else
        void latest.current.invoke(value.computerId, 'liveActivity.unregister', value.instance.getId()).catch(() => {})
    } catch {
      /* Older/unconfigured hosts still get explicitly stale local activities. */
    } finally {
      value.registering = false
    }
  }
  /** Ends the activity at once: its host is no longer followed, Live Activities are off, or there is nothing to show. */
  const stop = async () => {
    const value = current.current
    current.current = null
    followed.current = new Set()
    if (!value) return
    value.subscription?.remove()
    void latest.current.invoke(value.computerId, 'liveActivity.unregister', value.instance.getId()).catch(() => {})
    await value.instance.end('immediate').catch(() => {})
    persist(null)
  }
  /** Shows the stretch's work as finished, then lets iOS take it away a few minutes later. */
  const finish = async (content: MobileLiveActivityContent, sessions: Set<string>) => {
    const value = current.current
    current.current = null
    followed.current = new Set()
    if (!value) return
    value.subscription?.remove()
    void latest.current.invoke(value.computerId, 'liveActivity.unregister', value.instance.getId()).catch(() => {})
    const module = await import('expo-widgets')
    await value.instance.end(module.after(new Date(Date.now() + LIVE_ACTIVITY_DONE_MS)), content).catch(() => {})
    ending.current = { instance: value.instance, computerId: value.computerId, sessions }
    persist(null)
  }
  /** Takes the finished activity away once the person has seen what it reported, or new work starts another. */
  const dismissEnding = () => {
    const value = ending.current
    ending.current = null
    void value?.instance.end('immediate').catch(() => {})
  }
  /**
   * Hands the phone's push-to-start token to the host it follows, so work there starts the activity while Ramu is
   * closed, and takes it back from a host it no longer follows, when Live Activities are off or the current one was
   * dismissed.
   */
  const syncStart = async () => {
    const state = latest.current
    const token = state.drafts['live-activity-start-token'] || ''
    const want =
      token && state.drafts['live-activities-enabled'] !== 'no' && suppressed.current !== state.selected
        ? state.selected
        : ''
    const registered = state.drafts['live-activity-start-host'] || ''
    const key = `${want}:${token}:${state.language}`
    if (startKey.current === key && registered === want) return
    if (registered && registered !== want && state.computers.some((c) => c.id === registered))
      await state.invoke(registered, 'liveActivity.unregisterStart').catch(() => {})
    if (want) {
      const ok = await state
        .invoke(want, 'liveActivity.registerStart', {
          token,
          computerId: want,
          locale: state.language,
          environment: __DEV__ ? 'sandbox' : 'production',
        })
        .then(
          () => true,
          () => false,
        )
      if (!ok) return
    }
    startKey.current = key
    state.setDraft('live-activity-start-host', want)
  }
  const synchronize = async () => {
    let state = latest.current
    if (!available || !state.ready) return
    if (!factory.current) factory.current = import('../activities/WorkActivity')
    const { WorkActivityFactory } = await factory.current
    if (!recovered.current) {
      recovered.current = true
      suppressed.current = state.drafts['live-activity-dismissed-scope'] || null
      const instances = WorkActivityFactory.getInstances()
      let saved: { computerId?: string; startedAt?: number; remote?: boolean } = {}
      try {
        saved = JSON.parse(state.drafts['live-activity-meta'] || '{}')
      } catch {}
      if (instances[0] && saved.computerId === state.selected && saved.startedAt)
        current.current = {
          instance: instances[0],
          computerId: saved.computerId,
          startedAt: saved.startedAt,
          remote: !!saved.remote,
        }
      // The host started this one while Ramu was closed (push-to-start), for the host this phone follows.
      else if (instances[0] && !saved.computerId) {
        current.current = { instance: instances[0], computerId: state.selected, startedAt: Date.now(), remote: false }
        persist(current.current)
      } else {
        for (const instance of instances) await instance.end('immediate').catch(() => {})
        if (!instances.length && saved.computerId === state.selected && saved.startedAt) {
          suppress(state.selected)
          persist(null)
        }
      }
      if (current.current) for (const instance of instances.slice(1)) await instance.end('immediate').catch(() => {})
    }
    await syncStart()
    state = latest.current
    if (
      state.drafts['live-activities-enabled'] === 'no' ||
      (current.current && current.current.computerId !== state.selected) ||
      (!state.computers.some((c) => c.id === current.current?.computerId) && current.current)
    ) {
      await stop()
      dismissEnding()
      suppress(null)
    }
    if (state.drafts['live-activities-enabled'] === 'no') return
    if (suppressed.current && suppressed.current !== state.selected) suppress(null)
    const computer = state.computers.find((c) => c.id === state.selected)
    if (computer?.status === 'revoked') {
      await stop()
      return
    }
    const work = state.chats.filter((c) => c.computerId === state.selected)
    const threads = liveActivityThreads(work, followed.current)
    const ongoing = threads.filter((t) => t.status !== 'done' && t.status !== 'failed')
    if (current.current) for (const thread of ongoing) followed.current.add(thread.id)
    const finished = threads.filter((t) => t.status === 'done' || t.status === 'failed')
    const step = liveActivityStep({
      active: !!current.current,
      ongoing: ongoing.length,
      followed: followed.current.size,
      online: computer?.status === 'online',
      foreground: foreground.current && suppressed.current !== state.selected,
      viewingFinished:
        foreground.current && finished.some((t) => !!t.sessionId && isThreadViewed(state.selected, t.sessionId)),
    })
    const content = (startedAt: number) =>
      liveActivityContent(threads, { startedAt, updatedAt: Date.now(), locale: state.language })
    // Tapping the activity opens the thread it puts first: the one that needs the person, failed or finished.
    const target = liveActivityOrder(threads)[0]?.id ?? ''
    if ((state.drafts['live-activity-target'] ?? '') !== target) state.setDraft('live-activity-target', target)
    if (step === 'dismiss') {
      await stop()
      suppress(null)
      return
    }
    if (step === 'finish') {
      const value = current.current!
      await finish(content(value.startedAt), new Set(finished.flatMap((t) => (t.sessionId ? [t.sessionId] : []))))
      suppress(null)
      return
    }
    if (step === 'start') {
      dismissEnding()
      // One activity at a time: any other this app left running is ended before a new one starts.
      for (const instance of WorkActivityFactory.getInstances()) await instance.end('immediate').catch(() => {})
      const startedAt = Date.now()
      followed.current = new Set(ongoing.map((t) => t.id))
      const first = content(startedAt)
      try {
        const instance = WorkActivityFactory.start(
          first,
          `ramu://activity?computerId=${encodeURIComponent(state.selected)}`,
          new Date(startedAt + LIVE_ACTIVITY_STALE_MS),
        )
        current.current = { instance, computerId: state.selected, startedAt, remote: false, content: first }
        persist(current.current)
      } catch {
        followed.current = new Set()
        suppress(state.selected)
        return
      }
    }
    const value = current.current
    if (!value) return
    if (!value.subscription) {
      value.subscription = value.instance.addPushTokenListener((event) => {
        void registerToken(value, event.pushToken)
      })
      void value.instance
        .getPushToken()
        .then((token) => {
          if (token) void registerToken(value, token)
        })
        .catch(() => {})
    }
    if (value.token && computer?.status === 'online') void registerToken(value, value.token)
    // While Ramu is in the background a push-backed activity follows the host's pushes. Without pushes, or with the
    // host out of reach, the last real state stays until its stale date, when iOS shows it as out of date.
    const leavingNow = leaving.current
    leaving.current = false
    if (step !== 'update' && step !== 'start') return
    if (!foreground.current && !leavingNow && value.remote) return
    if (step === 'start') return
    const next = content(value.startedAt)
    value.content = next
    try {
      await value.instance.update(next, new Date(Date.now() + LIVE_ACTIVITY_STALE_MS))
    } catch {
      value.subscription?.remove()
      current.current = null
      followed.current = new Set()
      suppress(state.selected)
      persist(null)
    }
  }
  syncRef.current = () => {
    pending.current = true
    if (busy.current || !available) return
    busy.current = true
    void (async () => {
      try {
        while (pending.current) {
          pending.current = false
          await synchronize()
        }
      } catch {
        /* A disabled system feature must never interrupt chat. */
      } finally {
        busy.current = false
      }
    })()
  }
  useEffect(() => {
    syncRef.current()
  }, [store.ready, store.selected, pc?.status, shown, enabled, store.language, available])
  useEffect(() => {
    if (!available) return
    let tokens: { remove(): void } | undefined
    let alive = true
    void import('expo-widgets')
      .then((module) => {
        if (!alive) return
        tokens = module.addPushToStartTokenListener((event) => {
          if (latest.current.drafts['live-activity-start-token'] === event.activityPushToStartToken) return
          latest.current.setDraft('live-activity-start-token', event.activityPushToStartToken)
          syncRef.current()
        })
      })
      .catch(() => {})
    return () => {
      alive = false
      tokens?.remove()
    }
  }, [available])
  useEffect(() => {
    if (!available) return
    const subscription = AppState.addEventListener('change', (state) => {
      if (foreground.current && state !== 'active') leaving.current = true
      foreground.current = state === 'active'
      syncRef.current()
    })
    const viewing = onThreadViewed(() => {
      const value = ending.current
      if (value && [...value.sessions].some((session) => isThreadViewed(value.computerId, session))) dismissEnding()
    })
    const timer = setInterval(() => {
      if (foreground.current) syncRef.current()
    }, 30_000)
    return () => {
      subscription.remove()
      viewing()
      clearInterval(timer)
      current.current?.subscription?.remove()
    }
  }, [available])
  return null
}
