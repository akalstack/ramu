import { useCallback, useEffect, useMemo, useState } from 'react'
import { Linking, RefreshControl, ScrollView, TextInput, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ExternalLink, GitPullRequest, MessageSquare } from 'lucide-react-native'
import type { RepositoryPullRequests } from '@ramu/shared/types'
import {
  PULL_REQUEST_FILTERS,
  PULL_REQUEST_FILTER_LABEL,
  PULL_REQUEST_STAGE_LABEL,
  inPullRequestFilter,
  matchesPullRequestRow,
  pullRequestRows,
  sortPullRequestRows,
  type PullRequestFilter,
  type PullRequestSort,
  type PullRequestRow,
} from '@ramu/shared/pullRequests'
import { font, space, useTheme } from '../../../theme'
import { ago, useSay } from '../../../i18n'
import { useStore } from '../../../runtime/store'
import { Header, LargeTitle, PageScrollView, Screen, useScrolledUnderBar } from '../../../components/Screen'
import { useTabActions } from '../../../components/Overlays'
import { Nothing } from '../../../components/InboxParts'
import { Chip, Row, SectionLabel, T, tap } from '../../../components/ui'
import { ChecksLine, PullRequestGlyph, StageText } from '../../../components/PullRequestParts'
import { unavailableText } from '../../../components/PullRequestSections'

type HostRow = PullRequestRow & { computerId: string; hostName: string }

const repoLabel = (entry: { projectName: string; repoName: string }) =>
  entry.projectName === entry.repoName ? entry.repoName : `${entry.projectName} / ${entry.repoName}`

/**
 * Every pull request on every paired host in one list, as the desktop's Pull requests page: the reviews asked of you
 * and your own ones that wait on you first, with the thread working on each. A row opens it in full.
 */
