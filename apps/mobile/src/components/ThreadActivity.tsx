import { useEffect, useState, type ReactNode } from 'react'
import { ScrollView, View } from 'react-native'
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { mobileThreadActivity } from '../runtime/threadActivity'
import { goalActivityLabel, type ActivityKind } from '@ramu/shared/chat/threadActivity'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { space } from '../theme'
import { Sheet, T, type Icon } from './ui'
import { ActivityPill } from './ActivityPill'
import { ActivityList, ActivityRow, OfflineCard, WorkingSheet } from './ActivitySheets'
import { WorkingLine } from './WorkingLine'
import {
  Ellipsis,
  Hand,
  Hourglass,
  ListOrdered,
  Loader,
  Sparkles,
  Target,
  Users,
  WifiOff,
} from 'lucide-react-native'

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
import { LimitTray } from './LimitTray'
export function ThreadActivity({
  chat,
  actions = [],
  leading,
  children,
}: {
  chat: Chat
  children?: ReactNode
  /** Status pills (computer, browser) that sit first in the row and manage their own visibility. */
  leading?: ReactNode
  actions?: { label: string; icon: Icon; onPress(): void }[]
}) {
  const store = useStore()
  const online = store.isOnline(chat.computerId)
  const id = store.language === 'id'
  const activity = mobileThreadActivity(chat, online)
  const [opened, setOpened] = useState<ActivityKind | 'more' | null>(null)
  const [adviceSeen, setAdviceSeen] = useState(false)
  const unread = adviceSeen ? 0 : (chat.unreadAdvice ?? 0)
  // A fresh host count (new advice arrived, or the host cleared it) replaces the local "seen" mark.
  useEffect(() => setAdviceSeen(false), [chat.unreadAdvice])
  const settledAdvice = activity.advisors.length > 0 && !activity.advisors.some(helperActive)
  // Opening settled advisor notes counts as reading them; a view-only device is refused and an older host has no such method.
  useEffect(() => {
    if (opened !== 'advisor' || !online || !chat.sessionId || !settledAdvice || adviceSeen || !chat.unreadAdvice) return
    setAdviceSeen(true)
    void store.invoke(chat.computerId, 'agent.markAdviceRead', chat.sessionId).catch(() => {})
  }, [opened, online, chat.sessionId, chat.computerId, chat.unreadAdvice, settledAdvice, adviceSeen, store])
  const primary = activity.model.primary
  if (!primary && !actions.length && !children && !leading) return null
  const label = (kind: ActivityKind | 'more'): string =>
    ({
      connection: id ? 'Terputus' : 'Offline',
      input: activity.requests.some((r) => r.kind === 'permission')
        ? id
          ? 'Perlu persetujuan'
          : 'Approval needed'
        : `${activity.requests.length} ${id ? 'pertanyaan' : 'questions'}`,
      provider: id ? 'Menunggu reset batas' : 'Waiting for limit reset',
      working: chat.compacting ? (id ? 'Meringkas konteks…' : 'Compacting context…') : id ? 'Bekerja' : 'Working',
      helpers: `${activity.model.counts.active} ${id ? 'agen aktif' : 'active agents'}`,
      advisor: activity.advisors.some(helperActive)
        ? id
          ? 'Penasihat meninjau'
          : 'Advisor reviewing'
        : unread
          ? id
            ? `Riwayat penasihat · ${unread} baru`
            : `Advisor history · ${unread} new`
          : id
            ? 'Riwayat penasihat'
            : 'Advisor history',
      goal: id
        ? {
            active: 'Tujuan aktif',
            verifying: 'Memverifikasi tujuan',
            'turn-limit': 'Batas giliran tujuan tercapai',
            paused: 'Tujuan dijeda',
            provider: 'Tujuan menunggu penyedia',
            blocked: 'Tujuan terhambat',
          }[activity.model.goalState ?? 'paused']
        : goalActivityLabel(activity.model.goalState),
      queue: `${chat.queue.length} ${id ? 'dalam antrean' : 'queued'}`,
      more: id ? 'Aktivitas lainnya' : 'More activity',
    })[kind]
  /** One line under a row in the overview: what is waiting there, in the thread's own words. */
  const detailOf = (kind: ActivityKind): string | null =>
    kind === 'goal'
      ? (chat.goal?.objective ?? null)
      : kind === 'queue'
        ? (chat.queue[0]?.text ?? null)
        : kind === 'input'
          ? id
            ? 'Jawab agar agen bisa lanjut'
            : 'Answer so the agent can continue'
          : kind === 'provider'
            ? id
              ? 'Lanjut otomatis saat batas pulih'
              : 'Resumes on its own when the limit resets'
            : null
  const primaryKind: ActivityKind | 'more' = primary ?? 'more'
  const secondary = activity.model.secondary.filter((kind) => kind !== 'working').slice(0, 1)
  const kinds = [
    ...new Set<ActivityKind | 'more'>([
      // The working line before these pills says what the agent is doing, compaction included.
      ...(primary && primary !== 'working' ? [primaryKind] : []),
      ...secondary,
      ...(activity.groups.length || activity.model.secondary.length > 1 ? ['more' as const] : []),
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
        accessibilityLabel={id ? 'Aktivitas thread' : 'Thread activity'}
        style={{ flexGrow: 0, marginTop: space.xs }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <WorkingLine chat={chat} onPress={() => setOpened('working')} />
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
            ? id
              ? 'Sedang bekerja'
              : 'Working'
            : opened === 'connection'
              ? id
                ? 'Koneksi'
                : 'Connection'
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
            <T tone="muted">
              {id ? 'Hubungkan kembali untuk menggunakan kontrol.' : 'Reconnect to use these controls.'}
            </T>
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
              {id ? 'Hubungkan kembali untuk melihat batas penyedia.' : 'Reconnect to check the provider limit.'}
            </T>
          )
        ) : null}
      </Sheet>
    </>
  )
}
