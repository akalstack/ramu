import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { mobileThreadActivity } from '../runtime/threadActivity'
import { goalActivityLabel, type ActivityKind } from '@ramu/shared/chat/threadActivity'
import type { Chat } from '../runtime/types'
import type { QueuedMessage } from '@ramu/shared/types'
import { useStore } from '../runtime/store'
import { useSay } from '../i18n'
import { space } from '../theme'
import { Sheet, T, type Icon } from './ui'
import { ActivityPill } from './ActivityPill'
import { ActivityList, ActivityRow, OfflineCard, WorkingSheet } from './ActivitySheets'
import { WorkingLine } from './WorkingLine'
import { Ellipsis, Hand, Hourglass, ListOrdered, Loader, Sparkles, Target, Users, WifiOff } from 'lucide-react-native'

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
import { Helpers } from './Helpers'
import { InputRequests } from './InputRequests'
import { GoalQueueTray } from './Composer'
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
  onEditQueued?: (message: QueuedMessage) => void
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
  const primary = activity.model.primary
  if (!primary && !actions.length && !children && !leading) return null
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
      // Finished helpers still have a pill to open; it counts them, not a "0 active".
      helpers: activity.model.counts.active
        ? say('{0} active agents', { 0: activity.model.counts.active })
        : say('{0} agents', { 0: activity.helpers.length || activity.groups.reduce((n, g) => n + g.agents.length, 0) }),
      advisor: activity.advisors.some(helperActive)
        ? say('Advisor reviewing')
        : unread
          ? say('Advisor history · {0} new', { 0: unread })
          : say('Advisor history'),
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
  // Only what needs the person earns a second pill; helpers, a goal, advice and the queue wait under "More", so the row
  // stays at the most urgent thing, the live tools and More.
  const secondary = activity.model.secondary
    .filter((kind) => kind === 'connection' || kind === 'input' || kind === 'provider')
    .slice(0, 1)
  const shown: (ActivityKind | 'more')[] = [...(primary && primary !== 'working' ? [primaryKind] : []), ...secondary]
  const rest = [
    ...new Set<ActivityKind>([
      ...activity.model.secondary.filter((kind) => kind !== 'working' && !shown.includes(kind)),
      ...(activity.groups.length && !shown.includes('helpers') ? ['helpers' as const] : []),
    ]),
  ]
  // "More" only gathers two or more things; a single one (a goal, the queue) gets its own pill, which says what it is.
  const kinds = [
    ...new Set<ActivityKind | 'more'>([
      // The working line before these pills says what the agent is doing, compaction included.
      ...shown,
      ...(rest.length === 1 ? rest : rest.length ? ['more' as const] : []),
    ]),
  ]
  return (
    <>
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
          {leading}
          {actions.map(({ label, icon, onPress }) => (
            <ActivityPill key={label} icon={icon} label={label} accessibilityLabel={label} iconOnly onPress={onPress} />
          ))}
          {children}
          {kinds.map((kind) => (
            <ActivityPill
              key={kind}
              icon={KIND_ICON[kind]}
              label={label(kind)}
              tone={kind === 'connection' ? 'off' : kind === 'input' || kind === 'provider' ? 'attention' : 'quiet'}
              emphasis={kind === primaryKind}
              onPress={() => setOpened(kind)}
            />
          ))}
        </View>
      </ScrollView>
      <Sheet
        // Short summaries open as a sheet over the thread; long lists and answers get the full screen.
        presentation={opened === 'helpers' || opened === 'advisor' || opened === 'input' ? 'screen' : 'sheet'}
        open={opened !== null}
        onClose={() => setOpened(null)}
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
              {(['input', 'provider', 'goal', 'queue', 'helpers', 'advisor'] as const)
                .filter((kind) =>
                  kind === 'helpers'
                    ? activity.helpers.length || activity.groups.length
                    : kind === 'advisor'
                      ? activity.advisors.length
                      : kind === 'input'
                        ? activity.requests.length
                        : kind === 'goal'
                          ? chat.goal
                          : kind === 'queue'
                            ? chat.queue.length
                            : activity.model.primary === 'provider' || activity.model.secondary.includes('provider'),
                )
                .map((kind) => (
                  <ActivityRow
                    key={kind}
                    icon={KIND_ICON[kind]}
                    tone={kind === 'input' || kind === 'provider' ? 'attention' : 'quiet'}
                    title={label(kind)}
                    detail={detailOf(kind)}
                    onPress={() => setOpened(kind)}
                  />
                ))}
            </ActivityList>
          </View>
        ) : null}
        {opened === 'helpers' ? (
          <View style={{ padding: space.m, gap: space.m }}>
            {activity.helpers.length ? (
              <Helpers item={{ kind: 'agents', id: 'selected-helpers', agents: activity.helpers }} chat={chat} />
            ) : null}
            {activity.groups
              .filter((g) => !g.advisor && g.agents.some((t) => !activity.helpers.some((h) => h.agentId === t.agentId)))
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
            <Helpers item={{ kind: 'agents', id: 'advisors', advisor: true, agents: activity.advisors }} chat={chat} />
          </View>
        ) : null}
        {opened === 'input' ? <InputRequests chat={chat} /> : null}
        {(opened === 'goal' || opened === 'queue') && !online ? (
          <View style={{ padding: space.m }}>
            <T tone="muted">{say('Reconnect to use these controls.')}</T>
            <T>{opened === 'goal' ? chat.goal?.objective : chat.queue.map((q) => q.text).join('\n\n')}</T>
          </View>
        ) : null}
        {online && (opened === 'goal' || opened === 'queue') ? (
          <GoalQueueTray
            goal={opened === 'goal' ? chat.goal : null}
            queue={opened === 'queue' ? chat.queue : []}
            paused={chat.queuePaused}
            onToggleGoal={online ? () => store.toggleGoal(chat.id) : undefined}
            onClearGoal={online ? () => store.clearGoal(chat.id) : undefined}
            onVerifyGoal={online ? (command) => store.setGoalVerify(chat.id, command) : undefined}
            onRemove={online ? (message) => store.removeQueued(chat.id, message) : undefined}
            onSendNow={online ? (message) => store.sendQueuedNow(chat.id, message) : undefined}
            onSteer={online ? (message) => store.steerQueued(chat.id, message) : undefined}
            onEdit={
              online && onEditQueued
                ? (message) => {
                    setOpened(null)
                    onEditQueued(message)
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