export default function PullRequestsScreen() {
  const say = useSay()
  const router = useRouter()
  const { c } = useTheme()
  const store = useStore()
  const edge = useScrolledUnderBar(40)
  const actions = useTabActions()
  // From a thread's Source Control: that host's repository only, until the chip clears it.
  const params = useLocalSearchParams<{ computer?: string; repo?: string }>()
  const [repo, setRepo] = useState<{ computer: string; repoId: string } | null>(
    params.computer && params.repo ? { computer: params.computer, repoId: params.repo } : null,
  )
  const [filter, setFilter] = useState<PullRequestFilter>(repo ? 'open' : 'needs-you')
  // The tab stays mounted, so a later link from Source Control arrives as new parameters on this same screen.
  useEffect(() => {
    if (!params.computer || !params.repo) return
    setRepo({ computer: params.computer, repoId: params.repo })
    setFilter('open')
  }, [params.computer, params.repo])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PullRequestSort>('updated')
  const [lists, setLists] = useState<
    Record<string, { open?: RepositoryPullRequests[]; closed?: RepositoryPullRequests[] }>
  >({})
  const [failed, setFailed] = useState<Record<string, string>>({})
  const [refreshing, setRefreshing] = useState(false)
  const online = store.computers.filter((pc) => pc.status === 'online')
  const onlineKey = online.map((pc) => pc.id).join(',')
  const closed = filter === 'closed'

  const load = useCallback(
    async (computerId: string, force: boolean) => {
      try {
        const next = await store.invoke(computerId, 'forge.allPullRequests', closed, force)
        setLists((all) => ({ ...all, [computerId]: { ...all[computerId], [closed ? 'closed' : 'open']: next } }))
        setFailed(({ [computerId]: _gone, ...rest }) => rest)
      } catch (error) {
        // An offline or older host keeps what it last gave and says why.
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
  const name = (computerId: string) => store.computers.find((pc) => pc.id === computerId)?.name ?? ''
  const rowsOf = (which: 'open' | 'closed'): HostRow[] =>
    Object.entries(lists)
      .flatMap(([computerId, entry]) =>
        pullRequestRows(entry[which] ?? []).map((row) => ({ ...row, computerId, hostName: name(computerId) })),
      )
      .filter(
        (row) =>
          (!repo || (row.computerId === repo.computer && row.repoId === repo.repoId)) &&
          matchesPullRequestRow(row, search),
      )
      .sort((a, b) => b.pr.updatedAt - a.pr.updatedAt)
  const openRows = rowsOf('open')
  const rows = sortPullRequestRows(
    (closed ? rowsOf('closed') : openRows).filter((row) => inPullRequestFilter(row, filter)),
    sort,
  )
  const repoName = useMemo(() => {
    if (!repo) return null
    const found = (lists[repo.computer]?.open ?? []).find((entry) => entry.repoId === repo.repoId)
    return found ? repoLabel(found) : say('This repository')
  }, [repo, lists, say])
  const notes = Object.entries(lists).flatMap(([computerId, entry]) =>
    (entry.open ?? [])
      .filter((item) => !repo || (computerId === repo.computer && item.repoId === repo.repoId))
      .map((item) => ({
        key: `${computerId}:${item.repoId}`,
        item,
        text: item.error ?? unavailableText(item.availability),
      }))
      .filter((entry) => !!entry.text),
  )
  const anyReachable = Object.values(lists).some((entry) =>
    (entry.open ?? []).some((item) => item.availability === 'ready' && !item.error),
  )

  const open = (row: HostRow) => {
    tap()
    // A repository outside every project has no checkout on the host, so its pull request opens on the service.
    if (row.outside) return void Linking.openURL(row.pr.url).catch(() => {})
    router.push({
      pathname: '/pull-request',
      params: { computer: row.computerId, project: row.projectId, repoId: row.repoId, url: row.pr.url },
    })
  }

  return (
    <Screen>
      <Header back={false} large scrollEdge collapsed={edge.scrolled} title={say('Pull requests')} right={actions} />
      <PageScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingBottom: space.xl * 2 }}
        onScroll={edge.onScroll}
        scrollEventThrottle={16}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={c.muted}
            onRefresh={() => {
              setRefreshing(true)
              void Promise.all(online.map((pc) => load(pc.id, true))).finally(() => setRefreshing(false))
            }}
          />
        }
      >
        <LargeTitle>{say('Pull requests')}</LargeTitle>
        <TextInput
          accessibilityLabel={say('Search pull requests')}
          placeholder={say('Search pull requests')}
          placeholderTextColor={c.muted}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={{
            marginHorizontal: space.l,
            marginTop: space.m,
            minHeight: 40,
            paddingHorizontal: space.m,
            borderRadius: 10,
            backgroundColor: c.fill,
            color: c.text,
          }}
        />
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
          <Chip
            label={say(sort === 'readiness' ? 'Closest to merging' : 'Recently updated')}
            accessibilityLabel={say('Sort')}
            chevron
            onPress={() => setSort((value) => (value === 'readiness' ? 'updated' : 'readiness'))}
          />
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
        </ScrollView>
        {Object.entries(failed).map(([computerId, text]) => (
          <T key={computerId} size={font.caption} tone="bad" style={{ paddingHorizontal: space.l }}>
            {multi ? `${name(computerId)}: ${text}` : text}
          </T>
        ))}
        {notes.length ? (
          <View style={{ gap: space.xs, paddingHorizontal: space.l, paddingBottom: space.s }}>
            {notes.map(({ key, item, text }) => (
              <T key={key} size={font.caption} tone="muted">
                {`${repoLabel(item)}: ${say(text!)}`}
              </T>
            ))}
          </View>
        ) : null}
        {rows.length ? (
          <View>
            {filter === 'needs-you' ? <SectionLabel>{say('Waiting on you')}</SectionLabel> : null}
            {rows.map((row) => {
              const thread = row.threads.at(-1)
              return (
                <Row
                  key={`${row.computerId}:${row.pr.url}`}
                  accessibilityLabel={[
                    say('Pull request #{0}: {1}', { 0: row.pr.number, 1: row.pr.title }),
                    repoLabel(row),
                    say(PULL_REQUEST_STAGE_LABEL[row.stage]),
                    thread ? say('In {0}', { 0: thread.title }) : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  onPress={() => open(row)}
                  style={{ flexDirection: 'row', gap: space.m, paddingHorizontal: space.l, paddingVertical: space.s }}
                >
                  <View style={{ paddingTop: 3 }}>
                    <PullRequestGlyph pr={row.pr} stage={row.stage} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={{ flexDirection: 'row', gap: space.s }}>
                      <T size={font.body - 1} weight="500" numberOfLines={2} style={{ flex: 1 }}>
                        {row.pr.title}
                      </T>
                      {row.outside ? <ExternalLink size={12} color={c.muted} /> : null}
                      <T size={font.caption} tone="muted">
                        {ago(row.pr.updatedAt)}
                      </T>
                    </View>
                    <T size={font.caption} tone="muted" numberOfLines={1}>
                      {[multi ? row.hostName : null, `${repoLabel(row)} #${row.pr.number}`, row.pr.author]
                        .filter(Boolean)
                        .join(' · ')}
                    </T>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, overflow: 'hidden' }}>
                      <ChecksLine checks={row.pr.checks} compact />
                      <StageText stage={row.stage} />
                      {row.pr.openThreads ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                          <MessageSquare size={11} color={c.muted} />
                          <T size={font.caption} tone="muted">
                            {String(row.pr.openThreads)}
                          </T>
                        </View>
                      ) : null}
                      {row.pr.additions !== undefined && row.pr.deletions !== undefined ? (
                        <T
                          size={font.caption}
                          style={{ flexShrink: 0, fontVariant: ['tabular-nums'] }}
                          accessibilityLabel={say('{0} lines added, {1} removed', {
                            0: row.pr.additions,
                            1: row.pr.deletions,
                          })}
                        >
                          <T size={font.caption} tone="ok">{`+${row.pr.additions}`}</T>{' '}
                          <T size={font.caption} tone="bad">{`−${row.pr.deletions}`}</T>
                        </T>
                      ) : null}
                      {row.pr.labels?.[0] ? (
                        <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
                          {row.pr.labels[0]}
                        </T>
                      ) : null}
                      {thread ? (
                        <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                          {say('In {0}', { 0: thread.title })}
                        </T>
                      ) : null}
                    </View>
                  </View>
                </Row>
              )
            })}
          </View>
        ) : (
          <Nothing
            icon={GitPullRequest}
            title={
              !anyReachable && !notes.length
                ? say('No repositories with a hosting service')
                : search
                  ? say('No pull requests match')
                  : filter === 'needs-you'
                    ? say('Nothing waiting on you')
                    : say('No pull requests here')
            }
            detail={
              !anyReachable && !notes.length
                ? say('Publish a project to GitHub, GitLab, Bitbucket or Azure DevOps to see its pull requests here.')
                : filter === 'needs-you'
                  ? say('Reviews asked of you and your pull requests that are ready or blocked show here.')
                  : say('Try another tab or repository.')
            }
          />
        )}
      </PageScrollView>
    </Screen>
  )
}
