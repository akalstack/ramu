import { scheduleWriteProblem } from './scheduleModel'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type {
  AgentSettings,
  LibrarySummary,
  RecapItem,
  RecapSnapshot,
  Schedule,
  ScheduleInput,
  ScheduleRun,
  SummariesSnapshot,
} from '@ramu/shared/types'
import type { HostResources } from '@ramu/shared/resources'
import { readFailuresSeen, readLastVisit, saveFailuresSeen, saveLastVisit } from '../storage'
import { useStore } from './store'
import { buildInbox, type InboxModel } from './inbox'
import { looseInvoke } from './settingsModel'
import { actOnHost, applyRecapAction, RECAP_TOAST, type RecapAction } from './recapActions'
import { showToast } from './toast'

// What the computers keep beyond threads: recaps, what Ramu learned, and schedules. Every online computer is read
// at once (Inbox shows what needs you on all of them) and refreshed when the computer says automation changed.

const FAILURES_KEPT = 300
const RESOURCES_MS = 60_000

export interface Automation {
  recaps: RecapSnapshot | null
  summaries: SummariesSnapshot | null
  schedules: Schedule[]
  runs: ScheduleRun[]
  resources: HostResources | null
  loaded: boolean
  error: string | null
}
const empty: Automation = {
  recaps: null,
  summaries: null,
  schedules: [],
  runs: [],
  resources: null,
  loaded: false,
  error: null,
}

interface AutomationStore {
  of(computerId: string): Automation
  inbox: InboxModel
  /** The moment recaps count as "since your last visit" from. */
  visit: number
  failureSeen: (chat: { id: string; lastActiveAt: number }) => boolean
  /** Opening a failed thread is seeing it: it stops asking in the Brief and the badge. */
  seeFailure: (chat: { id: string; lastActiveAt: number }) => void
  reload(computerId: string): Promise<void>
  refreshRecaps(computerId: string): Promise<void>
  /**
   * Done, Dismiss or Snooze a recap item (`until` is when a snooze ends) and show an Undo toast; `'open'` puts it back.
   * Resolves once the host has answered; the card is already gone by then.
   */
  actRecap(computerId: string, item: RecapItem, action: RecapAction, until?: number): Promise<void>
  /** Whether this host takes a chosen snooze time. An older one snoozes for a day whatever is asked, so the menu is not offered. */
  readSummary(computerId: string, id: string): Promise<LibrarySummary>
  dismissSummary(computerId: string, id: string): Promise<void>
  runSummaries(computerId: string): Promise<void>
  discussSummary(computerId: string, id: string, text: string, settings?: AgentSettings): Promise<{ taskId: string }>
  saveSchedule(computerId: string, input: ScheduleInput, id?: string): Promise<Schedule>
  pauseSchedule(computerId: string, id: string, paused: boolean): Promise<void>
  deleteSchedule(computerId: string, id: string): Promise<void>
  runScheduleNow(computerId: string, id: string): Promise<ScheduleRun>
  previewRule(computerId: string, rule: ScheduleInput['rule'], timezone: string): Promise<number[]>
}
const Context = createContext<AutomationStore | null>(null)

const AWAY_MS = 5 * 60_000

