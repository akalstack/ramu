import { useCallback, useEffect, useMemo, useState } from 'react'
import { Linking, RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Copy, ExternalLink, FolderGit2, GitPullRequest, Layers, MessageSquare } from 'lucide-react-native'
import type { ForgeService, RepositoryPullRequests } from '@ramu/shared/types'
import {
  FORGE_NAMES,
  PULL_REQUEST_FILTERS,
  PULL_REQUEST_FILTER_LABEL,
  inPullRequestFilter,
  matchesPullRequestRow,
  mergedPullRequestRows,
  pullRequestRepoKey,
  sortPullRequestRows,
  type MergedPullRequestRow,
  type PullRequestFilter,
  type PullRequestSort,
} from '@ramu/shared/pullRequests'
import { needsAccess } from '@ramu/shared/pullRequestAccess'
import { shortHostName } from '@ramu/shared/hostLabel'
import { space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { LegendList } from '@legendapp/list/react-native'
import { Header, LargeTitle, PageLegendList, Screen, useScrolledUnderBar } from './Screen'
import { useTabActions } from './Overlays'
import { Nothing } from './InboxParts'
import { Chip, Divider, SectionLabel, Sheet, tap } from './ui'
import { ListSearch } from './ListSearch'
import { SheetGroup, SheetOption } from './SheetOptions'
import { PullRequestListNotices } from './PullRequestListNotices'
import { offlineHosts, pullRequestRepoLabel as repoLabel } from '../runtime/pullRequestList'
import { PULL_REQUEST_ROW_TEXT_INSET, PullRequestListRow } from './PullRequestListRow'
import { pullRequestCopy } from '../runtime/pullRequestCopy'
import { PageLoader } from './PageLoader'
import { ListPane } from './ListPane'

/** The repository picker's choice: everything, one hosting service whole, or one repository on every host. */
type Scope = { kind: 'all' } | { kind: 'service'; service: ForgeService } | { kind: 'repo'; key: string }

// Remembered for the session, so the list beside an open pull request shows the tab, scope and order you left.
let lastFilter: PullRequestFilter = 'needs-you'
let lastSort: PullRequestSort = 'updated'
let lastScope: Scope = { kind: 'all' }

/** Where a pull request opens: its host, project and repository there, and its address. */
export type PullRequestTarget = { computer: string; project: string; repoId: string; url: string }

/**
 * Every pull request on every paired host in one list, as the desktop's Pull requests page: the reviews asked of you
 * and your own ones that wait on you first, with the thread working on each. A row opens it in full. As a pane it sits
 * beside the open pull request on a wide window, marks it, and opens another in its place.
 */
export function PullRequestList({ pane }: { pane?: { openUrl: string; open(target: PullRequestTarget): void } }) {
  const say = useSay()
  const router = useRouter()
  const { c } = useTheme()
  const store = useStore()
  const edge = useScrolledUnderBar(40)
  const insets = useSafeAreaInsets()
  const actions = useTabActions()
  // From a thread's Source Control: that host's repository only, until the chip clears it.
  const params = useLocalSearchParams<{ computer?: string; repo?: string }>()
  const [repo, setRepo] = useState<{ computer: string; repoId: string } | null>(
    params.computer && params.repo ? { computer: params.computer, repoId: params.repo } : null,
  )
  const [filter, setFilterState] = useState<PullRequestFilter>(repo ? 'open' : lastFilter)
  const setFilter = (next: PullRequestFilter) => {
    if (!repo) lastFilter = next
    setFilterState(next)
  }
  // The tab stays mounted, so a later link from Source Control arrives as new parameters on this same screen.
  useEffect(() => {
    if (!params.computer || !params.repo) return
    setRepo({ computer: params.computer, repoId: params.repo })
    setFilterState('open')
  }, [params.computer, params.repo])
  const [search, setSearch] = useState('')
  const [sort, setSortState] = useState<PullRequestSort>(lastSort)
  const setSort = (next: PullRequestSort) => {
    lastSort = next
    setSortState(next)
  }
  const [scope, setScopeState] = useState<Scope>(lastScope)
  const setScope = (next: Scope) => {
    lastScope = next
    setScopeState(next)
  }
  const [picking, setPicking] = useState(false)
  const [repoQuery, setRepoQuery] = useState('')
  const [menu, setMenu] = useState<MergedPullRequestRow | null>(null)
  // Each host's lists as this phone last read them, so the page opens on them (an offline host's too) and reads again.
  const [lists, setLists] = useState<
    Record<string, { open?: RepositoryPullRequests[]; closed?: RepositoryPullRequests[] }>
  >(() =>
    Object.fromEntries(
      store.computers.flatMap((pc) => {
        const open = pullRequestCopy.read(pc.id, 'forge.allPullRequests', false, false)
        const closed = pullRequestCopy.read(pc.id, 'forge.allPullRequests', true, false)
        return open || closed ? [[pc.id, { open, closed }]] : []
      }),
    ),
  )
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const online = store.computers.filter((pc) => pc.status === 'online')
  const onlineKey = online.map((pc) => pc.id).join(',')
  const closed = filter === 'closed'

  const load = useCallback(
    async (computerId: string, force: boolean) => {
      try {
        const next = await store.invoke(computerId, 'forge.allPullRequests', closed, force)
        pullRequestCopy.keep(computerId, 'forge.allPullRequests', next, closed, false)
        setLists((all) => ({ ...all, [computerId]: { ...all[computerId], [closed ? 'closed' : 'open']: next } }))
        setFailed(({ [computerId]: _gone, ...rest }) => rest)
      } catch (error) {
        // An offline host keeps what it last gave and says why.
        setFailed((all) => ({ ...all, [computerId]: error instanceof Error ? error.message : String(error) }))
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
    [closed],
  )
  // Coming back from a pull request (merged, closed, replied to) shows where everything stands now.
  useFocusEffect(
    useCallback(() => {
      for (const id of onlineKey.split(',').filter(Boolean)) void load(id, false)
    }, [onlineKey, load]),
  )

  const multi = store.computers.length > 1
  const name = (computerId: string) => shortHostName(store.computers.find((pc) => pc.id === computerId)?.name ?? '')
  const inScope = (entry: { service?: ForgeService; projectName: string; repoName: string; repoId: string }) =>
    scope.kind === 'all' ||
    (scope.kind === 'service' ? (entry.service ?? 'github') === scope.service : pullRequestRepoKey(entry) === scope.key)
  // A pull request whose repository several hosts have shows once, opening where its thread is.
  const rowsOf = (which: 'open' | 'closed'): MergedPullRequestRow[] =>
    mergedPullRequestRows(
      Object.entries(lists).map(([host, entry]) => ({ host, repositories: entry[which] ?? [] })),
      online.map((pc) => pc.id),
    )
      .filter(
        (row) =>
          (!repo || row.sources.some((source) => source.host === repo.computer && source.repoId === repo.repoId)) &&
          inScope(row) &&
          matchesPullRequestRow(row, search),
      )
      .map((row) => {
        // From a thread's Source Control, the pull request opens on that thread's host.
        const source = repo && row.sources.find((entry) => entry.host === repo.computer)
        return source ? { ...row, ...source } : row
      })
  const openRows = rowsOf('open')
  const repositories = Object.entries(lists).flatMap(([host, entry]) =>
    (entry.open ?? []).map((item) => ({ ...item, host })),
  )
  const services = [...new Set(repositories.map((item) => item.service ?? 'github'))]
  // One choice per repository, however many hosts have it.
  const uniqueRepos = [...new Map(repositories.map((item) => [pullRequestRepoKey(item), item])).values()]
  const rows = sortPullRequestRows(
    (closed ? rowsOf('closed') : openRows).filter((row) => inPullRequestFilter(row, filter)),
    sort,
  )
  const repoName = useMemo(() => {
    if (!repo) return null
    const found = (lists[repo.computer]?.open ?? []).find((entry) => entry.repoId === repo.repoId)
    return found ? repoLabel(found) : say('This repository')
  }, [repo, lists, say])
  const scopeLabel =
    scope.kind === 'all'
      ? say('All repositories')
      : scope.kind === 'service'
        ? say('All on {0}', { 0: FORGE_NAMES[scope.service] })
        : (() => {
            const found = uniqueRepos.find((item) => pullRequestRepoKey(item) === scope.key)
            return found ? repoLabel(found) : say('All repositories')
          })()
  const attention = repositories.filter(
    (item) =>
      needsAccess(item) && (!repo || (item.host === repo.computer && item.repoId === repo.repoId)) && inScope(item),
  )
  // A host out of reach shows the rows this phone last read of it, and says so; one in reach that failed says why.
  const offline = offlineHosts(
    Object.keys(lists),
    online.map((pc) => pc.id),
  )
  const failedOnline = Object.fromEntries(Object.entries(failed).filter(([id]) => online.some((pc) => pc.id === id)))
  // Only a page with nothing kept waits on a spinner; kept lists show while every host reads again.
  const waiting =
    !Object.values(lists).some((entry) => entry[closed ? 'closed' : 'open']) && online.some((pc) => !failed[pc.id])
  const anyReachable = repositories.some((item) => item.availability === 'ready' && !item.error)

  // Every pull request opens in full here, as on the desktop; one from a repository in no project is read and acted
  // on through the service, as the account that found it.
  const open = (row: MergedPullRequestRow) => {
    tap()
    const target = { computer: row.host, project: row.projectId, repoId: row.repoId, url: row.pr.url }
    if (pane) pane.open(target)
    else router.push({ pathname: '/pull-request', params: target })
  }
  const later = (run: () => void) => {
    setMenu(null)
    // iOS presents what comes next only once this sheet has gone.
    setTimeout(run, 300)
  }
  const pickerQuery = repoQuery.trim().toLowerCase()
  const shownRepos = uniqueRepos.filter((item) => !pickerQuery || repoLabel(item).toLowerCase().includes(pickerQuery))

  // With no host in reach there is nothing to read again; the notices say each host is offline.
  const refreshControl = online.length ? (
    <RefreshControl
      refreshing={refreshing}
      tintColor={c.muted}
      onRefresh={() => {
        setRefreshing(true)
        void Promise.all(online.map((pc) => load(pc.id, true))).finally(() => setRefreshing(false))
      }}
    />
  ) : undefined
  // The search, filters and notices scroll above the rows; only the rows near the screen are mounted.
  const header = (
    <>
      <ListSearch value={search} onChangeText={setSearch} label={say('Search pull requests')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.s, paddingHorizontal: space.l, paddingVertical: space.m }}
      >
        {repo ? (
          <Chip
            label={repoName ?? ''}
            selected
            accessibilityHint={say('Shows every repository again')}
            onPress={() => {
              setRepo(null)
              setFilter('needs-you')
            }}
          />
        ) : null}
        {PULL_REQUEST_FILTERS.map((entry) => {
          const count = entry === 'closed' ? 0 : openRows.filter((row) => inPullRequestFilter(row, entry)).length
          return (
            <Chip
              key={entry}
              label={say(PULL_REQUEST_FILTER_LABEL[entry])}
              count={count || undefined}
              selected={filter === entry}
              onPress={() => setFilter(entry)}
            />
          )
        })}
        {uniqueRepos.length > 1 && !repo ? (
          <Chip
            label={scopeLabel}
            selected={scope.kind !== 'all'}
            accessibilityLabel={say('Search repositories')}
            chevron
            maxLabelWidth={160}
            onPress={() => setPicking(true)}
          />
        ) : null}
        <Chip
          label={say(sort === 'readiness' ? 'Closest to merging' : 'Recently updated')}
          accessibilityLabel={say('Sort')}
          chevron
          onPress={() => setSort(sort === 'readiness' ? 'updated' : 'readiness')}
        />
      </ScrollView>
      {/* Why a host or repository is missing from the list, in one block above it. */}
      <PullRequestListNotices
        repos={attention}
        offline={offline}
        failed={failedOnline}
        manyHosts={multi}
        onRetry={(host) => load(host, true)}
      />
      {rows.length && filter === 'needs-you' ? <SectionLabel>{say('Waiting on you')}</SectionLabel> : null}
    </>
  )
  const empty = waiting ? (
    <PageLoader style={{ marginVertical: space.xl }} />
  ) : (
    <Nothing
      icon={GitPullRequest}
      title={
        !anyReachable && !attention.length
          ? say('No repositories with a hosting service')
          : search
            ? say('No pull requests match')
            : filter === 'needs-you'
              ? say('No pull requests waiting on you')
              : say('No pull requests here')
      }
      detail={
        !anyReachable && !attention.length
          ? say('Publish a project to GitHub, GitLab, Bitbucket or Azure DevOps to see its pull requests here.')
          : filter === 'needs-you'
            ? say('Reviews asked of you and your pull requests that are ready or blocked show here.')
            : say('Try another tab or repository.')
      }
    />
  )
  const list = {
    data: rows,
    keyExtractor: (row: MergedPullRequestRow) => `${row.host}:${row.pr.url}`,
    renderItem: ({ item: row, index }: { item: MergedPullRequestRow; index: number }) => (
      <View>
        {index ? <Divider inset={PULL_REQUEST_ROW_TEXT_INSET} /> : null}
        <PullRequestListRow
          row={row}
          hostName={multi ? name(row.host) : undefined}
          elsewhere={row.sources.filter((source) => source.host !== row.host).length}
          selected={pane?.openUrl === row.pr.url}
          onOpen={() => open(row)}
          onMenu={() => {
            tap()
            setMenu(row)
          }}
        />
      </View>
    ),
    // The marked row follows the open pull request, which no row's data carries.
    extraData: pane?.openUrl,
    estimatedItemSize: 76,
    keyboardShouldPersistTaps: 'handled' as const,
    ListEmptyComponent: empty,
    refreshControl,
  }
  const sheets = (
    <>
      <Sheet
        open={picking}
        onClose={() => {
          setPicking(false)
          setRepoQuery('')
        }}
        title={say('Search repositories')}
        search={{ value: repoQuery, onChangeText: setRepoQuery, placeholder: say('Search repositories') }}
      >
        {!pickerQuery ? (
          <SheetGroup>
            <SheetOption
              icon={Layers}
              title={say('All repositories')}
              selected={scope.kind === 'all'}
              onPress={() => {
                setScope({ kind: 'all' })
                setPicking(false)
              }}
            />
            {/* With more than one service, each can be chosen whole. */}
            {services.length > 1
              ? services.map((entry) => (
                  <SheetOption
                    key={entry}
                    icon={Layers}
                    title={say('All on {0}', { 0: FORGE_NAMES[entry] })}
                    selected={scope.kind === 'service' && scope.service === entry}
                    onPress={() => {
                      setScope({ kind: 'service', service: entry })
                      setPicking(false)
                    }}
                  />
                ))
              : null}
          </SheetGroup>
        ) : null}
        <SheetGroup>
          {shownRepos.map((item) => (
            <SheetOption
              key={pullRequestRepoKey(item)}
              icon={FolderGit2}
              title={repoLabel(item)}
              help={services.length > 1 ? FORGE_NAMES[item.service ?? 'github'] : undefined}
              selected={scope.kind === 'repo' && scope.key === pullRequestRepoKey(item)}
              onPress={() => {
                setScope({ kind: 'repo', key: pullRequestRepoKey(item) })
                setPicking(false)
                setRepoQuery('')
              }}
            />
          ))}
        </SheetGroup>
      </Sheet>
      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.pr.title}>
        {menu ? (
          <SheetGroup>
            {menu.threads.length ? (
              <SheetOption
                icon={MessageSquare}
                title={say('Open thread')}
                help={menu.threads.at(-1)!.title}
                onPress={() =>
                  later(() =>
                    router.push({
                      pathname: '/chat/[id]',
                      params: { id: store.resolveChat(menu.host, menu.threads.at(-1)!.taskId) },
                    }),
                  )
                }
              />
            ) : null}
            <SheetOption
              icon={ExternalLink}
              title={say('Open on {0}', { 0: FORGE_NAMES[menu.service] })}
              onPress={() => later(() => void Linking.openURL(menu.pr.url).catch(() => {}))}
            />
            <SheetOption
              icon={Copy}
              title={say('Copy link')}
              onPress={() => {
                void Clipboard.setStringAsync(menu.pr.url)
                setMenu(null)
              }}
            />
          </SheetGroup>
        ) : null}
      </Sheet>
    </>
  )

  if (pane)
    return (
      <ListPane title={say('Pull requests')}>
        <LegendList
          {...list}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.l }}
          ListHeaderComponent={header}
        />
        {sheets}
      </ListPane>
    )
  return (
    <Screen>
      <Header back={false} large scrollEdge collapsed={edge.scrolled} title={say('Pull requests')} right={actions} />
      <PageLegendList
        {...list}
        fullWidth
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <>
            <LargeTitle>{say('Pull requests')}</LargeTitle>
            {header}
          </>
        }
      />
      {sheets}
    </Screen>
  )
}
