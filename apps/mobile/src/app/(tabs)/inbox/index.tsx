import { useCallback, useState } from 'react'
import { Platform, Pressable, RefreshControl, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Activity, Bell, Inbox as InboxIcon, Loader, Newspaper, RefreshCw, Sparkles, X } from 'lucide-react-native'
import type { LibrarySummary } from '@ramu/shared/types'
import { font, space, useTheme } from '../../../theme'
import { useStore } from '../../../runtime/store'
import { OperatorSheet } from '../../../components/OperatorSheet'
import { useAutomation } from '../../../runtime/automation'
import { buildInbox, INBOX_TABS, inboxTabOf, type InboxChat, type InboxTab } from '../../../runtime/inbox'
import { STANDALONE, type Chat } from '../../../runtime/types'
import { ago, useSay, useT, type Strings } from '../../../i18n'
import { Header, LargeTitle, PageScrollView, Screen, useScrolledUnderBar } from '../../../components/Screen'
import { TopFade } from '../../../components/Glass'
import { InboxBrief } from '../../../components/InboxBrief'
import { InboxThread } from '../../../components/InputRequests'
import { Chips, Group, Nothing, RecapCard, Section } from '../../../components/InboxParts'
import { useTabActions } from '../../../components/Overlays'
import { Button, Row, T, tap } from '../../../components/ui'

// Remembered for the session, so coming back to the tab shows the chip you left it on.
let lastTab: InboxTab = 'brief'

function tabLabel(tab: InboxTab, t: Strings) {
  return {
    brief: t.tabBrief,
    running: t.tabRunning,
    recaps: t.tabRecaps,
    learned: t.tabLearned,
    completed: t.tabCompleted,
  }[tab]
}

