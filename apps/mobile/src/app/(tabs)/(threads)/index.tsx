import { translate } from '@ramu/shared/i18n'
import { recentThreads } from '../../../runtime/recentThreads'
import { groupThreads, splitDone, type ThreadGroup } from '../../../runtime/threadGroups'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackHandler, Platform, Pressable, ScrollView as HScroll, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Folder,
  FolderGit2,
  Network,
  MessagesSquare,
  Search,
  Gauge,
  SquarePen,
  Ellipsis,
  WifiOff,
  Clock,
  X,
  Archive,
  Check,
  CircleCheck,
  Trash2,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useStore, type OutboxItem } from '../../../runtime/store'
import { STANDALONE, type Chat, type MobileProject } from '../../../runtime/types'
import { ago, useT } from '../../../i18n'
import { Header, HeaderButton, LargeTitle, Screen, useScrolledUnderBar, PageFlatList } from '../../../components/Screen'
import { PlanUsageSheet } from '../../../components/PlanUsage'
import { ChatRow } from '../../../components/ChatRow'
import { ProjectActionsSheet } from '../../../components/ChatActions'
import { Disclosure, animateLayout } from '../../../components/Motion'
import { Chip, ConnectionDot, IconButton, Row, SectionLabel, Sheet, T, tap } from '../../../components/ui'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { confirmCancel } from '../../../components/Outbox'
import { TopFade } from '../../../components/Glass'
import { useTabActions } from '../../../components/Overlays'
import { ComputerSwitcher } from '../../../components/ComputerSwitcher'
import { useBulkThreadActions } from '../../../components/BulkThreadActions'
import { threadSelection, useThreadSelection } from '../../../runtime/threadSelection'

type Position = { first?: boolean; last?: boolean; gap?: number }
type HomeRow = { key: string } & Position &
  (
    | { kind: 'label'; text: string; right?: string }
    | { kind: 'outbox'; o: OutboxItem }
    | { kind: 'chat'; chat: Chat; project?: string; divider?: boolean }
    | { kind: 'project'; group: ThreadGroup<Chat, MobileProject>; closed: boolean }
    | { kind: 'done'; count: number; closed: boolean }
    // `group` set: show the rest of one project (or fewer again); unset: more of the flat filtered list.
    | { kind: 'more'; group?: string; hidden?: number }
  )

/** Newest threads each project shows before "Show more"; running, waiting and failed ones always show. */
const PER_PROJECT = 3
/** Done threads shown once the Done card is opened, before "Show more". */
const DONE_PAGE = 10
const DONE_KEY = 'section:done'

