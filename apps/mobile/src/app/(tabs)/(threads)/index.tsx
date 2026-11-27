import { translate } from '@ramu/shared/i18n'
import { projectIdentity, useHostIdentities } from '../../../runtime/identities'
import { recentThreads } from '../../../runtime/recentThreads'
import {
  THREAD_LIST_KEY,
  groupKey,
  groupThreads,
  readThreadList,
  splitDone,
  type ThreadGroup,
} from '../../../runtime/threadGroups'
import { resolveLayered } from '../../../runtime/busyMode'
import { sharedValue } from '@ramu/shared/sharedFields'
import { shortHostName } from '@ramu/shared/hostLabel'
import { collapseScheduleRuns } from '@ramu/shared/chat/scheduleRuns'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackHandler, Platform, Pressable, RefreshControl, ScrollView as HScroll, StyleSheet, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Folder,
  FolderGit2,
  GitBranch,
  MessagesSquare,
  Search,
  Gauge,
  MemoryStick,
  SquarePen,
  Ellipsis,
  WifiOff,
  Unlink,
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
import { useT } from '../../../i18n'
import { Header, HeaderButton, LargeTitle, Screen, useScrolledUnderBar, PageFlatList } from '../../../components/Screen'
import { PlanUsageSheet } from '../../../components/PlanUsage'
import { HostResources } from '../../../components/HostResources'
import { FloatingActionButton } from '../../../components/FloatingActionButton'
import { ChatRow } from '../../../components/ChatRow'
import { ProjectActionsSheet } from '../../../components/ChatActions'
import { Disclosure, animateLayout } from '../../../components/Motion'
import { Chip, IconButton, ROW_INSET, Row, SectionLabel, Sheet, T, tap } from '../../../components/ui'
import { confirmCancel } from '../../../components/Outbox'
import { TopFade } from '../../../components/Glass'
import { useTabActions } from '../../../components/Overlays'
import { HostChip } from '../../../components/HostChip'
import { useBulkThreadActions } from '../../../components/BulkThreadActions'
import { threadSelection, useThreadSelection } from '../../../runtime/threadSelection'
import { threadsSync } from '../../../runtime/threadsSync'
import { useDelayedStatus } from '../../../runtime/useDelayedStatus'
import { SyncLine } from '../../../components/WorkingLine'

type Position = { first?: boolean; last?: boolean; gap?: number }
type HomeRow = { key: string } & Position &
  (
    | { kind: 'label'; text: string; right?: string }
    | { kind: 'outbox'; o: OutboxItem }
    | { kind: 'chat'; chat: Chat; project?: string; divider?: boolean; earlierRuns?: number; inProject?: boolean }
    | { kind: 'project'; group: ThreadGroup<Chat, MobileProject>; closed: boolean }
    | { kind: 'done'; count: number; closed: boolean }
    // `group` set: show the rest of one project (or fewer again); unset: more of the flat filtered list.
    | { kind: 'more'; group?: string; hidden?: number }
    // Finished threads the hosts hold back, read a page at a time.
    | { kind: 'older'; count: number }
  )

/** Newest threads each project shows before "Show more"; running, waiting and failed ones always show. */
const PER_PROJECT = 3
/** Done threads shown once the Done section is opened, before "Show more". */
const DONE_PAGE = 10
const DONE_KEY = 'section:done'

/** How this phone arranges projects by identity: all (default), grouped, or `only:<id>`. */
const IDENTITY_VIEW_KEY = 'pref-device:identityView'