export default function InboxScreen() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const store = useStore()
  const [operatorOpen, setOperatorOpen] = useState(false)
  const auto = useAutomation()
  const [hostFilter, setHostFilter] = useState<string | null>(null)
  const host = store.computers.some((pc) => pc.id === hostFilter) ? hostFilter : null
  const inbox = buildInbox({
    computerId: host,
    chats: store.chats,
    recaps: store.computers.flatMap((pc) =>
      (auto.of(pc.id).recaps?.items ?? []).map((item) => ({ computerId: pc.id, item })),
    ),
    summaries: store.computers.flatMap((pc) =>
      (auto.of(pc.id).summaries?.summaries ?? []).map((summary) => ({ computerId: pc.id, summary })),
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
  const chatOf = (computerId: string, taskId: string) =>
    store.chats.find((chat) => chat.computerId === computerId && chat.taskId === taskId)
  const projectName = (computerId: string, projectId: string) =>
    projectId === STANDALONE
      ? undefined
      : store.projects.find((p) => p.computerId === computerId && p.id === projectId)?.name
  const where = (computerId: string, projectId: string) =>
    [projectName(computerId, projectId), multi ? computerName(computerId) : undefined].filter(Boolean).join(' · ')
  const say = useSay()
  const rows = (list: InboxChat[]) => (
    <Group>
      {list.map((chat, i) => {
        const full = chat as Chat
        return (
          <InboxThread key={full.id} chat={full} project={where(full.computerId, full.projectId)} divider={i > 0} />
        )
      })}
    </Group>
  )
  const recap = (r: (typeof inbox.attention)[number], attention: boolean) => {
    const chat = chatOf(r.computerId, r.item.taskId)
    return (
      <RecapCard
        key={`${r.computerId}:${r.item.id}`}
        item={r.item}
        attention={attention}
        project={chat ? where(chat.computerId, chat.projectId) : undefined}
        onOpen={() => {
          if (chat) router.push({ pathname: '/chat/[id]', params: { id: chat.id } })
        }}
        choices
        onAct={(action, until) => auto.actRecap(r.computerId, r.item, action, until)}
      />
    )
  }
  const summary = (entry: { computerId: string; summary: LibrarySummary }) => {
    const { summary: s } = entry
    return (
      <Row
        key={`${entry.computerId}:${s.id}`}
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
    )
  }
  // Notices a computer keeps for every device until the thread is looked at, as the old activity sheet listed them.
  const missed = store.computers
    .filter((pc) => !host || pc.id === host)
    .flatMap((pc) => (store.inbox[pc.id] ?? []).map((notice) => ({ pc, notice })))
  const missedSection = missed.length ? (
    <Section title={t.missed} count={missed.length}>
      <Group>
        {missed.map(({ pc, notice }) => (
          <Row
            key={`${pc.id}:${notice.id}`}
            onPress={() => {
              tap()
              store.dismissNotice(pc.id, notice.id)
              router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(pc.id, notice.taskId) } })
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
        ))}
      </Group>
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
    (store.activity[pc.id] ?? []).map((item) => ({ computer: pc.name, item })),
  )
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
          : key === 'recaps'
            ? inbox.sinceVisit.length
            : key === 'learned'
              ? inbox.unreadSummaries
              : 0,
  }))

  const body = {
    brief: (
      <>
        <InboxBrief inbox={inbox} where={(chat) => where(chat.computerId, chat.projectId)} />
        {store.appPreferences[store.selected]?.operator ? (
          <View style={{ paddingHorizontal: space.l, paddingTop: space.m }}>
            <Button kind="secondary" title={say('Ask the Operator')} onPress={() => setOperatorOpen(true)} />
          </View>
        ) : null}
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
            <Group>
              {background.map(({ computer, item }) => (
                <Row key={`${computer}:${item.id}`} disabled style={{ paddingVertical: 11 }}>
                  <Activity size={16} color={c.soft} />
                  <View style={{ flex: 1 }}>
                    <T weight="500" numberOfLines={1}>
                      {item.label}
                    </T>
                    <T size={font.caption} tone="muted" numberOfLines={1}>
                      {[multi ? computer : '', item.detail].filter(Boolean).join(' · ')}
                    </T>
                  </View>
                </Row>
              ))}
            </Group>
          </Section>
        ) : null}
      </>
    ),
    recaps: (
      <>
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
        {inbox.sinceVisit.length ? (
          <Section title={t.sinceVisit} count={inbox.sinceVisit.length}>
            {inbox.sinceVisit.map((r) => recap(r, false))}
          </Section>
        ) : null}
        {inbox.earlier.length ? (
          <Section title={t.earlier} count={inbox.earlier.length}>
            {inbox.earlier.map((r) => recap(r, false))}
          </Section>
        ) : null}
        {!inbox.recent.length ? (
          <Nothing icon={Newspaper} title={t.noRecaps} detail={recapsOn ? t.noRecapsHint : t.recapsOff} />
        ) : null}
      </>
    ),
    learned: inbox.summaries.length ? (
      <Group>{inbox.summaries.map(summary)}</Group>
    ) : (
      <Nothing icon={Sparkles} title={t.noSummaries} detail={t.noSummariesHint} />
    ),
    completed: inbox.days.length ? (
      <>
        {inbox.days.map((day) => (
          <Section key={day.label} title={t[day.label]} count={day.items.length}>
            {rows(day.items)}
          </Section>
        ))}
      </>
    ) : (
      <Nothing icon={InboxIcon} title={t.nothingFinished} detail={t.nothingFinishedHint} />
    ),
  }[tab]

  return (
    <Screen>
      <Header back={false} large scrollEdge collapsed={edge.scrolled} title={t.inbox} right={actions} />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={c.muted} />}
      >
        <LargeTitle>{t.inbox}</LargeTitle>
        {multi ? (
          <Chips
            value={host ?? ''}
            onChange={(id) => setHostFilter(id || null)}
            options={[
              { key: '', label: t.allHosts },
              ...store.computers.map((pc) => ({ key: pc.id, label: pc.name, status: pc.status })),
            ]}
          />
        ) : null}
        <Chips value={tab} onChange={choose} options={chips} />
        {body}
      </PageScrollView>
      {Platform.OS === 'ios' ? null : <TopFade visible={edge.scrolled} />}
      <OperatorSheet open={operatorOpen} onClose={() => setOperatorOpen(false)} />
    </Screen>
  )
}