export default function Threads() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const edge = useScrolledUnderBar(40)
  const store = useStore()
  const { chats, projects, selected, computers, outbox: allOutbox, cancelOutbox, select } = store
  // With several hosts the list merges all of them by default; picking one host shows just that host.
  const multi = computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const merged = multi && allHosts
  const [hostSheet, setHostSheet] = useState(false)
  // A message being delivered to a connected computer is in the outbox for a moment; only stuck ones (offline or uncertain) belong here.
  const outbox = allOutbox.filter(
    (o) =>
      o.state !== 'accepted' &&
      (merged || o.computerId === selected) &&
      (o.state === 'uncertain' || computers.find((x) => x.id === o.computerId)?.status !== 'online'),
  )
  const [historyLimit, setHistoryLimit] = useState(20)
  const pc = computers.find((x) => x.id === selected)
  const actions = useTabActions()
  const selection = useThreadSelection()
  const bulk = useBulkThreadActions()
  const picked = useMemo(() => chats.filter((chat) => selection.ids.has(chat.id)), [chats, selection.ids])
  // Deleted threads leave the selection; leaving the tab ends selecting.
  useEffect(() => threadSelection.keep(new Set(chats.map((chat) => chat.id))), [chats])
  useFocusEffect(useCallback(() => () => threadSelection.clear(), []))
  useEffect(() => {
    if (!selection.on) return
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      threadSelection.clear()
      return true
    })
    return () => back.remove()
  }, [selection.on])
  const [usageOpen, setUsageOpen] = useState(false)

  type StatusFilter = 'all' | 'running' | 'needs-input' | 'failed' | 'archived'
  const { filter: initialFilter } = useLocalSearchParams<{ filter?: string }>()
  const [filter, setFilter] = useState<StatusFilter>(initialFilter === 'archived' ? 'archived' : 'all')
  const [projectMenu, setProjectMenu] = useState<MobileProject | null>(null)
  // Folded projects and projects showing all their threads, by group key (host + project).
  // Done starts folded, as on the desktop: finished work stays reachable without crowding the projects.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set([DONE_KEY]))
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  const toggle = (set: typeof setCollapsed, key: string) => {
    tap()
    animateLayout()
    set((current) => {
      const next = new Set(current)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }
  const projectList = projects.filter((p) => merged || p.computerId === selected)
  const nameOf = (id: string) => projectList.find((p) => p.id === id)?.name
  // `project · host`, the same label every list uses; the host only appears once there is more than one.
  const labelOf = (chat: Chat) =>
    [
      chat.projectId === STANDALONE
        ? undefined
        : projects.find((p) => p.computerId === chat.computerId && p.id === chat.projectId)?.name,
      multi ? computers.find((x) => x.id === chat.computerId)?.name : undefined,
    ]
      .filter(Boolean)
      .join(' · ') || undefined
  const scoped = useMemo(() => chats.filter((x) => merged || x.computerId === selected), [chats, selected, merged])
  const mine = useMemo(() => {
    return scoped
      .filter((x) =>
        filter === 'archived'
          ? x.status === 'archived'
          : x.status !== 'archived' && (filter === 'all' || x.status === filter),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [scoped, filter])
  const filtering = filter !== 'all'
  // A thread marked done leaves its project (and Pinned) for one Done card at the bottom; archived ones list as they are.
  const { open, done } = useMemo(
    () => (filter === 'archived' ? { open: mine, done: [] } : splitDone(mine)),
    [mine, filter],
  )
  const pinned = open
    .filter((x) => x.pinnedAt !== null && filter !== 'archived')
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
  const unpinned = open.filter((x) => !pinned.includes(x))
  const live = scoped.filter((x) => x.status !== 'archived')
  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: t.homeAll, count: live.length },
    { key: 'running', label: t.homeRunning, count: live.filter((x) => x.status === 'running').length },
    { key: 'needs-input', label: t.homeWaiting, count: live.filter((x) => x.status === 'needs-input').length },
    { key: 'failed', label: t.homeFailed, count: live.filter((x) => x.status === 'failed').length },
    { key: 'archived', label: t.homeArchived, count: scoped.filter((x) => x.status === 'archived').length },
  ]

  // One flat, virtualized list: labels, outbox items, chats and project headers are each a row, drawn as rounded groups.
  const rows = useMemo(() => {
    const out: HomeRow[] = []
    const group = (key: string, items: HomeRow[], gap = 0) =>
      items.forEach((row, i) =>
        out.push({
          ...row,
          key: `${key}:${row.key}`,
          first: i === 0,
          last: i === items.length - 1,
          gap: i === 0 ? gap : 0,
        } as HomeRow),
      )
    if (outbox.length && !filtering) {
      out.push({ key: 'label:outbox', kind: 'label', text: `${t.outbox} ${outbox.length}`, right: 'sends when online' })
      group(
        'outbox',
        outbox.map((o) => ({ key: o.id, kind: 'outbox', o }) as HomeRow),
      )
    }
    if (pinned.length) {
      out.push({ key: 'label:pinned', kind: 'label', text: 'Pinned' })
      group(
        'pinned',
        pinned.map(
          (x, i) =>
            ({
              key: x.id,
              kind: 'chat',
              chat: x,
              project: merged ? labelOf(x) : nameOf(x.projectId),
              divider: i > 0,
            }) as HomeRow,
        ),
      )
    }
    if (filtering) {
      // A status filter answers "which threads are …?", so its results are one flat list labelled by project.
      const recent = recentThreads(unpinned, historyLimit)
      if (recent.threads.length) {
        out.push({
          key: 'label:recent',
          kind: 'label',
          text: chips.find((chip) => chip.key === filter)?.label ?? t.homeAll,
        })
        group(
          'recent',
          recent.threads.map(
            (chat, i) => ({ key: chat.id, kind: 'chat', chat, project: labelOf(chat), divider: i > 0 }) as HomeRow,
          ),
        )
        if (recent.more) group('more', [{ key: 'more', kind: 'more' }])
      }
      return out
    }
    // Otherwise each project is its own card, the most recently active first, so its menu and new-thread action are always one tap away.
    const groups = groupThreads(unpinned, projectList, { limit: PER_PROJECT, expanded, collapsed })
    if (groups.length) out.push({ key: 'label:projects', kind: 'label', text: t.projects })
    groups.forEach((g, index) => {
      const closed = collapsed.has(g.key)
      group(
        `group:${g.key}`,
        [
          { key: 'head', kind: 'project', group: g, closed } as HomeRow,
          ...g.threads.map((chat) => ({ key: chat.id, kind: 'chat', chat, divider: true }) as HomeRow),
          ...(!closed && (g.hidden || (expanded.has(g.key) && g.total > PER_PROJECT))
            ? [{ key: 'more', kind: 'more', group: g.key, hidden: g.hidden } as HomeRow]
            : []),
        ],
        index ? space.m : 0,
      )
    })
    if (done.length) {
      const closed = collapsed.has(DONE_KEY)
      const all = expanded.has(DONE_KEY)
      const shown = closed ? [] : all ? done : done.slice(0, DONE_PAGE)
      group(
        'done',
        [
          { key: 'head', kind: 'done', count: done.length, closed } as HomeRow,
          ...shown.map(
            (chat) => ({ key: chat.id, kind: 'chat', chat, project: labelOf(chat), divider: true }) as HomeRow,
          ),
          ...(!closed && done.length > DONE_PAGE
            ? [{ key: 'more', kind: 'more', group: DONE_KEY, hidden: all ? 0 : done.length - DONE_PAGE } as HomeRow]
            : []),
        ],
        groups.length ? space.m : 0,
      )
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [mount only] by design; the values it reads beyond these are current as of that run
  }, [
    outbox,
    pinned,
    unpinned,
    done,
    projectList,
    historyLimit,
    filtering,
    filter,
    merged,
    projects,
    computers,
    collapsed,
    expanded,
    t,
    scoped,
    store.language,
  ])
  const newChat = (projectId: string) => router.push({ pathname: '/new', params: { project: projectId } })
  const renderRow = (row: HomeRow) => {
    if (row.kind === 'label')
      return (
        <SectionLabel
          right={
            row.right ? (
              <T size={font.caption} tone="muted">
                {row.right}
              </T>
            ) : undefined
          }
        >
          {translate(store.language, row.text)}
        </SectionLabel>
      )
    const body =
      row.kind === 'outbox' ? (
        (() => {
          const chat = chats.find((x) => x.id === row.o.chatId)
          return (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Row
                onPress={() => router.push({ pathname: '/chat/[id]', params: { id: row.o.chatId } })}
                style={{ paddingVertical: 10, flex: 1 }}
              >
                <Clock size={16} color={c.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={font.body} weight="500" numberOfLines={1}>
                    {row.o.kind === 'chat'
                      ? `New thread · ${nameOf(chat?.projectId ?? '') ?? 'Standalone'}`
                      : chat?.title}
                  </T>
                  <T size={font.control} tone="muted" numberOfLines={1}>
                    {row.o.text}
                  </T>
                </View>
              </Row>
              {/* Beside the row, not inside it: a pressable row hides its children from VoiceOver. */}
              <View style={{ paddingRight: space.s }}>
                <IconButton
                  icon={X}
                  label={t.cancel}
                  size={32}
                  tone="muted"
                  onPress={() => confirmCancel(row.o, undefined, cancelOutbox)}
                />
              </View>
            </View>
          )
        })()
      ) : row.kind === 'chat' ? (
        <ChatRow chat={row.chat} project={row.project} divider={row.divider} selectable />
      ) : row.kind === 'done' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate(store.language, 'Done')}
          accessibilityState={{ expanded: !row.closed }}
          onPress={() => toggle(setCollapsed, DONE_KEY)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingHorizontal: space.l,
            minHeight: 50,
            backgroundColor: pressed ? c.pressed : 'transparent',
          })}
        >
          <CircleCheck size={16} color={c.soft} strokeWidth={1.8} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <T weight="600">{translate(store.language, 'Done')}</T>
              <Disclosure open={!row.closed} size={13} color={c.muted} />
            </View>
            {row.closed ? (
              <T size={font.caption} tone="muted">
                {translate(store.language, '{count} threads', { count: row.count })}
              </T>
            ) : null}
          </View>
        </Pressable>
      ) : row.kind === 'more' ? (
        <Row
          onPress={() => (row.group ? toggle(setExpanded, row.group) : setHistoryLimit((limit) => limit + 20))}
          style={{ paddingVertical: 11 }}
        >
          <T size={font.control} tone="muted">
            {row.group
              ? row.hidden
                ? translate(store.language, 'Show {count} more', { count: row.hidden })
                : translate(store.language, 'Show fewer')
              : translate(store.language, 'Show more threads')}
          </T>
        </Row>
      ) : (
        (() => {
          const { group: g, closed } = row
          const p = g.project
          const name =
            p?.name ?? (g.projectId === STANDALONE ? t.standalone : translate(store.language, 'Unknown project'))
          const host = merged ? computers.find((x) => x.id === g.computerId)?.name : undefined
          const detail = [
            host,
            p?.kind === 'workspace' ? translate(store.language, '{count} repos', { count: p.repos.length }) : undefined,
          ]
            .filter(Boolean)
            .join(' · ')
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={name}
              accessibilityState={{ expanded: !closed }}
              accessibilityHint={p ? translate(store.language, 'Long press for project actions') : undefined}
              onPress={() => toggle(setCollapsed, g.key)}
              onLongPress={
                p
                  ? () => {
                      tap()
                      setProjectMenu(p)
                    }
                  : undefined
              }
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                paddingLeft: space.l,
                paddingRight: space.s,
                minHeight: 50,
                backgroundColor: pressed ? c.pressed : 'transparent',
              })}
            >
              {p?.kind === 'workspace' ? (
                <Folder size={16} color={c.soft} strokeWidth={1.8} />
              ) : p ? (
                <FolderGit2 size={16} color={c.soft} strokeWidth={1.8} />
              ) : (
                <MessagesSquare size={16} color={c.soft} strokeWidth={1.8} />
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                {/* The chevron follows the name, as a section disclosure, so the trailing edge keeps only actions. */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
                  <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {name}
                  </T>
                  <Disclosure open={!closed} size={13} color={c.muted} />
                </View>
                {detail || closed ? (
                  <T size={font.caption} tone="muted" numberOfLines={1}>
                    {/* Folded, the subtitle says what is hidden and whether something inside needs you or is working. */}
                    {[
                      detail,
                      closed && g.attention ? `${g.attention} ${t.homeWaiting}` : undefined,
                      closed && g.running ? `${g.running} ${t.homeRunning}` : undefined,
                      closed && !g.attention && !g.running && g.total
                        ? translate(store.language, '{count} threads', { count: g.total })
                        : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ') || translate(store.language, 'No threads yet')}
                  </T>
                ) : null}
              </View>
              {p ? (
                <>
                  {/* Files, terminal, rename and the rest live in the project menu, which long-press also opens. */}
                  <IconButton
                    icon={Ellipsis}
                    label={`${t.projectActions} · ${p.name}`}
                    size={32}
                    tone="muted"
                    onPress={() => setProjectMenu(p)}
                  />
                  <IconButton
                    icon={SquarePen}
                    label={translate(store.language, 'New thread in {project}', { project: p.name })}
                    size={32}
                    tone="muted"
                    onPress={() => newChat(p.id)}
                  />
                </>
              ) : null}
            </Pressable>
          )
        })()
      )
    const round = radius.l
    return (
      <View
        style={{
          marginHorizontal: space.l,
          marginTop: row.gap,
          backgroundColor: c.raised2,
          overflow: 'hidden',
          borderTopLeftRadius: row.first ? round : 0,
          borderTopRightRadius: row.first ? round : 0,
          borderBottomLeftRadius: row.last ? round : 0,
          borderBottomRightRadius: row.last ? round : 0,
        }}
      >
        {body}
      </View>
    )
  }

  const say = (text: string, values?: Record<string, string | number>) => translate(store.language, text, values)
  const header = selection.on ? (
    <Header
      back={false}
      title={picked.length ? say('{0} selected', { 0: picked.length }) : say('Select threads')}
      right={
        <>
          {bulk.writable(picked) ? (
            <>
              <HeaderButton
                actionId="select-done"
                icon={Check}
                label={say('Mark selected done')}
                systemIcon="checkmark.circle"
                onPress={() => void bulk.markDone(picked)}
              />
              <HeaderButton
                actionId="select-archive"
                icon={Archive}
                label={say('Archive selected')}
                systemIcon="archivebox"
                onPress={() => void bulk.archive(picked)}
              />
              <HeaderButton
                actionId="select-delete"
                icon={Trash2}
                label={say('Delete selected…')}
                systemIcon="trash"
                onPress={() => void bulk.remove(picked)}
              />
            </>
          ) : null}
          <HeaderButton
            actionId="select-cancel"
            icon={X}
            label={say('Cancel selection')}
            systemIcon="xmark"
            onPress={() => threadSelection.clear()}
          />
        </>
      }
    />
  ) : null
  return (
    <Screen>
      {header ?? (
        <Header
          back={false}
          large
          scrollEdge
          collapsed={edge.scrolled}
          title={t.chats}
          right={
            <>
              {computers.some(
                (host) =>
                  (merged || host.id === selected) && store.appPreferences?.[host.id]?.showUsageLimits !== false,
              ) ? (
                <HeaderButton
                  actionId="tab-usage"
                  icon={Gauge}
                  label={store.language === 'id' ? 'Penggunaan paket' : 'Plan usage'}
                  systemIcon="gauge.with.dots.needle.50percent"
                  onPress={() => setUsageOpen(true)}
                />
              ) : null}
              {actions}
            </>
          }
        />
      )}
      <PageFlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => renderRow(row)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        initialNumToRender={14}
        windowSize={9}
        ListHeaderComponent={
          <>
            <LargeTitle>{t.chats}</LargeTitle>
            {merged ? null : <ComputerSwitcher />}
            {!merged && pc?.status === 'offline' ? (
              <View
                style={{
                  margin: space.l,
                  marginBottom: 0,
                  padding: space.m,
                  borderRadius: radius.m,
                  backgroundColor: c.fill,
                  flexDirection: 'row',
                  gap: space.m,
                }}
              >
                <WifiOff size={16} color={c.muted} />
                <T size={font.control} tone="muted" style={{ flex: 1, lineHeight: 19 }}>
                  {t.offlineHint}
                </T>
              </View>
            ) : null}

            {/* Filters appear once there is something to filter: another host, or threads in a second state. */}
            {multi || filtering || chips.some((chip) => chip.key !== 'all' && chip.count > 0) ? (
              <HScroll
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                style={{ flexGrow: 0 }}
                contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.m, gap: space.s }}
              >
                {multi ? (
                  <Chip
                    label={merged ? t.allHosts : (pc?.name ?? t.allHosts)}
                    accessibilityLabel={t.homeFilterHost}
                    icon={Network}
                    chevron
                    selected={!merged}
                    maxLabelWidth={150}
                    onPress={() => setHostSheet(true)}
                  />
                ) : null}
                {chips
                  .filter((chip) => chip.key === 'all' || chip.key === filter || chip.count > 0)
                  .map((chip) => (
                    <Chip
                      key={chip.key}
                      label={chip.label}
                      count={chip.count}
                      selected={filter === chip.key}
                      onPress={() => setFilter(chip.key)}
                    />
                  ))}
              </HScroll>
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
            {filtering && !mine.length ? (
              <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
                <Search size={26} color={c.placeholder} />
                <T tone="muted">{t.homeNoMatch}</T>
                <Pressable
                  onPress={() => {
                    tap()
                    setFilter('all')
                  }}
                >
                  <T tone="accent" weight="500">
                    {t.homeClearFilters}
                  </T>
                </Pressable>
              </View>
            ) : null}
            {!filtering && !mine.length && !projectList.length ? (
              <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
                <MessagesSquare size={28} color={c.placeholder} />
                <T tone="muted">{t.empty}</T>
              </View>
            ) : null}
          </>
        }
      />

      {Platform.OS === 'ios' ? null : <TopFade visible={edge.scrolled} />}
      {projectMenu ? <ProjectActionsSheet project={projectMenu} open onClose={() => setProjectMenu(null)} /> : null}
      <Sheet open={hostSheet} onClose={() => setHostSheet(false)} title={t.homeHost}>
        <SheetGroup>
          {[
            { id: null as string | null, name: t.allHosts },
            ...computers.map((x) => ({
              id: x.id as string | null,
              name: x.name,
              status: x.status,
              help: x.status === 'online' || !x.lastSeen ? t[x.status] : `${t[x.status]} · ${ago(x.lastSeen)}`,
            })),
          ].map((o) => (
            <SheetOption
              key={o.id ?? 'all'}
              icon={Network}
              title={o.name}
              help={'help' in o ? o.help : undefined}
              trailing={'status' in o ? <ConnectionDot status={o.status} /> : undefined}
              selected={o.id === null ? merged : !merged && o.id === selected}
              onPress={() => {
                if (o.id) select(o.id)
                setAllHosts(o.id === null)
                setHostSheet(false)
              }}
            />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetOption
            icon={SquarePen}
            title={t.pair}
            onPress={() => {
              setHostSheet(false)
              router.push('/pair')
            }}
          />
        </SheetGroup>
      </Sheet>
      <PlanUsageSheet
        hosts={merged ? computers.map((host) => host.id) : [selected]}
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
      />
    </Screen>
  )
}
