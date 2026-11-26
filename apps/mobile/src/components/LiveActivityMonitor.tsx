import { useEffect, useRef } from 'react'
import { AppState, Platform } from 'react-native'
import { requireOptionalNativeModule } from 'expo'
import type { LiveActivity } from 'expo-widgets'
import type { MobileLiveActivityContent } from '@ramu/shared/api'
import { useStore } from '../runtime/store'

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

/** One user-controllable ActivityKit activity for the selected computer's ongoing work. */
export function LiveActivityMonitor() {
  const store = useStore()
  const latest = useRef(store)
  latest.current = store
  const current = useRef<Current | null>(null)
  const foreground = useRef(AppState.currentState === 'active')
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
  const running = chats.filter((c) => c.status === 'running').length
  const waiting = chats.filter((c) => c.status === 'needs-input').length
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
  const stop = async (immediate: boolean) => {
    const value = current.current
    current.current = null
    if (!value) return
    value.subscription?.remove()
    void latest.current.invoke(value.computerId, 'liveActivity.unregister', value.instance.getId()).catch(() => {})
    const final = {
      ...value.content,
      running: 0,
      waiting: 0,
      startedAt: value.startedAt,
      updatedAt: Date.now(),
      locale: latest.current.language,
      phase: 'finished' as const,
    }
    const module = await import('expo-widgets')
    await value.instance
      .end(immediate ? 'immediate' : module.after(new Date(Date.now() + 15 * 60_000)), final)
      .catch(() => {})
    persist(null)
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
      await stop(true)
      suppress(null)
    }
    if (state.drafts['live-activities-enabled'] === 'no') return
    if (suppressed.current && suppressed.current !== state.selected) suppress(null)
    const computer = state.computers.find((c) => c.id === state.selected)
    const work = state.chats.filter((c) => c.computerId === state.selected && c.status !== 'archived')
    const active = work.filter((c) => c.status === 'running').length,
      needsInput = work.filter((c) => c.status === 'needs-input').length
    if (computer?.status === 'online' && active + needsInput === 0) {
      await stop(false)
      suppress(null)
      return
    }
    if (computer?.status === 'revoked') {
      await stop(true)
      return
    }
    if (
      !current.current &&
      computer?.status === 'online' &&
      active + needsInput > 0 &&
      foreground.current &&
      suppressed.current !== state.selected
    ) {
      const startedAt = Date.now()
      const content: MobileLiveActivityContent = {
        running: active,
        waiting: needsInput,
        startedAt,
        updatedAt: startedAt,
        locale: state.language,
        phase: needsInput ? 'waiting' : 'working',
      }
      try {
        const instance = WorkActivityFactory.start(
          content,
          `ramu://activity?computerId=${encodeURIComponent(state.selected)}`,
          new Date(startedAt + 10 * 60_000),
        )
        current.current = { instance, computerId: state.selected, startedAt, remote: false, content }
        persist(current.current)
      } catch {
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
    if (!foreground.current && value.remote) return // APNs remains authoritative while JS is suspended.
    if (value.token && computer?.status === 'online') void registerToken(value, value.token)
    const fresh = foreground.current && computer?.status === 'online'
    const content: MobileLiveActivityContent = {
      running: active,
      waiting: needsInput,
      startedAt: value.startedAt,
      updatedAt: Date.now(),
      locale: state.language,
      phase: fresh ? (needsInput ? 'waiting' : 'working') : 'paused',
    }
    value.content = content
    try {
      await value.instance.update(content, new Date(fresh ? Date.now() + 10 * 60_000 : Date.now()))
    } catch {
      value.subscription?.remove()
      current.current = null
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
  }, [store.ready, store.selected, pc?.status, running, waiting, enabled, store.language, available])
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
      foreground.current = state === 'active'
      syncRef.current()
    })
    const timer = setInterval(() => {
      if (foreground.current) syncRef.current()
    }, 30_000)
    return () => {
      subscription.remove()
      clearInterval(timer)
      current.current?.subscription?.remove()
    }
  }, [available])
  return null
}
