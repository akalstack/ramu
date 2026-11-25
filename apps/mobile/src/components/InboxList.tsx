import { useCallback, useState } from 'react'
import { Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Activity,
  Bell,
  CalendarClock,
  ChevronRight,
  Inbox as InboxIcon,
  Loader,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react-native'
import type { LibrarySummary } from '@ramu/shared/types'
import { font, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { useAutomation } from '../runtime/automation'
import { ShipActivityList } from './ShipActivity'
import { buildInbox, INBOX_TABS, inboxTabOf, type InboxChat, type InboxTab } from '../runtime/inbox'
import { STANDALONE, type Chat } from '../runtime/types'
import { ago, useSay, useT, type Strings } from '../i18n'
import { showToast } from '../runtime/toast'
import { Header, LargeTitle, PageScrollView, Screen, useScrolledUnderBar } from './Screen'
import { TopFade } from './Glass'
import { InboxBrief } from './InboxBrief'
import { WaitingReviewRow } from './LearningReviews'
import { InboxThread } from './InputRequests'
import { Chips, Nothing, Section } from './InboxParts'
import { HostChip } from './HostChip'
import { useTabActions } from './Overlays'
import { Divider, ROW_INSET, Row, T, tap } from './ui'
import { ListPane } from './ListPane'
import { ThreadOrigin, useOpenThread } from './paneContext'

// Remembered for the session, so coming back to the tab shows the chip you left it on.
let lastTab: InboxTab = 'brief'

function tabLabel(tab: InboxTab, t: Strings) {
  return {
    brief: t.tabBrief,
    running: t.tabRunning,
    learned: t.tabLearned,
    completed: t.tabCompleted,
  }[tab]
}

/**
 * The Inbox: what needs you, what is running and what came of it. As a pane (`pane`) it sits beside a thread opened
 * from it on a wide window, and a thread picked there replaces that one in place.
 */
export function InboxList({ pane }: { pane?: boolean }) {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const openThread = useOpenThread()
  const store = useStore()
  const auto = useAutomation()
  // As on Threads: every host at once by default, or the host picked from the host chip.
  const [allHosts, setAllHosts] = useState(true)
  const host = allHosts || store.computers.length < 2 ? null : store.selected
  const inbox = buildInbox({
    computerId: host,
    chats: store.chats,
    recaps: store.computers.flatMap((pc) =>
      (auto.of(pc.id).recaps?.items ?? []).map((item) => ({ computerId: pc.id, item })),
    ),
    summaries: store.computers.flatMap((pc) =>
      (auto.of(pc.id).summaries?.summaries ?? []).map((summary) => ({ computerId: pc.id, summary })),
    ),
    reviews: store.computers.flatMap((pc) =>
      (auto.of(pc.id).learning?.jobs ?? []).map((job) => ({ computerId: pc.id, job })),
    ),
    recapsEnabled: (id) => store.appPreferences[id]?.recapsEnabled !== false,
    failureSeen: auto.failureSeen as (chat: InboxChat) => boolean,
    lowMemory: auto.inbox.lowMemory,
    visit: auto.visit,
  })
  const params = useLocalSearchParams<{ tab?: string }>()
  const [tab, setTab] = useState<InboxTab>(() => (params.tab ? inboxTabOf(params.tab) : lastTab))
  const choose = (next: InboxTab) => {
    lastTab = next
    setTab(next)
  }
  // A tab or notification can ask for a particular chip.
  const [seenParam, setSeenParam] = useState(params.tab)
  if (params.tab !== seenParam) {
    setSeenParam(params.tab)
    if (params.tab) choose(inboxTabOf(params.tab))
  }
  const edge = useScrolledUnderBar(40)
  const insets = useSafeAreaInsets()
  const [refreshing, setRefreshing] = useState(false)
  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.all(
      store.computers
        .filter((pc) => pc.status === 'online')
        .map((pc) => Promise.all([store.refresh(pc.id).catch(() => {}), auto.reload(pc.id)])),
    )
    setRefreshing(false)
  }, [store, auto])

  const multi = store.computers.length > 1
  const computerName = (id: string) => store.computers.find((pc) => pc.id === id)?.name
  const projectName = (computerId: string, projectId: string) =>
    projectId === STANDALONE
      ? undefined
      : store.projects.find((p) => p.computerId === computerId && p.id === projectId)?.name
  const where = (computerId: string, projectId: string) =>
    [projectName(computerId, projectId), multi ? computerName(computerId) : undefined].filter(Boolean).join(' · ')
  const rows = (list: InboxChat[]) => (
    <View>
      {list.map((chat, i) => {
        const full = chat as Chat
        return (
          <InboxThread
            key={full.id}
            chat={full}
            project={where(full.computerId, full.projectId)}
            divider={i > 0}
            recap={
              inbox.recent.find((r) => r.computerId === full.computerId && r.item.taskId === full.taskId)?.item.title
            }
          />
        )
      })}
    </View>
  )
  const summary = (entry: { computerId: string; summary: LibrarySummary }, index: number) => {
    const { summary: s } = entry
    return (
      <View key={`${entry.computerId}:${s.id}`}>
        {index ? <Divider inset={ROW_INSET} /> : null}
        <Row
          onPress={() => {
            tap()
            router.push({ pathname: '/inbox/summary', params: { computer: entry.computerId, id: s.id } })
          }}
          style={{ paddingVertical: 11 }}
        >
          <Sparkles size={15} color={c.muted} />
          <T
            numberOfLines={2}
            weight={s.status === 'unread' ? '600' : '400'}
            tone={s.status === 'unread' ? 'text' : 'soft'}
            style={{ flex: 1 }}
          >
            {s.headline}
          </T>
          <T size={font.caption} tone="muted">
            {`${s.items.length} ${t.changesN}`}
          </T>
          {s.status === 'unread' ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c.accent }} />
          ) : (
            <T size={font.caption} tone="muted">
              {ago(s.periodEnd)}
            </T>
          )}
        </Row>
      </View>
    )
  }
  // Notices a computer keeps for every device until the thread is looked at, as the old activity sheet listed them.
  const missed = store.computers
    .filter((pc) => !host || pc.id === host)
    .flatMap((pc) => (store.inbox[pc.id] ?? []).map((notice) => ({ pc, notice })))
  const missedSection = missed.length ? (
    <Section title={t.missed} count={missed.length}>
      <View>
        {missed.map(({ pc, notice }, index) => (
          <View key={`${pc.id}:${notice.id}`}>
            {index ? <Divider inset={ROW_INSET} /> : null}
            <Row
              onPress={() => {
                tap()
                store.dismissNotice(pc.id, notice.id)
                openThread(store.resolveChat(pc.id, notice.taskId))
              }}
              style={{ paddingVertical: 11 }}
            >
              <Bell size={16} color={c.warn} />
              <View style={{ flex: 1 }}>
                <T weight="500" numberOfLines={1}>
                  {notice.title}
                </T>
                <T size={font.caption} tone="muted" numberOfLines={1}>
                  {[multi ? pc.name : '', notice.body].filter(Boolean).join(' · ')}
                </T>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t.dismiss}
                hitSlop={8}
                onPress={() => store.dismissNotice(pc.id, notice.id)}
              >
                <X size={16} color={c.muted} />
              </Pressable>
            </Row>
          </View>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        hitSlop={8}
        onPress={() => store.computers.forEach((pc) => store.clearNotices(pc.id))}
        style={{ alignSelf: 'flex-end', paddingHorizontal: space.l, paddingTop: space.s }}
      >
        <T size={font.caption} weight="600" tone="accent">
          {t.clearAll}
        </T>
      </Pressable>
    </Section>
  ) : null
  const background = store.computers.flatMap((pc) =>
    (store.activity[pc.id] ?? []).map((item) => ({ computerId: pc.id, computer: pc.name, item })),
  )
  const say = useSay()
  const [stopping, setStopping] = useState<Set<string>>(() => new Set())
  // As on the desktop: only work whose owner can stop it safely offers Stop; the host's list then drops it.
  const stopActivity = (computerId: string, activityId: string) => {
    const key = `${computerId}:${activityId}`
    if (stopping.has(key)) return
    tap()
    setStopping((all) => new Set(all).add(key))
    void store
      .invoke(computerId, 'activity.cancel', activityId)
      .catch((error: unknown) => showToast(error instanceof Error ? error.message : String(error)))
      .finally(() =>
        setStopping((all) => {
          const next = new Set(all)
          next.delete(key)
          return next
        }),
      )
  }
  const recapsOn = store.computers.some((pc) => store.appPreferences[pc.id]?.recapsEnabled !== false)
  const generating = store.computers.some((pc) => auto.of(pc.id).recaps?.generating)
  const actions = useTabActions()

  const chips = INBOX_TABS.map((key) => ({
    key,
    label: tabLabel(key, t),
    count:
      key === 'brief'
        ? inbox.needsYou
        : key === 'running'
          ? inbox.running.length
          : key === 'learned'
            ? inbox.learnedCount
            : 0,
  }))

  const body = {
    brief: (
      <>
        <InboxBrief inbox={inbox} where={(chat) => where(chat.computerId, chat.projectId)} />
        {missedSection}
      </>
    ),
    running: (
      <>
        {inbox.running.length ? (
          rows(inbox.running)
        ) : !background.length ? (
          <Nothing icon={Loader} title={t.noAgentsRunning} detail={t.noAgentsRunningHint} />
        ) : null}
        {background.length ? (
          <Section title={t.onComputer}>
            <View>
              {background.map(({ computerId, computer, item }, index) => (
                <View key={`${computerId}:${item.id}`}>
                  {index ? <Divider inset={ROW_INSET} /> : null}
                  <Row disabled style={{ paddingVertical: 11 }}>
                    <Activity size={16} color={c.soft} />
                    <View style={{ flex: 1 }}>
                      <T weight="500" numberOfLines={1}>
                        {say(item.label)}
                      </T>
                      <T size={font.caption} tone="muted" numberOfLines={1}>
                        {[multi ? computer : '', item.detail].filter(Boolean).join(' · ')}
                      </T>
                    </View>
                    {item.cancellable && store.isOnline(computerId) ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={say('Stop {0}', { 0: say(item.label) })}
                        disabled={stopping.has(`${computerId}:${item.id}`)}
                        hitSlop={8}
                        onPress={() => stopActivity(computerId, item.id)}
                      >
                        <T size={font.caption} weight="600" tone="accent">
                          {stopping.has(`${computerId}:${item.id}`) ? say('Stopping…') : say('Stop')}
                        </T>
                      </Pressable>
                    ) : null}
                  </Row>
                </View>
              ))}
            </View>
          </Section>
        ) : null}
      </>
    ),
    learned:
      inbox.summaries.length || inbox.learningReviews.length ? (
        <>
          {inbox.learningReviews.length ? (
            <Section title={say('Waiting for you')} count={inbox.learningReviews.length}>
              <View>
                {inbox.learningReviews.map(({ computerId, job }, index) => (
                  <WaitingReviewRow
                    key={`${computerId}:${job.id}`}
                    computerId={computerId}
                    job={job}
                    host={multi ? computerName(computerId) : undefined}
                    divider={index > 0}
                  />
                ))}
              </View>
            </Section>
          ) : null}
          {inbox.summaries.length ? (
            inbox.learningReviews.length ? (
              <Section title={say('Summaries')}>
                <View>{inbox.summaries.map(summary)}</View>
              </Section>
            ) : (
              <View>{inbox.summaries.map(summary)}</View>
            )
          ) : null}
        </>
      ) : (
        <Nothing icon={Sparkles} title={t.noSummaries} detail={t.noSummariesHint} />
      ),
    completed: inbox.days.length ? (
      <>
        <ShipActivityList hostId={host} />
        {/* Recaps live on the threads they are about: each row's line says what it did, and refreshing them sits here. */}
        {recapsOn ? (
          <Row
            onPress={() => {
              tap()
              store.computers
                .filter((pc) => pc.status === 'online')
                .forEach((pc) => void auto.refreshRecaps(pc.id).catch(() => {}))
            }}
            style={{ paddingVertical: space.s }}
          >
            <RefreshCw size={14} color={c.muted} />
            <T size={font.control} tone="muted" style={{ flex: 1 }}>
              {generating ? t.updatingRecap : t.refresh}
            </T>
          </Row>
        ) : null}
        {inbox.days.map((day) => (
          <Section key={day.label} title={t[day.label]} count={day.items.length}>
            {rows(day.items)}
          </Section>
        ))}
      </>
    ) : (
      <>
        <ShipActivityList hostId={host} />
        <Nothing icon={InboxIcon} title={t.nothingFinished} detail={t.nothingFinishedHint} />
      </>
    ),
  }[tab]

  const content = (
    <>
      <Chips
        value={tab}
        onChange={choose}
        options={chips}
        lead={multi ? <HostChip all={allHosts} onAll={setAllHosts} /> : undefined}
      />
      {tab === 'brief' ? (
        // Schedules open from here, where what they make arrives, rather than taking a tab of their own.
        <Row
          accessibilityLabel={t.schedules}
          onPress={() => {
            tap()
            router.push('/schedules')
          }}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}
        >
          <CalendarClock size={16} color={c.muted} />
          <T style={{ flex: 1 }}>{t.schedules}</T>
          <ChevronRight size={16} color={c.muted} />
        </Row>
      ) : null}
      {body}
    </>
  )
  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.muted} />

  if (pane)
    return (
      <ListPane title={t.inbox}>
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.l }} refreshControl={refreshControl}>
          {content}
        </ScrollView>
      </ListPane>
    )
  return (
    // Threads opened from here keep the Inbox beside them on a wide window.
    <ThreadOrigin value="inbox">
      <Screen>
        <Header back={false} large scrollEdge collapsed={edge.scrolled} title={t.inbox} right={actions} />
        <PageScrollView
          fullWidth
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingBottom: space.xl * 2 }}
          onScroll={edge.onScroll}
          scrollEventThrottle={16}
          refreshControl={refreshControl}
        >
          <LargeTitle>{t.inbox}</LargeTitle>
          {content}
        </PageScrollView>
        {Platform.OS === 'ios' ? null : <TopFade visible={edge.scrolled} />}
      </Screen>
    </ThreadOrigin>
  )
}
