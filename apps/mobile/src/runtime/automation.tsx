import { scheduleWriteProblem } from './scheduleModel'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState } from 'react-native'
import type {
  AgentSettings,
  LearningSnapshot,
  LibrarySummary,
  Schedule,
  ScheduleInput,
  ScheduleRun,
  SummariesSnapshot,
} from '@ramu/shared/types'
import type { HostResources } from '@ramu/shared/resources'
import { readFailuresSeen, readLastVisit, saveFailuresSeen, saveLastVisit } from '../storage'
import { useStore } from './store'
import { buildInbox, type InboxModel } from './inbox'

// What the computers keep beyond threads: what Ramu learned (summaries and reviews), and schedules. Every online computer is read
// at once (Inbox shows what needs you on all of them) and refreshed when the computer says automation changed.

const FAILURES_KEPT = 300
const RESOURCES_MS = 60_000

export interface Automation {
  summaries: SummariesSnapshot | null
  /** Learning reviews and skills; null where the host refuses them, as it does a view-only device. */
  learning: LearningSnapshot | null
  schedules: Schedule[]
  runs: ScheduleRun[]
  resources: HostResources | null
  loaded: boolean
  error: string | null
}
const empty: Automation = {
  summaries: null,
  learning: null,
  schedules: [],
  runs: [],
  resources: null,
  loaded: false,
  error: null,
}

interface AutomationStore {
  of(computerId: string): Automation
  inbox: InboxModel
  /** The moment threads count as finished "since your last visit" from. */
  visit: number
  failureSeen: (chat: { id: string; lastActiveAt: number }) => boolean
  /** Opening a failed thread is seeing it: it stops asking in the Brief and the badge. */
  seeFailure: (chat: { id: string; lastActiveAt: number }) => void
  reload(computerId: string): Promise<void>
  readSummary(computerId: string, id: string): Promise<LibrarySummary>
  dismissSummary(computerId: string, id: string): Promise<void>
  /** Apply, dismiss or undo a learning review; resolves with how many items Undo left because they changed since. */
  actLearning(computerId: string, action: 'apply' | 'dismiss' | 'undo', jobId: string): Promise<number>
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
  // forward only after the app was in the background for a while, so the count doesn't vanish on the next tap.
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

  const load = useCallback(
    async (id: string, what: ('summaries' | 'learning' | 'schedules')[] = ['summaries', 'learning', 'schedules']) => {
      const call = storeRef.current.invoke
      try {
        const [summaries, learning, schedules, runs] = await Promise.all([
          // Older computers do not have summaries; that is not an error for the rest.
          what.includes('summaries') ? call(id, 'summaries.get').catch(() => undefined) : undefined,
          what.includes('learning') ? call(id, 'learning.get').catch(() => null) : undefined,
          what.includes('schedules') ? call(id, 'schedules.list') : undefined,
          what.includes('schedules') ? call(id, 'schedules.runs') : undefined,
        ])
        patch(id, {
          ...(summaries ? { summaries } : {}),
          ...(learning !== undefined ? { learning } : {}),
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
      // Bursts of changes (a run starting, then its updates) are read once.
      const soon = (what: Parameters<typeof load>[1]) => {
        clearTimeout(timer)
        timer = setTimeout(() => void load(id, what), 250)
      }
      const off = storeRef.current.subscribe(id, (...[channel]) => {
        if (channel === 'automation:changed') soon(['schedules'])
        else if (channel === 'summaries:changed') soon(['summaries'])
        else if (channel === 'memory:changed') soon(['learning'])
      })
      return () => {
        clearTimeout(timer)
        clearInterval(resourceTimer)
        off()
      }
    })
    return () => offs.forEach((off) => off())
  }, [online, load, patch])

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
        summaries: store.computers.flatMap((c) =>
          (state[c.id]?.summaries?.summaries ?? []).map((summary) => ({ computerId: c.id, summary })),
        ),
        reviews: store.computers.flatMap((c) =>
          (state[c.id]?.learning?.jobs ?? []).map((job) => ({ computerId: c.id, job })),
        ),
        failureSeen,
        lowMemory: store.computers.flatMap((c) => {
          const low = state[c.id]?.resources?.low
          return low ? [{ computerId: c.id, low }] : []
        }),
      }),
      reload: (id) => load(id),
      readSummary: (id, summaryId) => call(id, (invoke) => invoke(id, 'summaries.read', summaryId)),
      dismissSummary: async (id, summaryId) => {
        await call(id, (invoke) => invoke(id, 'summaries.dismiss', summaryId))
        await load(id, ['summaries'])
      },
      actLearning: async (id, action, jobId) => {
        try {
          if (action === 'undo') return (await call(id, (invoke) => invoke(id, 'learning.undo', jobId))).kept
          await call(id, (invoke) =>
            action === 'apply' ? invoke(id, 'learning.apply', jobId) : invoke(id, 'learning.dismiss', jobId),
          )
          return 0
        } finally {
          void load(id, ['learning'])
        }
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
  }, [state, store.chats, store.computers, visit, failures, load, patch])
  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useAutomation() {
  const value = useContext(Context)
  if (!value) throw new Error('AutomationProvider missing')
  return value
}
