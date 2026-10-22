import { useMemo, useState } from 'react'
import { Platform, Pressable, ScrollView as HScroll, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Check,
  Folder,
  FolderGit2,
  Network,
  MessagesSquare,
  Search,
  SquarePen,
  SquareTerminal,
  WifiOff,
  Clock,
  X,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useStore, type OutboxItem } from '../../../runtime/store'
import { STANDALONE, type Chat, type MobileProject } from '../../../runtime/types'
import { useT } from '../../../i18n'
import { Header, LargeTitle, Screen, useScrolledUnderBar, PageFlatList } from '../../../components/Screen'
import { PlanUsageSummary } from '../../../components/PlanUsage'
import { ChatRow } from '../../../components/ChatRow'
import { ProjectActionsSheet } from '../../../components/ChatActions'
import { Disclosure, animateLayout } from '../../../components/Motion'
import { Chip, IconButton, Row, SectionLabel, Sheet, T, tap } from '../../../components/ui'
import { confirmCancel } from '../../../components/Outbox'
import { TopFade } from '../../../components/Glass'
import { useTabActions } from '../../../components/Overlays'
import { ComputerSwitcher } from '../../../components/ComputerSwitcher'

type Position = { first?: boolean; last?: boolean; gap?: number }
type HomeRow = { key: string } & Position &
  (
    | { kind: 'label'; text: string; right?: string }
    | { kind: 'outbox'; o: OutboxItem }
    | { kind: 'chat'; chat: Chat; project?: string; divider?: boolean }
    | { kind: 'project'; p: MobileProject; count: number; closed: boolean }
    | { kind: 'empty' }
  )

