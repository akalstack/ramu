import { useMemo, useState } from 'react'
import { Pressable, ScrollView as HScroll, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import {
  Bell,
  BellDot,
  Check,
  ChevronDown,
  Folder,
  FolderGit2,
  MessagesSquare,
  Monitor,
  Search,
  Settings,
  SquarePen,
  SquareTerminal,
  WifiOff,
  Clock,
  X,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../theme'
import { counts, useStore, type OutboxItem } from '../runtime/store'
import { STANDALONE, type Chat, type MobileProject } from '../runtime/types'
import { useT } from '../i18n'
import {
  Header,
  HeaderButton,
  LargeTitle,
  Screen,
  nativeScrollEdge,
  useScrolledUnderBar,
  PageFlatList,
} from '../components/Screen'
import { ChatRow } from '../components/ChatRow'
import { ProjectActionsSheet } from '../components/ChatActions'
import { Disclosure, animateLayout } from '../components/Motion'
import { openActivity, useActivitySummary } from '../components/ActivityTray'
import { ConnectionDot, IconButton, Row, SectionLabel, Sheet, T, tap } from '../components/ui'
import { confirmCancel } from '../components/Outbox'
import { BottomFade, Glass, GlassGroup, TopFade, floatingChrome } from '../components/Glass'
import { KeyboardLift, useKeyboardHeight } from '../components/Keyboard'

type Position = { first?: boolean; last?: boolean; gap?: number }
type HomeRow = { key: string } & Position &
  (
    | { kind: 'label'; text: string; right?: string }
    | { kind: 'outbox'; o: OutboxItem }
    | { kind: 'chat'; chat: Chat; project?: string; divider?: boolean }
    | { kind: 'project'; p: MobileProject; count: number; closed: boolean }
    | { kind: 'empty' }
  )

function ComputerSwitcher() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const { computers, chats, selected } = useStore()
  const pc = computers.find((x) => x.id === selected)
  const n = counts(chats, selected)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t.computers}
      onPress={() => {
        tap()
        router.push('/computers')
      }}
      style={({ pressed }) => ({
        marginHorizontal: space.l,
        marginTop: space.s,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.m,
        padding: space.m,
        borderRadius: radius.m,
        backgroundColor: pressed ? c.raised : c.raised2,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.s + 2,
          backgroundColor: c.fill,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Monitor size={17} color={c.soft} strokeWidth={1.8} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T weight="600" numberOfLines={1}>
            {pc?.name ?? t.pair}
          </T>
          {pc ? <ConnectionDot status={pc.status} /> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {pc ? pc.address.replace(/^https?:\/\//, '') : ''}
          </T>
          {n.running ? <T size={font.caption} weight="600" tone="accent">{`· ${n.running} ${t.running}`}</T> : null}
          {n.waiting ? <T size={font.caption} weight="600" tone="warn">{`· ${n.waiting} ${t.waiting}`}</T> : null}
        </View>
      </View>
      <ChevronDown size={16} color={c.muted} />
    </Pressable>
  )
}

export default function Home() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  const edge = useScrolledUnderBar(40)
  const { chats, projects, selected, computers, outbox: allOutbox, cancelOutbox } = useStore()
  // A message being delivered to a connected computer is in the outbox for a moment; only stuck ones (offline or uncertain) belong here.
  const outbox = allOutbox.filter(
    (o) =>
      o.computerId === selected &&
      (o.state === 'uncertain' || computers.find((x) => x.id === selected)?.status !== 'online'),
  )
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const pc = computers.find((x) => x.id === selected)
  // New chats work offline too: they wait in the outbox. Only a revoked pairing blocks them.
  const online = !!pc && pc.status !== 'revoked'

  type StatusFilter = 'all' | 'running' | 'needs-input' | 'failed' | 'archived'
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [scope, setScope] = useState<string | null>(null)
  const [scopeSheet, setScopeSheet] = useState(false)
  const [terminalSheet, setTerminalSheet] = useState(false)
  const activity = useActivitySummary()
  const [newSheet, setNewSheet] = useState(false)
  const [projectMenu, setProjectMenu] = useState<MobileProject | null>(null)
  const projectList = projects.filter((p) => p.computerId === selected)
  const nameOf = (id: string) => projectList.find((p) => p.id === id)?.name
  const scoped = useMemo(
    () => chats.filter((x) => x.computerId === selected && (!scope || x.projectId === scope)),
    [chats, selected, scope],
  )
  const mine = useMemo(() => {
    const q = query.trim().toLowerCase()
    return scoped
      .filter(
        (x) =>
          (filter === 'archived'
            ? x.status === 'archived'
            : x.status !== 'archived' && (filter === 'all' || x.status === filter)) &&
          (!q ||
            x.title.toLowerCase().includes(q) ||
            x.preview.toLowerCase().includes(q) ||
            (nameOf(x.projectId) ?? '').toLowerCase().includes(q)),
      )
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  }, [scoped, filter, query, projectList])
  const filtering = Boolean(query) || filter !== 'all' || scope !== null
  const pinned = mine
    .filter((x) => x.pinnedAt !== null && filter !== 'archived')
    .sort((a, b) => b.pinnedAt! - a.pinnedAt!)
  const unpinned = mine.filter((x) => !pinned.includes(x))
  const waiting = mine.filter((x) => x.status === 'needs-input')
  const standalone = unpinned.filter((x) => x.projectId === STANDALONE)
  const scopeName = scope ? (nameOf(scope) ?? 'Workspace') : 'All workspaces'
  const live = scoped.filter((x) => x.status !== 'archived')
  const chips: { key: StatusFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: live.length },
    { key: 'running', label: 'Running', count: live.filter((x) => x.status === 'running').length },
    { key: 'needs-input', label: 'Needs you', count: live.filter((x) => x.status === 'needs-input').length },
    { key: 'failed', label: 'Failed', count: live.filter((x) => x.status === 'failed').length },
    { key: 'archived', label: 'Archived', count: scoped.filter((x) => x.status === 'archived').length },
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
    if (waiting.length && !filtering) {
      out.push({ key: 'label:waiting', kind: 'label', text: t.needsYou })
      group(
        'waiting',
        waiting.map(
          (x, i) => ({ key: x.id, kind: 'chat', chat: x, project: nameOf(x.projectId), divider: i > 0 }) as HomeRow,
        ),
      )
    }
    if (pinned.length) {
      out.push({ key: 'label:pinned', kind: 'label', text: 'Pinned' })
      group(
        'pinned',
        pinned.map(
          (x, i) => ({ key: x.id, kind: 'chat', chat: x, project: nameOf(x.projectId), divider: i > 0 }) as HomeRow,
        ),
      )
    }
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
    if (standalone.length) {
      out.push({ key: 'label:standalone', kind: 'label', text: t.standalone })
      group(
        'standalone',
        standalone.map((x, i) => ({ key: x.id, kind: 'chat', chat: x, divider: i > 0 }) as HomeRow),
      )
    }
    return out
  }, [outbox, waiting, pinned, unpinned, standalone, projectList, collapsed, filtering, filter, scope, t])
  const newChat = (projectId: string) => router.push({ pathname: '/new', params: { project: projectId } })
  // The floating button asks for the project here on Home, before the composer opens.
  const startChat = () => {
    tap()
    setNewSheet(true)
  }
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
                label="Cancel"
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
        title={t.workspaces}
        right={
          <>
            <HeaderButton
              icon={activity.missed.length || activity.waiting.length ? BellDot : Bell}
              label={activity.count ? `Activity, ${activity.count}` : 'Activity'}
              systemIcon={activity.missed.length || activity.waiting.length ? 'bell.badge' : 'bell'}
              onPress={openActivity}
            />
            <HeaderButton
              icon={SquareTerminal}
              label="Terminal"
              onPress={() => {
                // One project in view opens its shell directly; otherwise pick where it should run.
                const choices = projectList.filter((p) => !scope || p.id === scope)
                if (choices.length === 1) openTerminal(choices[0]!.id)
                else setTerminalSheet(true)
              }}
            />
            <HeaderButton icon={Settings} label={t.settings} onPress={() => router.push('/settings')} />
          </>
        }
      />
      <PageFlatList
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => renderRow(row)}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: insets.bottom + 96 + keyboard.height }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        initialNumToRender={14}
        windowSize={9}
        ListHeaderComponent={
          <>
            <LargeTitle>{t.workspaces}</LargeTitle>
            <ComputerSwitcher />
            {pc?.status === 'offline' ? (
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
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Filter by workspace"
                onPress={() => {
                  tap()
                  setScopeSheet(true)
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 5,
                  height: 34,
                  paddingHorizontal: space.m,
                  borderRadius: radius.full,
                  backgroundColor: scope ? c.accentWash : c.raised2,
                }}
              >
                <Folder size={14} color={scope ? c.accent : c.soft} />
                <T
                  size={font.control}
                  weight="500"
                  tone={scope ? 'accent' : 'text'}
                  numberOfLines={1}
                  style={{ maxWidth: 150 }}
                >
                  {scopeName}
                </T>
                <ChevronDown size={13} color={c.muted} />
              </Pressable>
              {chips
                .filter((chip) => chip.key === 'all' || chip.key === filter || chip.count > 0)
                .map((chip) => (
                  <Pressable
                    key={chip.key}
                    accessibilityRole="button"
                    accessibilityState={{ selected: filter === chip.key }}
                    onPress={() => {
                      tap()
                      setFilter(chip.key)
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      height: 34,
                      paddingHorizontal: space.m,
                      borderRadius: radius.full,
                      backgroundColor: filter === chip.key ? c.primary : c.raised2,
                    }}
                  >
                    <T
                      size={font.control}
                      weight="500"
                      style={{ color: filter === chip.key ? c.primaryInk : undefined }}
                      tone="text"
                    >
                      {chip.label}
                    </T>
                    {chip.count ? (
                      <T
                        size={font.caption}
                        style={{ color: filter === chip.key ? c.primaryInk : undefined, opacity: 0.7 }}
                        tone="text"
                      >
                        {chip.count}
                      </T>
                    ) : null}
                  </Pressable>
                ))}
            </HScroll>

            {!floatingChrome ? (
              <View
                style={{
                  marginHorizontal: space.l,
                  marginTop: space.m,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  height: 48,
                  paddingHorizontal: space.l,
                  borderRadius: radius.full,
                  backgroundColor: c.raised,
                }}
              >
                <Search size={18} color={c.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t.search}
                  placeholderTextColor={c.placeholder}
                  style={{ flex: 1, color: c.text, fontSize: font.body }}
                  returnKeyType="search"
                />
              </View>
            ) : null}
          </>
        }
        ListFooterComponent={
          <>
            {filtering && !mine.length ? (
              <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
                <Search size={26} color={c.placeholder} />
                <T tone="muted">No threads match.</T>
                <Pressable
                  onPress={() => {
                    tap()
                    setQuery('')
                    setFilter('all')
                    setScope(null)
                  }}
                >
                  <T tone="accent" weight="500">
                    Clear filters
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

      {nativeScrollEdge ? null : <TopFade visible={edge.scrolled} />}
      <KeyboardLift keyboard={keyboard}>
        <BottomFade height={insets.bottom + 96} />
        {floatingChrome ? (
          // iOS 26 layout: search sits at the bottom in a glass capsule, compose floats to its right.
          <GlassGroup
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: space.l,
              paddingBottom: Math.max(insets.bottom, space.m),
            }}
          >
            <Glass radius={radius.full} interactive style={{ flex: 1, height: 48 }}>
              <View
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space.s,
                  paddingHorizontal: space.l,
                }}
              >
                <Search size={18} color={c.muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t.search}
                  placeholderTextColor={c.placeholder}
                  style={{ flex: 1, color: c.text, fontSize: font.body }}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
            </Glass>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t.newChat}
              disabled={!online}
              onPress={startChat}
              style={{ opacity: online ? 1 : 0.5 }}
            >
              <Glass
                radius={radius.full}
                interactive
                tint={c.primary}
                style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}
              >
                <SquarePen size={20} color={c.primaryInk} strokeWidth={2} />
              </Glass>
            </Pressable>
          </GlassGroup>
        ) : null}
      </KeyboardLift>
      {!floatingChrome ? (
        // Android: Material extended FAB at the bottom right.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t.newChat}
          disabled={!online}
          onPress={startChat}
          style={({ pressed }) => ({
            position: 'absolute',
            right: space.l,
            bottom: insets.bottom + space.l,
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.s,
            height: 56,
            paddingHorizontal: 20,
            borderRadius: 16,
            backgroundColor: c.primary,
            elevation: 6,
            opacity: !online ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <SquarePen size={20} color={c.primaryInk} strokeWidth={2} />
          <T weight="600" style={{ color: c.primaryInk }}>
            {t.newChat}
          </T>
        </Pressable>
      ) : null}
      {projectMenu ? <ProjectActionsSheet project={projectMenu} open onClose={() => setProjectMenu(null)} /> : null}
      <Sheet open={newSheet} onClose={() => setNewSheet(false)} title={t.newChat}>
        {projectList
          .filter((p) => !scope || p.id === scope)
          .map((p) => (
            <Row
              key={p.id}
              onPress={() => {
                setNewSheet(false)
                setTimeout(() => newChat(p.id), 300)
              }}
            >
              {p.kind === 'workspace' ? <Folder size={17} color={c.soft} /> : <FolderGit2 size={17} color={c.soft} />}
              <View style={{ flex: 1 }}>
                <T weight="500" numberOfLines={1}>
                  {p.name}
                </T>
                <T size={font.caption} tone="muted" numberOfLines={1}>
                  {p.root}
                </T>
              </View>
            </Row>
          ))}
        <Row
          onPress={() => {
            setNewSheet(false)
            setTimeout(() => newChat(STANDALONE), 300)
          }}
        >
          <MessagesSquare size={17} color={c.soft} />
          <View style={{ flex: 1 }}>
            <T weight="500">Standalone</T>
            <T size={font.caption} tone="muted">
              No project folder
            </T>
          </View>
        </Row>
        <Row
          onPress={() => {
            setNewSheet(false)
            setTimeout(() => router.push('/folders'), 300)
          }}
        >
          <Monitor size={17} color={c.muted} />
          <T tone="muted">Add a folder on {pc?.name}…</T>
        </Row>
      </Sheet>
      <Sheet open={terminalSheet} onClose={() => setTerminalSheet(false)} title="Open terminal in">
        {projectList
          .filter((p) => !scope || p.id === scope)
          .map((p) => (
            <Row
              key={p.id}
              onPress={() => {
                setTerminalSheet(false)
                setTimeout(() => openTerminal(p.id), 300)
              }}
            >
              {p.kind === 'workspace' ? <Folder size={17} color={c.soft} /> : <FolderGit2 size={17} color={c.soft} />}
              <T style={{ flex: 1 }} numberOfLines={1}>
                {p.name}
              </T>
            </Row>
          ))}
        {!projectList.length ? (
          <T tone="muted" style={{ padding: space.l }}>
            Add a project first.
          </T>
        ) : null}
      </Sheet>
      <Sheet open={scopeSheet} onClose={() => setScopeSheet(false)} title="Workspace">
        {[
          {
            id: null as string | null,
            name: 'All workspaces',
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