export function AutomationProvider({ children }: { children: ReactNode }) {
  const store = useStore()
  const [state, setState] = useState<Record<string, Automation>>({})
  const patch = useCallback(
    (id: string, next: Partial<Automation>) => setState((s) => ({ ...s, [id]: { ...(s[id] ?? empty), ...next } })),
    [],
  )
  const storeRef = useRef(store)
  storeRef.current = store

  // "Since your last visit" means since you last left the app, not since this screen last mounted: the marker moves
  // forward only after the app was in the background for a while, so recaps don't vanish on the next tap.
  const [visit, setVisit] = useState(() => readLastVisit())
  const [failures, setFailures] = useState(() => readFailuresSeen())
  useEffect(() => {
    let leftAt = 0
    saveLastVisit(Date.now())
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        if (leftAt && Date.now() - leftAt > AWAY_MS) setVisit(leftAt)
        leftAt = 0
      } else if (!leftAt) {
        leftAt = Date.now()
        saveLastVisit(leftAt)
      }
    })
    return () => sub.remove()
  }, [])

  const requireScheduleWrite = (id: string) => {
    const current = storeRef.current
    const problem = scheduleWriteProblem(
      current.computers.find((computer) => computer.id === id),
      current.language,
    )
    if (problem) throw new Error(problem)
  }

  const recapsOn = (id: string) => store.appPreferences[id]?.recapsEnabled !== false

  const load = useCallback(
    async (id: string, what: ('recaps' | 'summaries' | 'schedules')[] = ['recaps', 'summaries', 'schedules']) => {
      const call = storeRef.current.invoke
      const on = storeRef.current.appPreferences[id]?.recapsEnabled !== false
      try {
        const [recaps, summaries, schedules, runs] = await Promise.all([
          what.includes('recaps') && on ? call(id, 'recaps.get') : undefined,
          // Older computers do not have summaries; that is not an error for the rest.
          what.includes('summaries') ? call(id, 'summaries.get').catch(() => undefined) : undefined,
          what.includes('schedules') ? call(id, 'schedules.list') : undefined,
          what.includes('schedules') ? call(id, 'schedules.runs') : undefined,
        ])
        patch(id, {
          ...(recaps ? { recaps } : {}),
          ...(summaries ? { summaries } : {}),
          ...(schedules ? { schedules } : {}),
          ...(runs ? { runs } : {}),
          loaded: true,
          error: null,
        })
      } catch (error) {
        patch(id, { loaded: true, error: error instanceof Error ? error.message : String(error) })
      }
    },
    [patch],
  )

  const online = store.computers
    .filter((c) => c.status === 'online')
    .map((c) => c.id)
    .join(',')
  useEffect(() => {
    const ids = online ? online.split(',') : []
    const offs = ids.map((id) => {
      void load(id)
      const readResources = () =>
        void storeRef.current
          .invoke(id, 'resources.host')
          .then((resources) => patch(id, { resources }))
          // A view-only pairing is refused this, and has no low-memory row to show.
          .catch(() => patch(id, { resources: null }))
      readResources()
      const resourceTimer = setInterval(readResources, RESOURCES_MS)
      let timer: ReturnType<typeof setTimeout> | undefined
      // Bursts of changes (a run starting, then each recap) are read once.
      const soon = (what: Parameters<typeof load>[1]) => {
        clearTimeout(timer)
        timer = setTimeout(() => void load(id, what), 250)
      }
      const off = storeRef.current.subscribe(id, (channel) => {
        if (channel === 'automation:changed') soon(['recaps', 'schedules'])
        else if (channel === 'summaries:changed') soon(['summaries'])
      })
      return () => {
        clearTimeout(timer)
        clearInterval(resourceTimer)
        off()
      }
    })
    return () => offs.forEach((off) => off())
  }, [online, load, patch])

  // Recaps are fetched only when turned on; read them when the preference arrives or flips.
  const recapKey = store.computers.map((c) => `${c.id}:${recapsOn(c.id)}`).join(',')
  useEffect(() => {
    for (const c of storeRef.current.computers)
      if (c.status === 'online' && storeRef.current.appPreferences[c.id]?.recapsEnabled !== false)
        void load(c.id, ['recaps'])
  }, [recapKey, load])

  const value = useMemo<AutomationStore>(() => {
    const failureSeen = (chat: { id: string; lastActiveAt: number }) => failures[chat.id] === chat.lastActiveAt
    const call = <T,>(id: string, run: (invoke: typeof store.invoke) => Promise<T>) => run(storeRef.current.invoke)
    const api: AutomationStore = {
      of: (id) => state[id] ?? empty,
      visit,
      failureSeen,
      seeFailure: (chat) =>
        setFailures((current) => {
          if (current[chat.id] === chat.lastActiveAt) return current
          const kept = Object.entries(current)
            .sort((a, b) => b[1] - a[1])
            .slice(0, FAILURES_KEPT - 1)
          const next = { ...Object.fromEntries(kept), [chat.id]: chat.lastActiveAt }
          saveFailuresSeen(next)
          return next
        }),
      inbox: buildInbox({
        chats: store.chats,
        recaps: store.computers.flatMap((c) =>
          (state[c.id]?.recaps?.items ?? []).map((item) => ({ computerId: c.id, item })),
        ),
        summaries: store.computers.flatMap((c) =>
          (state[c.id]?.summaries?.summaries ?? []).map((summary) => ({ computerId: c.id, summary })),
        ),
        recapsEnabled: recapsOn,
        failureSeen,
        lowMemory: store.computers.flatMap((c) => {
          const low = state[c.id]?.resources?.low
          return low ? [{ computerId: c.id, low }] : []
        }),
        visit,
      }),
      reload: (id) => load(id),
      refreshRecaps: async (id) => {
        patch(id, {
          recaps: { ...(state[id]?.recaps ?? { items: [], generatedAt: null, error: null }), generating: true },
        })
        try {
          patch(id, { recaps: await call(id, (invoke) => invoke(id, 'recaps.refresh')) })
        } catch (error) {
          await load(id, ['recaps'])
          throw error
        }
      },
      actRecap: async (id, item, action, until) => {
        // Gone at once; the computer confirms (or the reload below puts it back).
        setState((all) => {
          const current = all[id]?.recaps
          if (!current) return all
          return {
            ...all,
            [id]: {
              ...all[id]!,
              recaps: { ...current, items: applyRecapAction(current.items, item.id, action, until) },
            },
          }
        })
        try {
          await actOnHost(
            (...args) => call(id, (invoke) => looseInvoke(invoke)(id, 'recaps.act', ...args)),
            item.id,
            action,
            until,
          )
          if (action !== 'open')
            showToast(RECAP_TOAST[action], {
              label: 'undo',
              run: () => void api.actRecap(id, item, 'open').catch(() => {}),
            })
        } finally {
          void load(id, ['recaps'])
        }
      },
      readSummary: (id, summaryId) => call(id, (invoke) => invoke(id, 'summaries.read', summaryId)),
      dismissSummary: async (id, summaryId) => {
        await call(id, (invoke) => invoke(id, 'summaries.dismiss', summaryId))
        await load(id, ['summaries'])
      },
      runSummaries: async (id) => {
        await call(id, (invoke) => invoke(id, 'summaries.run'))
        await load(id, ['summaries'])
      },
      discussSummary: (id, summaryId, text, settings) =>
        call(id, (invoke) => invoke(id, 'summaries.discuss', summaryId, text, settings)),
      saveSchedule: async (id, input, scheduleId) => {
        requireScheduleWrite(id)
        const saved = await call(id, (invoke) => invoke(id, 'schedules.save', input, scheduleId))
        await load(id, ['schedules'])
        return saved
      },
      pauseSchedule: async (id, scheduleId, paused) => {
        requireScheduleWrite(id)
        await call(id, (invoke) => invoke(id, 'schedules.pause', scheduleId, paused))
        await load(id, ['schedules'])
      },
      deleteSchedule: async (id, scheduleId) => {
        requireScheduleWrite(id)
        await call(id, (invoke) => invoke(id, 'schedules.delete', scheduleId))
        await load(id, ['schedules'])
      },
      runScheduleNow: async (id, scheduleId) => {
        requireScheduleWrite(id)
        const run = await call(id, (invoke) => invoke(id, 'schedules.runNow', scheduleId))
        await Promise.all([load(id, ['schedules']), storeRef.current.refresh(id).catch(() => {})])
        return run
      },
      previewRule: async (id, rule, timezone) => {
        requireScheduleWrite(id)
        return call(id, (invoke) => invoke(id, 'schedules.preview', rule, timezone))
      },
    }
    return api
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, store.chats, store.computers, store.appPreferences, visit, failures, load, patch])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAutomation() {
  const value = useContext(Context)
  if (!value) throw new Error('AutomationProvider missing')
  return value
}