export default function Threads() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const edge = useScrolledUnderBar(40)
  const { chats, projects, selected, computers, outbox: allOutbox, cancelOutbox, select } = useStore()
  // With several hosts the list merges all of them by default; picking one host shows just that host.
  const multi = computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const merged = multi && allHosts
  const [hostSheet, setHostSheet] = useState(false)
  // A message being delivered to a connected computer is in the outbox for a moment; only stuck ones (offline or uncertain) belong here.
  const outbox = allOutbox.filter(
    (o) =>
      (merged || o.computerId === selected) &&
      (o.state === 'uncertain' || computers.find((x) => x.id === o.computerId)?.status !== 'online'),
  )
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pc = computers.find((x) => x.id === selected)
  const actions = useTabActions()

  type StatusFilter = 'all' | 'running' | 'needs-input' | 'failed' | 'archived'
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [scopeState, setScope] = useState<string | null>(null)
  // A workspace belongs to one host, so the filter only applies when a single host is shown.
  const scope = merged ? null : scopeState
  const [scopeSheet, setScopeSheet] = useState(false)
  const [projectMenu, setProjectMenu] = useState<MobileProject | null>(null)
  const projectList = projects.filter((p) => p.computerId === selected)
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
  const scoped = useMemo(
    () => chats.filter((x) => (merged || x.computerId === selected) && (!scope || x.projectId === scope)),
    [chats, selected, scope, merged],
  )
  const mine = useMemo(() => {
    return scoped
      .filter((x) =>
        filter === 'archived'
          ? x.status === 'archived'
          : x.status !== 'archived' && (filter === 'all' || x.status === filter),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [scoped, filter])
  const filtering = filter !== 'all' || scope !== null
  const pinned = mine
    .filter((x) => x.pinnedAt !== null && filter !== 'archived')
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
  const unpinned = mine.filter((x) => !pinned.includes(x))
  const standalone = unpinned.filter((x) => x.projectId === STANDALONE)
  const scopeName = scope ? (nameOf(scope) ?? t.homeWorkspace) : t.homeAllWorkspaces
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
    if (merged) {
      const recent = unpinned
      if (recent.length) {
        out.push({ key: 'label:recent', kind: 'label', text: filter === 'archived' ? 'Archived' : 'Recent' })
        group(
          'recent',
          recent.map((x, i) => ({ key: x.id, kind: 'chat', chat: x, project: labelOf(x), divider: i > 0 }) as HomeRow),
        )
      }
      return out
    }
    // The Projects heading only appears above at least one project (none yet: no empty section).
    const projectsLabel = out.length
    out.push({ key: 'label:projects', kind: 'label', text: filter === 'archived' ? 'Archived' : t.projects })
    for (const p of projectList.filter((p) => !scope || p.id === scope)) {
      const list = unpinned.filter((x) => x.projectId === p.id)
      if (filtering && !list.length) continue
      const closed = Boolean(collapsed[p.id])
      group(
        `project:${p.id}`,
        [
          { key: 'head', kind: 'project', p, count: list.length, closed } as HomeRow,
          ...(closed
            ? []
            : list.length
              ? list.map((x) => ({ key: x.id, kind: 'chat', chat: x, divider: true }) as HomeRow)
              : [{ key: 'empty', kind: 'empty' } as HomeRow]),
        ],
        space.m,
      )
    }
    if (out.length === projectsLabel + 1) out.splice(projectsLabel, 1)
    if (standalone.length) {
      out.push({ key: 'label:standalone', kind: 'label', text: t.standalone })
      group(
        'standalone',
        standalone.map((x, i) => ({ key: x.id, kind: 'chat', chat: x, divider: i > 0 }) as HomeRow),
      )
    }
    return out
  }, [
    outbox,
    pinned,
    unpinned,
    standalone,
    projectList,
    collapsed,
    filtering,
    filter,
    scope,
    merged,
    projects,
    computers,
    t,
  ])
  const newChat = (projectId: string) => router.push({ pathname: '/new', params: { project: projectId } })
  const openTerminal = (projectId: string) =>
    router.push({
      pathname: '/terminal',
      params: { computer: selected, ctx: `project:${projectId.slice(projectId.indexOf(':') + 1)}` },
    })
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
          {row.text}
        </SectionLabel>
      )
    const body =
      row.kind === 'outbox' ? (
        (() => {
          const chat = chats.find((x) => x.id === row.o.chatId)
          return (
            <Row
              onPress={() => router.push({ pathname: '/chat/[id]', params: { id: row.o.chatId } })}
              style={{ paddingVertical: 10 }}
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
              <IconButton
                icon={X}
                label={t.cancel}
                size={32}
                tone="muted"
                onPress={() => confirmCancel(row.o, undefined, cancelOutbox)}
              />
            </Row>
          )
        })()
      ) : row.kind === 'chat' ? (
        <ChatRow chat={row.chat} project={row.project} divider={row.divider} />
      ) : row.kind === 'project' ? (
        <Pressable
          onLongPress={() => {
            tap()
            setProjectMenu(row.p)
          }}
          onPress={() => {
            tap()
            animateLayout()
            setCollapsed((state) => ({ ...state, [row.p.id]: !row.closed }))
          }}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            paddingHorizontal: space.l,
            paddingVertical: 13,
            backgroundColor: pressed ? c.pressed : 'transparent',
          })}
        >
          {row.p.kind === 'workspace' ? (
            <Folder size={16} color={c.soft} strokeWidth={1.8} />
          ) : (
            <FolderGit2 size={16} color={c.soft} strokeWidth={1.8} />
          )}
          <T weight="600" style={{ flexShrink: 1 }} numberOfLines={1}>
            {row.p.name}
          </T>
          {row.p.kind === 'workspace' ? (
            <T size={font.caption} tone="muted">
              {row.p.repos.length} repos
            </T>
          ) : null}
          <View style={{ flex: 1 }} />
          <T size={font.caption} tone="muted">
            {row.count}
          </T>
          <IconButton
            icon={SquareTerminal}
            label={`Open terminal in ${row.p.name}`}
            size={30}
            tone="muted"
            onPress={() => openTerminal(row.p.id)}
          />
          <IconButton
            icon={SquarePen}
            label={`New thread in ${row.p.name}`}
            size={30}
            tone="muted"
            onPress={() => newChat(row.p.id)}
          />
          <Disclosure open={!row.closed} size={15} color={c.muted} />
        </Pressable>
      ) : (
        <T size={font.control} tone="muted" style={{ paddingHorizontal: space.l, paddingBottom: space.m }}>
          {t.empty}
        </T>
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

  return (
    <Screen>
      <Header
        back={false}
        large
        collapsed={edge.scrolled}
        title={t.chats}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <PlanUsageSummary actionOnly hostIds={merged ? computers.map((h) => h.id) : [selected]} />
            {actions}
          </View>
        }
      />
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
            <Row onPress={() => router.push('/explorer')}>
              <Folder size={17} color={c.soft} />
              <T size={font.control}>{t.browseFiles}</T>
            </Row>
            <PlanUsageSummary hostIds={merged ? computers.map((h) => h.id) : [selected]} />
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
              {merged ? null : (
                <Chip
                  label={scopeName}
                  accessibilityLabel={t.homeFilterWorkspace}
                  icon={Folder}
                  chevron
                  selected={scope !== null}
                  maxLabelWidth={150}
                  onPress={() => setScopeSheet(true)}
                />
              )}
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
                    setScope(null)
                  }}
                >
                  <T tone="accent" weight="500">
                    {t.homeClearFilters}
                  </T>
                </Pressable>
              </View>
            ) : null}
            {!filtering && !mine.length && (merged || !projectList.length) ? (
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
        {[
          { id: null as string | null, name: t.allHosts },
          ...computers.map((x) => ({ id: x.id as string | null, name: x.name })),
        ].map((o) => (
          <Row
            key={o.id ?? 'all'}
            onPress={() => {
              tap()
              if (o.id) {
                select(o.id)
                setScope(null)
              }
              setAllHosts(o.id === null)
              setHostSheet(false)
            }}
          >
            <Network size={17} color={c.soft} />
            <T
              style={{ flex: 1 }}
              weight={(o.id === null ? merged : !merged && o.id === selected) ? '600' : '400'}
              numberOfLines={1}
            >
              {o.name}
            </T>
            {(o.id === null ? merged : !merged && o.id === selected) ? (
              <Check size={16} color={c.accent} />
            ) : (
              <View style={{ width: 16 }} />
            )}
          </Row>
        ))}
        <Row
          onPress={() => {
            setHostSheet(false)
            router.push('/pair')
          }}
        >
          <SquarePen size={17} color={c.soft} />
          <T style={{ flex: 1 }}>{t.pair}</T>
        </Row>
      </Sheet>
      <Sheet open={scopeSheet} onClose={() => setScopeSheet(false)} title={t.homeWorkspace}>
        {[
          {
            id: null as string | null,
            name: t.homeAllWorkspaces,
            n: chats.filter((x) => x.computerId === selected && x.status !== 'archived').length,
          },
          ...projectList.map((p) => ({
            id: p.id as string | null,
            name: p.name,
            n: chats.filter((x) => x.projectId === p.id && x.status !== 'archived').length,
          })),
        ].map((o) => (
          <Row
            key={o.id ?? 'all'}
            onPress={() => {
              setScope(o.id)
              setScopeSheet(false)
            }}
          >
            <Folder size={17} color={c.soft} />
            <T style={{ flex: 1 }} weight={o.id === scope ? '600' : '400'} numberOfLines={1}>
              {o.name}
            </T>
            <T size={font.caption} tone="muted">
              {o.n}
            </T>
            {o.id === scope ? <Check size={16} color={c.accent} /> : <View style={{ width: 16 }} />}
          </Row>
        ))}
      </Sheet>
    </Screen>
  )
}
