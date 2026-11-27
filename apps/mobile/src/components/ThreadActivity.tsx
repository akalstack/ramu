import { useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_GOAL_PREFERENCES } from '@ramu/shared/types'
import { ScrollView, View } from 'react-native'
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { mobileThreadActivity } from '../runtime/threadActivity'
import { goalActivityLabel, type ActivityKind } from '@ramu/shared/chat/threadActivity'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { space } from '../theme'
import { Sheet, T, type Icon } from './ui'
import { ActivityPill } from './ActivityPill'
import { ChromeScroll } from './Screen'
import { ActivityList, ActivityRow, OfflineCard, WorkingSheet } from './ActivitySheets'
import { WorkingLine } from './WorkingLine'
import { Ellipsis, Hand, Hourglass, ListOrdered, Loader, Sparkles, Target, Users, WifiOff } from 'lucide-react-native'

/** Pills the activity row shows before gathering the rest under "N more": enough for the usual goal, queue and agents. */
const MAX_PILLS = 4

/** The desktop's chip order: what needs the person, the goal, the agents, then (after the tools) the queue. */
const PILL_ORDER: ActivityKind[] = ['connection', 'input', 'provider', 'goal', 'helpers', 'advisor', 'working', 'queue']

const KIND_ICON: Record<ActivityKind | 'more', Icon> = {
  connection: WifiOff,
  input: Hand,
  provider: Hourglass,
  working: Loader,
  helpers: Users,
  advisor: Sparkles,
  goal: Target,
  queue: ListOrdered,
  more: Ellipsis,
}
import { HelperOpener, Helpers } from './Helpers'
import { InputRequests } from './InputRequests'
import { GoalQueueTray, type QueuedEdit } from './Composer'
import { confirmClearGoal } from './confirmClearGoal'
import { GoalSheet } from './GoalSheet'
import { moveQueued } from '../runtime/queueOrder'
import { showError } from '../runtime/toast'
import { LimitTray } from './LimitTray'
export function ThreadActivity({
  chat,
  actions = [],
  leading,
  children,
  inlineStatus,
  onEditQueued,
}: {
  chat: Chat
  /** Takes a queued message back into the composer to change it. */
  onEditQueued?: QueuedEdit
  children?: ReactNode
  /** The screen shows the turn's status at the end of the transcript, as the desktop does, so the row leaves it out. */
  inlineStatus?: boolean
  /** Status pills (computer, browser) that sit first in the row and manage their own visibility. */
  leading?: ReactNode
  actions?: { label: string; icon: Icon; onPress(): void }[]
}) {
  const store = useStore()
  const say = useSay()
  const online = store.isOnline(chat.computerId)
  const activity = mobileThreadActivity(chat, online)
  const [opened, setOpened] = useState<ActivityKind | 'more' | null>(null)
  // Reached from the "N more" list, so the sheet has a way back to it instead of only closing.
  const [fromMore, setFromMore] = useState(false)
  const [adviceSeen, setAdviceSeen] = useState(false)
  const unread = adviceSeen ? 0 : (chat.unreadAdvice ?? 0)
  // A fresh host count (new advice arrived, or the host cleared it) replaces the local "seen" mark.
  useEffect(() => setAdviceSeen(false), [chat.unreadAdvice])
  const settledAdvice = activity.advisors.length > 0 && !activity.advisors.some(helperActive)
  // Opening settled advisor notes counts as reading them; a view-only device is refused, which needs no saying.
  useEffect(() => {
    if (opened !== 'advisor' || !online || !chat.sessionId || !settledAdvice || adviceSeen || !chat.unreadAdvice) return
    setAdviceSeen(true)
    void store.invoke(chat.computerId, 'agent.markAdviceRead', chat.sessionId).catch(() => {})
  }, [opened, online, chat.sessionId, chat.computerId, chat.unreadAdvice, settledAdvice, adviceSeen, store])
  const runningAgents = activity.helpers.filter(helperActive).length
  /** Whether a sheet still has something to show: answered questions, a cleared goal or finished agents leave none. */
  const present = (kind: ActivityKind | 'more'): boolean =>
    kind === 'working' || kind === 'more'
      ? true
      : kind === 'connection'
        ? !online
        : kind === 'helpers'
          ? runningAgents > 0
          : kind === 'advisor'
            ? !!activity.advisors.length
            : kind === 'input'
              ? !!activity.requests.length
              : kind === 'goal'
                ? !!chat.goal
                : kind === 'queue'
                  ? !!chat.queue.length
                  : activity.model.primary === 'provider' || activity.model.secondary.includes('provider')
  // A sheet whose last item went (the last question answered, the goal cleared, the queue sent) closes by itself,
  // rather than staying open on nothing.
  const emptied = opened !== null && !present(opened)
  useEffect(() => {
    if (emptied) setOpened(null)
  }, [emptied])
  const primary = activity.model.primary
  // On the thread screen the row's height stays reserved while it is empty, so a pill appearing or going never moves the
  // conversation above the message box.
  if (!primary && !actions.length && !children && !leading)
    return inlineStatus ? <View style={{ height: 32, marginTop: space.xs }} /> : null
  const label = (kind: ActivityKind | 'more'): string =>
    ({
      connection: say('Offline'),
      input: activity.requests.some((r) => r.kind === 'permission')
        ? say('Approval needed')
        : activity.requests.length === 1
          ? say('{0} question', { 0: 1 })
          : say('{0} questions', { 0: activity.requests.length }),
      provider: say('Waiting for limit reset'),
      working: chat.compacting ? say('Compacting context…') : say('Working'),
      // Fixed names with a count, as the desktop's chips, so the row above the message box holds still as work
      // starts and ends; the sheet each opens says what is going on.
      helpers: `${say('Agents')} · ${runningAgents}`,
      advisor: unread ? `${say('Advisor')} · ${say('{0} new', { 0: unread })}` : say('Advisor'),
      goal: say(goalActivityLabel(activity.model.goalState)),
      queue: say('{0} queued', { 0: chat.queue.length }),
      more: say('More activity'),
    })[kind]
  /** One line under a row in the overview: what is waiting there, in the thread's own words. */
  const detailOf = (kind: ActivityKind): string | null =>
    kind === 'goal'
      ? (chat.goal?.objective ?? null)
      : kind === 'queue'
        ? (chat.queue[0]?.text ?? null)
        : kind === 'input'
          ? say('Answer so the agent can continue')
          : kind === 'provider'
            ? say('Resumes on its own when the limit resets')
            : null
  const primaryKind: ActivityKind | 'more' = primary ?? 'more'
  // Each thing keeps its own pill, most urgent first, as the desktop's chips do: a goal, the queue and the agents stay in
  // view. Only past MAX_PILLS does the rest gather under one "N more" pill, which opens all of them.
  // In the desktop's order: what needs the person first, then the goal and the agents, then the thread's tools (browser,
  // computer, servers and terminals, passed in), and the queue last.
  const ordered = [
    ...new Set<ActivityKind>([
      ...(primary && primary !== 'working' ? [primary] : []),
      ...activity.model.secondary.filter((kind) => kind !== 'working'),
    ]),
  ]
    // As the desktop's chip: agents at work. Finished ones are in the conversation, where each was started.
    .filter((kind) => kind !== 'helpers' || runningAgents > 0)
    .sort((a, b) => PILL_ORDER.indexOf(a) - PILL_ORDER.indexOf(b))
  const folded = ordered.length > MAX_PILLS ? ordered.length - (MAX_PILLS - 1) : 0
  // The working line before these pills says what the agent is doing, compaction included.
  const kinds: (ActivityKind | 'more')[] = folded ? [...ordered.slice(0, MAX_PILLS - 1), 'more'] : ordered
  const pill = (kind: ActivityKind | 'more') => (
    <ActivityPill
      key={kind}
      icon={KIND_ICON[kind]}
      label={kind === 'more' ? say('{0} more', { 0: folded }) : label(kind)}
      tone={kind === 'connection' ? 'off' : kind === 'input' || kind === 'provider' ? 'attention' : 'quiet'}
      emphasis={kind === primaryKind}
      onPress={() => {
        setFromMore(false)
        setOpened(kind)
      }}
    />
  )
  return (
    <>
      <ChromeScroll>
        <ScrollView
          horizontal
          // A tap on a pill acts at once, even while the keyboard is up, instead of only closing the keyboard.
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ alignItems: 'center', paddingHorizontal: space.s }}
          accessibilityLabel={say('Thread activity')}
          style={{ flexGrow: 0, marginTop: space.xs }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
            {inlineStatus ? null : <WorkingLine chat={chat} onPress={() => setOpened('working')} />}
            {kinds.filter((kind) => kind !== 'queue' && kind !== 'more').map(pill)}
            {leading}
            {children}
            {actions.map(({ label, icon, onPress }) => (
              <ActivityPill
                key={label}
                icon={icon}
                label={label}
                accessibilityLabel={label}
                iconOnly
                onPress={onPress}
              />
            ))}
            {kinds.filter((kind) => kind === 'queue' || kind === 'more').map(pill)}
          </View>
        </ScrollView>
      </ChromeScroll>
      <Sheet
        // Short summaries open as a sheet over the thread; long lists and answers get the full screen.
        presentation={opened === 'helpers' || opened === 'advisor' || opened === 'input' ? 'screen' : 'sheet'}
        open={opened !== null}
        onClose={() => setOpened(null)}
        onBack={fromMore && opened !== null && opened !== 'more' ? () => setOpened('more') : undefined}
        title={
          opened === 'working'
            ? say('Working')
            : opened === 'connection'
              ? say('Connection')
              : opened
                ? label(opened)
                : ''
        }
      >
        {opened === 'working' ? <WorkingSheet chat={chat} onDone={() => setOpened(null)} /> : null}
        {(opened === 'more' || opened === 'connection') && !online ? (
          <OfflineCard chat={chat} onDone={() => setOpened(null)} />
        ) : null}
        {opened === 'more' ? (
          <View style={{ paddingTop: online ? 0 : space.m }}>
            <ActivityList>
              {(['input', 'provider', 'goal', 'queue', 'helpers', 'advisor'] as const).filter(present).map((kind) => (
                <ActivityRow
                  key={kind}
                  icon={KIND_ICON[kind]}
                  tone={kind === 'input' || kind === 'provider' ? 'attention' : 'quiet'}
                  title={label(kind)}
                  detail={detailOf(kind)}
                  onPress={() => {
                    setFromMore(true)
                    setOpened(kind)
                  }}
                />
              ))}
            </ActivityList>
          </View>
        ) : null}
        {opened === 'helpers' || opened === 'advisor' ? (
          // An agent opens on its own screen once this sheet has gone: iOS shows nothing pushed beneath a sheet.
          <HelperOpener.Provider
            value={(go) => {
              setOpened(null)
              setTimeout(go, 350)
            }}
          >
            {opened === 'helpers' ? (
              <View style={{ padding: space.m, gap: space.m }}>
                {activity.helpers.length ? (
                  <Helpers item={{ kind: 'agents', id: 'selected-helpers', agents: activity.helpers }} chat={chat} />
                ) : null}
                {activity.groups
                  .filter(
                    (g) => !g.advisor && g.agents.some((t) => !activity.helpers.some((h) => h.agentId === t.agentId)),
                  )
                  .map((group) => (
                    <Helpers
                      key={group.id}
                      item={{
                        ...group,
                        earlier: true,
                        agents: group.agents.filter((t) => !activity.helpers.some((h) => h.agentId === t.agentId)),
                      }}
                      chat={chat}
                    />
                  ))}
              </View>
            ) : null}
            {opened === 'advisor' ? (
              <View style={{ padding: space.m }}>
                <Helpers
                  item={{ kind: 'agents', id: 'advisors', advisor: true, agents: activity.advisors }}
                  chat={chat}
                />
              </View>
            ) : null}
          </HelperOpener.Provider>
        ) : null}
        {opened === 'input' ? <InputRequests chat={chat} /> : null}
        {(opened === 'goal' || opened === 'queue') && !online ? (
          <View style={{ padding: space.m }}>
            <T tone="muted">{say('Reconnect to use these controls.')}</T>
            <T>{opened === 'goal' ? chat.goal?.objective : chat.queue.map((q) => q.text).join('\n\n')}</T>
          </View>
        ) : null}
        {online && opened === 'goal' && chat.goal ? (
          <GoalSheet
            goal={chat.goal}
            onToggle={() => store.toggleGoal(chat.id)}
            onClear={() => confirmClearGoal(say, () => store.clearGoal(chat.id))}
            onVerify={(command) => store.setGoalVerify(chat.id, command)}
            defaultLimit={store.appPreferences[chat.computerId]?.goals?.maxTurns ?? DEFAULT_GOAL_PREFERENCES.maxTurns}
            onLimit={(limit) => store.setGoalLimit(chat.id, limit)}
          />
        ) : null}
        {online && opened === 'queue' ? (
          <GoalQueueTray
            goal={null}
            queue={chat.queue}
            paused={chat.queuePaused}
            onRemove={online ? (message) => store.removeQueued(chat.id, message) : undefined}
            // Sending, steering and editing take the message out to the thread or the message box, so the sheet steps
            // aside for it; removing and reordering stay, since several may follow.
            onSendNow={
              online
                ? (message) => {
                    setOpened(null)
                    store.sendQueuedNow(chat.id, message)
                  }
                : undefined
            }
            onSteer={
              online
                ? (message) => {
                    setOpened(null)
                    store.steerQueued(chat.id, message)
                  }
                : undefined
            }
            onEdit={
              online && onEditQueued
                ? {
                    ...onEditQueued,
                    open: (message) => {
                      setOpened(null)
                      onEditQueued.open(message)
                    },
                  }
                : undefined
            }
            onMove={
              online && chat.sessionId
                ? (id, delta) => {
                    const ids = chat.queue.map((message) => message.id)
                    const order = moveQueued(ids, ids, id, delta)
                    if (!order) return
                    void store
                      .invoke(chat.computerId, 'agent.reorderQueued', chat.sessionId!, order)
                      .then(() => store.refresh(chat.computerId))
                      .catch((error) => showError(error instanceof Error ? error.message : String(error)))
                  }
                : undefined
            }
            running={chat.status === 'running'}
            onResumeQueue={
              online && chat.sessionId
                ? () => void store.invoke(chat.computerId, 'agent.resumeQueue', chat.sessionId!).catch(() => {})
                : undefined
            }
          />
        ) : null}
        {opened === 'provider' ? (
          online ? (
            <LimitTray chatId={chat.id} />
          ) : (
            <T tone="muted" style={{ paddingHorizontal: space.l }}>
              {say('Reconnect to check the provider limit.')}
            </T>
          )
        ) : null}
      </Sheet>
    </>
  )
}