export default function Threads() {
  const { c } = useTheme()
  const t = useT()
  const router = useRouter()
  const edge = useScrolledUnderBar(40)
  const store = useStore()
  const { chats, projects, selected, computers, outbox: allOutbox, cancelOutbox } = store
  // With several hosts the list merges all of them by default; picking one host shows just that host.
  const multi = computers.length > 1
  const [allHosts, setAllHosts] = useState(true)
  const merged = multi && allHosts
  // A message being delivered to a connected computer is in the outbox for a moment; only stuck ones (offline or uncertain) belong here.
  const outbox = allOutbox.filter(
    (o) =>
      o.state !== 'accepted' &&
      (merged || o.computerId === selected) &&
      (o.state === 'uncertain' ||
        o.state === 'refused' ||
        computers.find((x) => x.id === o.computerId)?.status !== 'online'),
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
  // Pulling down reads the shown hosts' threads again.
  const [pulling, setPulling] = useState(false)
  const pullToRefresh = () => {
    setPulling(true)
    void Promise.all(
      computers.filter((host) => merged || host.id === selected).map((host) => store.refresh(host.id).catch(() => {})),
    ).finally(() => setPulling(false))
  }
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [resourcesOpen, setResourcesOpen] = useState(false)

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
  // In each host's own order, the one the desktop shows, with hosts in the order this phone lists them: a host read
  // again moves to the end of the store's list, which must not move its projects here.
  const hostRank = new Map(computers.map((computer, index) => [computer.id, index]))
  const projectList = projects
    .filter((p) => merged || p.computerId === selected)
    .sort((a, b) => (hostRank.get(a.computerId) ?? 0) - (hostRank.get(b.computerId) ?? 0))
  const nameOf = (id: string) => projectList.find((p) => p.id === id)?.name
  const hostName = (id: string) => {
    const name = computers.find((x) => x.id === id)?.name
    return name ? shortHostName(name) : undefined
  }
  // `project · host`, the same label every list uses; the host only appears once there is more than one.
  const labelOf = (chat: Chat) =>
    [
      chat.projectId === STANDALONE
        ? undefined
        : projects.find((p) => p.computerId === chat.computerId && p.id === chat.projectId)?.name,
      multi ? hostName(chat.computerId) : undefined,
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
  const sync = threadsSync(
    computers
      .filter((host) => merged || host.id === selected)
      .map((host) => ({ status: host.status, read: store.threadReads?.[host.id] })),
    mine.length > 0 || projectList.length > 0,
  )
  // A re-read that finishes at once stays silent, so returning to the app does not flash a line above the list.
  const refreshing = useDelayedStatus('threads', sync === 'refreshing' ? sync : null)
  // Settings → Threads picks it as on the desktop: this phone's choice, then all your phones, then the host's own setting.
  const recentMode =
    resolveLayered(
      {
        device: readThreadList(store.drafts?.[THREAD_LIST_KEY]),
        mobile: readThreadList(sharedValue(store.mobileLayers?.[selected], 'recentChatMode')),
        all: readThreadList(store.appPreferences?.[selected]?.recentChatMode),
      },
      'projects',
    ).value === 'recent'
  // Grouping and narrowing by identity, once the shown host has two or more; search still finds every thread.
  const identities = useHostIdentities(merged ? undefined : selected)
  const identityList = identities && identities.settings.identities.length >= 2 ? identities.settings.identities : null
  const identityView = identityList ? (store.drafts?.[IDENTITY_VIEW_KEY] ?? 'all') : 'all'
  const identityOf = (projectId: string | null | undefined) => projectIdentity(identities, projectId)?.identityId
  // A thread marked done leaves its project (and Pinned) for one Done section at the bottom; archived ones list as they are.
  const { open, done } = useMemo(
    () => (filter === 'archived' ? { open: mine, done: [] } : splitDone(mine)),
    [mine, filter],
  )
  // Hosts that hold back older finished threads; the Done section counts them and reads them a page at a time.
  const olderDone = useMemo(
    () =>
      filter === 'archived'
        ? []
        : (merged ? store.computers.map((computer) => computer.id) : [selected])
            .map((id) => ({ id, count: store.doneRemaining[id] ?? 0 }))
            .filter((host) => host.count > 0),
    [filter, merged, store.computers, store.doneRemaining, selected],
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

  // One flat, virtualized list: labels, outbox items, chats and project headers are each a row, drawn full width.
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
      out.push({ key: 'label:outbox', kind: 'label', text: `${t.outbox} ${outbox.length}`, right: 'Sends when online' })
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
    if (filtering || recentMode) {
      // A status filter answers "which threads are …?", and recent mode asks what moved last, so each is one flat list
      // labelled by project.
      const recent = recentThreads(unpinned, historyLimit)
      if (recent.threads.length) {
        out.push({
          key: 'label:recent',
          kind: 'label',
          text: filtering
            ? (chips.find((chip) => chip.key === filter)?.label ?? t.homeAll)
            : translate(store.language, 'Recent threads'),
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
    // Otherwise each project is its own section, the most recently active first, so its menu and new-thread action are always one tap away.
    // A recurring schedule shows its newest run, with older ones folded in unless they are unread or need something;
    // opening a section fully (Show more) lists every run, as on the desktop.
    const unread = new Set(
      Object.values(store.inbox).flatMap((notices) =>
        notices.flatMap((notice) => (notice.kind === 'done' && notice.sessionId ? [notice.sessionId] : [])),
      ),
    )
    const runs = collapseScheduleRuns(unpinned, (chat) => !!chat.sessionId && unread.has(chat.sessionId))
    const shownRuns = new Set(runs.visible)
    const listed = unpinned.filter(
      (chat) => shownRuns.has(chat) || expanded.has(groupKey(chat.computerId, chat.projectId)),
    )
    const folded = new Map<string, number>()
    for (const chat of unpinned)
      if (!shownRuns.has(chat)) {
        const key = groupKey(chat.computerId, chat.projectId)
        folded.set(key, (folded.get(key) ?? 0) + 1)
      }
    // Folded runs count toward a section's "Show more", so a section holding only folded runs can still open them.
    const order = identityList?.map((identity) => identity.id) ?? []
    const groups = groupThreads(listed, projectList, { limit: PER_PROJECT, expanded, collapsed })
      .map((g) =>
        expanded.has(g.key) || collapsed.has(g.key) ? g : { ...g, hidden: g.hidden + (folded.get(g.key) ?? 0) },
      )
      .filter(
        (g) => !identityView.startsWith('only:') || !g.project || identityOf(g.project.id) === identityView.slice(5),
      )
      .sort((a, b) =>
        identityView === 'group' && a.project && b.project
          ? order.indexOf(identityOf(a.project.id) ?? '') - order.indexOf(identityOf(b.project.id) ?? '')
          : 0,
      )
    if (groups.length) out.push({ key: 'label:projects', kind: 'label', text: t.projects })
    groups.forEach((g, index) => {
      const closed = collapsed.has(g.key)
      group(
        `group:${g.key}`,
        [
          { key: 'head', kind: 'project', group: g, closed } as HomeRow,
          ...g.threads.map(
            (chat, i) =>
              ({
                key: chat.id,
                kind: 'chat',
                chat,
                divider: i > 0,
                inProject: true,
                earlierRuns: expanded.has(g.key) ? undefined : runs.earlierRuns[chat.id],
              }) as HomeRow,
          ),
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
      const older = olderDone.reduce((sum, host) => sum + host.count, 0)
      group(
        'done',
        [
          { key: 'head', kind: 'done', count: done.length + older, closed } as HomeRow,
          ...shown.map(
            (chat, i) => ({ key: chat.id, kind: 'chat', chat, project: labelOf(chat), divider: i > 0 }) as HomeRow,
          ),
          ...(!closed && done.length > DONE_PAGE
            ? [{ key: 'more', kind: 'more', group: DONE_KEY, hidden: all ? 0 : done.length - DONE_PAGE } as HomeRow]
            : []),
          ...(!closed && older && (all || done.length <= DONE_PAGE)
            ? [{ key: 'older', kind: 'older', count: older } as HomeRow]
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
    olderDone,
    projectList,
    historyLimit,
    filtering,
    filter,
    recentMode,
    merged,
    projects,
    identities,
    identityView,
    computers,
    collapsed,
    expanded,
    t,
    scoped,
    store.language,
    store.inbox,
  ])
  const newChat = (projectId: string) => router.push({ pathname: '/new', params: { project: projectId } })
  const renderRow = (row: HomeRow) => {
    if (row.kind === 'label')
      return (
        <SectionLabel
          right={
            row.right ? (
              <T size={font.caption} tone="muted">
                {translate(store.language, row.right)}
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
                      ? translate(store.language, 'New thread · {0}', {
                          0: nameOf(chat?.projectId ?? '') ?? translate(store.language, 'Standalone'),
                        })
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
                  onPress={() => confirmCancel(row.o, undefined, cancelOutbox, say)}
                />
              </View>
            </View>
          )
        })()
      ) : row.kind === 'chat' ? (
        <ChatRow
          chat={row.chat}
          project={row.project}
          divider={row.divider}
          earlierRuns={row.earlierRuns}
          inProject={row.inProject}
          selectable
        />
      ) : row.kind === 'done' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate(store.language, 'Done')}
          accessibilityState={{ expanded: !row.closed }}
          onPress={() => toggle(setCollapsed, DONE_KEY)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.m,
            paddingHorizontal: space.l,
            minHeight: 52,
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
      ) : row.kind === 'older' ? (
        <Row
          onPress={() => {
            if (loadingOlder) return
            setLoadingOlder(true)
            void Promise.all(olderDone.map((host) => store.loadOlderDone(host.id)))
              .catch(() => {})
              .finally(() => setLoadingOlder(false))
          }}
          style={{ paddingVertical: 11, paddingLeft: ROW_INSET }}
        >
          <T size={font.control} tone="muted">
            {loadingOlder
              ? translate(store.language, 'Loading…')
              : translate(store.language, 'Show {count} more', { count: row.count })}
          </T>
        </Row>
      ) : row.kind === 'more' ? (
        <Row
          onPress={() => (row.group ? toggle(setExpanded, row.group) : setHistoryLimit((limit) => limit + 20))}
          style={{ paddingVertical: 11, paddingLeft: ROW_INSET }}
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
          const host = merged ? hostName(g.computerId) : undefined
          const identity = p ? projectIdentity(identities, p.id) : null
          // The branch the project's own checkout has out, said once here instead of on each thread working in it.
          const branch = scoped.find(
            (chat) =>
              chat.computerId === g.computerId &&
              chat.projectId === g.projectId &&
              chat.mode !== 'worktree' &&
              chat.status !== 'archived' &&
              !!chat.branch,
          )?.branch
          const detail = [
            branch,
            host,
            identity?.name,
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
                gap: space.m,
                paddingLeft: space.l,
                paddingRight: space.s,
                minHeight: 52,
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {branch ? <GitBranch size={11} color={c.muted} /> : null}
                    <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
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
                  </View>
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
    // Full width, as a phone list: a project's header starts its section, and a hairline closes off the one above.
    return (
      <View
        style={{
          marginTop: row.gap,
          paddingTop: row.gap ? space.xs : 0,
          borderTopWidth: row.gap ? StyleSheet.hairlineWidth : 0,
          borderTopColor: c.line,
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
  // Material puts a top bar's actions after the title, so on Android they join Search and Settings on the right.
  const hostTools = (
    <>
      {computers.some(
        (host) => (merged || host.id === selected) && store.appPreferences?.[host.id]?.showUsageLimits !== false,
      ) ? (
        <HeaderButton
          actionId="tab-usage"
          icon={Gauge}
          label={say('Plan usage')}
          systemIcon="gauge.with.dots.needle.50percent"
          onPress={() => setUsageOpen(true)}
        />
      ) : null}
      {/* What each host's threads hold in memory, and Stop: the desktop's status-bar Resources. */}
      {computers.some((host) => (merged || host.id === selected) && host.access !== 'viewer') ? (
        <HeaderButton
          actionId="tab-resources"
          icon={MemoryStick}
          label={say('Resources')}
          systemIcon="memorychip"
          onPress={() => setResourcesOpen(true)}
        />
      ) : null}
    </>
  )
  return (
    <Screen>
      {header ?? (
        <Header
          back={false}
          large
          scrollEdge
          collapsed={edge.scrolled}
          title={t.chats}
          // Usage and Resources lead the bar: with Search and Settings on the right there is room for the centred
          // title once the large one scrolls away, which iOS hides when the buttons crowd it.
          left={Platform.OS === 'android' ? undefined : hostTools}
          right={
            <>
              {Platform.OS === 'android' ? hostTools : null}
              {actions}
            </>
          }
        />
      )}
      <PageFlatList
        fullWidth
        data={rows}
        keyExtractor={(row) => row.key}
        renderItem={({ item: row }) => renderRow(row)}
        contentInsetAdjustmentBehavior="automatic"
        // Room below the last row for Android's floating New thread button.
        contentContainerStyle={{ paddingBottom: Platform.OS === 'android' ? 96 : space.xl }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pullToRefresh} tintColor={c.muted} />}
        initialNumToRender={14}
        windowSize={9}
        ListHeaderComponent={
          <>
            <LargeTitle>{t.chats}</LargeTitle>
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
            {!merged && pc?.status === 'revoked' ? (
              <Pressable
                accessibilityRole="button"
                accessibilityHint={t.pair}
                onPress={() => {
                  tap()
                  router.push('/pair')
                }}
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
                <Unlink size={16} color={c.muted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={font.control} weight="600">
                    {t.revokedTitle}
                  </T>
                  <T size={font.control} tone="muted" style={{ lineHeight: 19 }}>
                    {t.revokedHint}
                  </T>
                  <T size={font.control} tone="accent" weight="600">
                    {t.pair}
                  </T>
                </View>
              </Pressable>
            ) : null}

            {/* The row leads with the host, then the list switch, then the filters once there is something to filter. */}
            <HScroll
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              style={{ flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: space.l, paddingTop: space.m, gap: space.s }}
            >
              <HostChip all={merged} onAll={multi ? setAllHosts : undefined} />
              {identityList && !recentMode ? (
                <>
                  <Chip
                    label={say('By identity')}
                    selected={identityView === 'group'}
                    onPress={() => store.setDraft(IDENTITY_VIEW_KEY, identityView === 'group' ? 'all' : 'group')}
                  />
                  {identityList.map((identity) => (
                    <Chip
                      key={identity.id}
                      label={translate(store.language, 'Only {name}', { name: identity.name })}
                      selected={identityView === `only:${identity.id}`}
                      onPress={() =>
                        store.setDraft(
                          IDENTITY_VIEW_KEY,
                          identityView === `only:${identity.id}` ? 'all' : `only:${identity.id}`,
                        )
                      }
                    />
                  ))}
                </>
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
            {/* Floats over the first rows from the bottom of this header, so the list never moves for it. */}
            <View>{refreshing ? <SyncLine what="threads" edge="top" /> : null}</View>
          </>
        }
        ListHeaderComponentStyle={{ zIndex: 2, elevation: 2 }}
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
            {filtering || mine.length || projectList.length ? null : sync === 'loading' ? (
              <View style={{ alignItems: 'center', padding: space.xl * 2 }}>
                <SyncLine what="threads" />
              </View>
            ) : (
              <View style={{ alignItems: 'center', padding: space.xl * 2, gap: space.m }}>
                {sync === 'offline' ? (
                  <WifiOff size={28} color={c.placeholder} />
                ) : (
                  <MessagesSquare size={28} color={c.placeholder} />
                )}
                <T tone="muted">{sync === 'offline' ? say('Host is offline') : t.empty}</T>
              </View>
            )}
          </>
        }
      />

      {Platform.OS === 'ios' ? null : <TopFade visible={edge.scrolled} />}
      {projectMenu ? <ProjectActionsSheet project={projectMenu} open onClose={() => setProjectMenu(null)} /> : null}
      <Sheet open={resourcesOpen} onClose={() => setResourcesOpen(false)} title={say('Resources')}>
        {resourcesOpen ? <HostResources host={merged ? null : selected} /> : null}
      </Sheet>
      <PlanUsageSheet
        hosts={merged ? computers.map((host) => host.id) : [selected]}
        open={usageOpen}
        onClose={() => setUsageOpen(false)}
      />
      {selection.on ? null : (
        <FloatingActionButton icon={SquarePen} label={t.newChat} onPress={() => router.push('/new')} />
      )}
    </Screen>
  )
}
