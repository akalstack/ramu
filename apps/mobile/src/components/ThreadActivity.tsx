import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { mobileThreadActivity } from '../runtime/threadActivity'
import { goalActivityLabel, type ActivityKind } from '@ramu/shared/chat/threadActivity'
import type { Chat } from '../runtime/types'
import { useStore } from '../runtime/store'
import { font, space } from '../theme'
import { Button, Sheet, T } from './ui'
import { Helpers } from './Helpers'
import { InputRequests } from './InputRequests'
import { GoalQueueTray } from './Composer'
import { LimitTray } from './LimitTray'
export function ThreadActivity({ chat }: { chat: Chat }) {
  const store = useStore()
  const online = store.isOnline(chat.computerId)
  const id = store.language === 'id'
  const activity = mobileThreadActivity(chat, online)
  const [opened, setOpened] = useState<ActivityKind | 'more' | null>(null)
  const primary = activity.model.primary
  if (!primary) return null
  const label = (kind: ActivityKind | 'more'): string =>
    ({
      connection: id ? 'Terputus · aktivitas terakhir' : 'Offline · last-known activity',
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
  const primaryKind: ActivityKind | 'more' = primary ?? 'more'
  const secondary = activity.model.secondary.filter((kind) => kind !== 'working').slice(0, 1)
  const kinds = [
    ...new Set<ActivityKind | 'more'>([
      primaryKind,
      ...secondary,
      ...(activity.groups.length || activity.model.secondary.length > 1 ? ['more' as const] : []),
    ]),
  ]
  return (
    <>
      <View
        accessibilityLabel={id ? 'Aktivitas thread' : 'Thread activity'}
        style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space.s }}
      >
        {kinds.map((kind) => (
          <Pressable
            key={kind}
            accessibilityRole="button"
            onPress={() => setOpened(kind)}
            style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: space.s, flexShrink: 1 }}
          >
            <T
              size={font.caption}
              weight={kind === primaryKind ? '600' : '400'}
              tone={kind === primaryKind ? 'text' : 'muted'}
            >
              {label(kind)}
            </T>
          </Pressable>
        ))}
      </View>
      <Sheet open={opened !== null} onClose={() => setOpened(null)} title={opened ? label(opened) : ''}>
        {opened === 'more' || opened === 'connection' || opened === 'working' ? (
          <View style={{ padding: space.m, gap: space.s }}>
            {!online ? (
              <T tone="muted">
                {id ? 'Data terakhir. Hubungkan kembali dari Hosts.' : 'Last-known activity. Reconnect from Hosts.'}
              </T>
            ) : null}
            {(['input', 'helpers', 'advisor', 'goal', 'queue', 'provider'] as const)
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
                <Button key={kind} kind="ghost" title={label(kind)} onPress={() => setOpened(kind)} />
              ))}
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
            <T tone="muted">
              {id ? 'Hubungkan kembali untuk melihat batas penyedia.' : 'Reconnect to check the provider limit.'}
            </T>
          )
        ) : null}
      </Sheet>
    </>
  )
}
