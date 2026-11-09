import { useEffect, useRef, useState } from 'react'
import { useQueries } from '@tanstack/react-query'
import {
  ArrowLeft,
  CircleCheck,
  ExternalLink,
  CircleDot,
  CircleX,
  GitPullRequest,
  MessageSquare,
  RefreshCw,
  Search,
} from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { RowButton } from '@/components/row-button'
import { ContentSkeleton } from '@/components/content-skeleton'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ForgeService, PullRequestSummary, RepositoryPullRequests } from '@ramu/shared/types'
import { forgeBrand } from '@ramu/shared/brands'
import { BrandIcon } from '@/components/brand-icon'
import {
  PULL_REQUEST_FILTERS,
  PULL_REQUEST_FILTER_LABEL,
  inPullRequestFilter,
  matchesPullRequestRow,
  mergedPullRequestRows,
  FORGE_NAMES,
  pullRequestRef,
  pullRequestRepoKey,
  sortPullRequestRows,
  type MergedPullRequestRow,
  type PullRequestFilter,
  type PullRequestRow,
  type PullRequestSort,
} from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'
import { Dropdown, timeAgo } from '../Menu'
import { ipcQueryKeyOn } from '../dataQueries'
import { HostContent } from '../workspace/HostContent'
import { useHostSelection } from '../workspace/HostSelection'
import { statusText, useScopedHosts } from '../workspace/computers'
import { projectCtx, type useWorkspace } from '../workspace/workspace'
import { ownHostId } from '../hosts'
import { DeviceIcon } from '@/components/device-icon'
import { RepositoryAccessNotices } from './RepositoryAccessNotices'
import { queryInvokerFor } from './hostQuery'
import { errorText } from '../lib/errors'
import { invoke as openOnThisComputer } from '../ipc'
import { PullRequestIcon, StageChip } from './PullRequestIcon'
import { PullRequestView } from './PullRequestView'

const ALL = ''
const SERVICE = 'service:'
const SORT_KEY = 'ramu.pull-requests-sort'

/** The order last chosen on this device; storage may be unavailable, which leaves the default. */
function savedSort(): PullRequestSort {
  try {
    return localStorage.getItem(SORT_KEY) === 'readiness' ? 'readiness' : 'updated'
  } catch {
    return 'updated'
  }
}
const FILTER_EVENT = 'ramu:pull-requests-filter'
/** One host's repository, as a thread's Source Control names it. */
type RepoTarget = { host: string; repoId: string }
/** A repository asked for before the page mounted, such as from a thread's Source Control. */
let pendingRepo: RepoTarget | null = null

/** Opens the Pull requests page, narrowed to one repository when given. */
export function showPullRequests(ws: ReturnType<typeof useWorkspace>, repo: RepoTarget | null = null) {
  pendingRepo = repo
  window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: repo }))
  ws.setSidebar('pulls')
}

/** Every repository's pull requests on each listed host, refreshed while the window has focus. */
function useHostsPullRequests(includeClosed: boolean, enabled = true) {
  const hosts = useScopedHosts()
  const results = useQueries({
    queries: hosts.map((host) => ({
      queryKey: ipcQueryKeyOn(host.id, 'forge.allPullRequests', includeClosed),
      queryFn: () => queryInvokerFor(host.id)('forge.allPullRequests', includeClosed, false),
      // An offline host is named on the page instead; it lists again once it is back.
      enabled: enabled && host.status === 'connected',
      refetchInterval: () => (document.hasFocus() ? 120_000 : false),
    })),
  })
  return hosts.map((host, index) => ({ host, query: results[index]! }))
}

/** How many open pull requests wait on the person on the listed hosts, for the sidebar's badge. */
export function usePullRequestsWaiting(): number {
  const lists = useHostsPullRequests(false)
  return mergedPullRequestRows(
    lists.map(({ host, query }) => ({ host: host.id, repositories: query.data ?? [] })),
  ).filter((row) => inPullRequestFilter(row, 'needs-you')).length
}

function ChecksMark({ checks }: { checks: PullRequestSummary['checks'] }) {
  if (checks === 'failure') return <CircleX size={11} className="flex-none text-bad" aria-label={t('Checks failing')} />
  if (checks === 'pending')
    return <CircleDot size={11} className="flex-none text-warn" aria-label={t('Checks running')} />
  if (checks === 'success')
    return <CircleCheck size={11} className="flex-none text-ok" aria-label={t('Checks passed')} />
  return null
}

const repoLabel = (row: Pick<PullRequestRow, 'projectName' | 'repoName'>) =>
  row.projectName === row.repoName ? row.repoName : `${row.projectName} / ${row.repoName}`

/**
 * Every pull request across the listed hosts' projects in one list, as GitHub's own page shows them across
 * repositories, with what only Ramu knows: the thread working on each one, replies an agent drafted, and the next step
 * that is yours. A pull request whose repository several hosts have shows once. Choosing one shows it in full beside
 * the list, read from and acted on at the host it is on.
 */
export function PullRequestsPage() {
  useLanguage()
  const { activeHost } = useHostSelection()
  const [filter, setFilter] = useState<PullRequestFilter>('needs-you')
  // `pending` holds a host's repository until that host's list arrives and gives it a key.
  const [repoKey, setRepoKey] = useState<string>(ALL)
  const [pending, setPending] = useState<RepoTarget | null>(() => pendingRepo)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<MergedPullRequestRow | null>(null)
  const [sort, setSort] = useState<PullRequestSort>(savedSort)
  const [refreshing, setRefreshing] = useState(false)
  const open = useHostsPullRequests(false)
  const closed = useHostsPullRequests(true, filter === 'closed')
  const lists = filter === 'closed' ? closed : open
  const hosts = lists.map((entry) => entry.host)
  const manyHosts = hosts.length > 1
  const hostName = (id: string) => hosts.find((host) => host.id === id)?.name ?? ''
  const connected = (id: string) => hosts.some((host) => host.id === id && host.status === 'connected')

  useEffect(() => {
    pendingRepo = null
    const onFilter = (event: Event) => {
      const repo = (event as CustomEvent<RepoTarget | null>).detail
      setPending(repo)
      if (!repo) setRepoKey(ALL)
      setSelected(null)
      pendingRepo = null
    }
    window.addEventListener(FILTER_EVENT, onFilter)
    return () => window.removeEventListener(FILTER_EVENT, onFilter)
  }, [])

  const refetchAll = () => Promise.all(lists.map(({ query }) => query.refetch()))
  const latestRefetch = useRef(refetchAll)
  latestRefetch.current = refetchAll
  useEffect(() => {
    const refresh = () => void latestRefetch.current()
    window.addEventListener('ramu:git-updated', refresh)
    return () => window.removeEventListener('ramu:git-updated', refresh)
  }, [])

  const hostLists = lists.map(({ host, query }) => ({ host: host.id, repositories: query.data ?? [] }))
  // Each host's repositories, labelled with the host when the page lists several.
  const repositories: (RepositoryPullRequests & { host: string })[] = hostLists.flatMap(({ host, repositories }) =>
    repositories.map((repo) => ({ ...repo, host })),
  )
  const preferred = [activeHost, ownHostId()]
  const allRows = mergedPullRequestRows(hostLists, preferred)

  const pendingKey = pending
    ? repositories.find((repo) => repo.host === pending.host && repo.repoId === pending.repoId)
    : undefined
  useEffect(() => {
    if (!pendingKey) return
    setRepoKey(pullRequestRepoKey(pendingKey))
    setPending(null)
  }, [pendingKey])

  // The repository picker also narrows to one service: a value of `service:<id>`.
  const inScope = (entry: { projectName: string; repoName: string; service?: ForgeService }) =>
    repoKey === ALL ||
    (repoKey.startsWith(SERVICE)
      ? (entry.service ?? 'github') === repoKey.slice(SERVICE.length)
      : pullRequestRepoKey(entry) === repoKey)
  const scoped = allRows.filter((row) => inScope(row) && matchesPullRequestRow(row, search))
  const rows = sortPullRequestRows(
    scoped.filter((row) => inPullRequestFilter(row, filter)),
    sort,
  )
  // Counts come from the open lists, so switching to Merged and closed does not blank them.
  const openRows = mergedPullRequestRows(
    open.map(({ host, query }) => ({ host: host.id, repositories: query.data ?? [] })),
  )
  const count = (entry: PullRequestFilter) =>
    entry === 'closed'
      ? 0
      : openRows.filter((row) => inScope(row) && matchesPullRequestRow(row, search) && inPullRequestFilter(row, entry))
          .length
  const attention = repositories.filter(
    (repo) =>
      inScope(repo) &&
      (repo.error ||
        repo.availability === 'no-cli' ||
        repo.availability === 'signed-out' ||
        repo.availability === 'choose-account'),
  )
  const reachable = repositories.filter((repo) => repo.availability === 'ready' && !repo.error)
  const loading = lists.some(({ query }) => query.isLoading)
  const fetching = lists.some(({ query }) => query.isFetching)
  const settled = lists.some(({ query }) => query.isSuccess) && !loading
  // A host that is offline or could not answer is named above the list; the other hosts' pull requests still show.
  const unreachable = lists.filter(({ host, query }) => host.status !== 'connected' || query.isError)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await Promise.all(
        lists
          .filter(({ host }) => host.status === 'connected')
          .map(({ host, query }) =>
            queryInvokerFor(host.id)('forge.allPullRequests', filter === 'closed', true)
              .catch(() => {})
              .then(() => query.refetch()),
          ),
      )
    } finally {
      setRefreshing(false)
    }
  }

  const row = (entry: MergedPullRequestRow) => {
    const { pr } = entry
    const thread = entry.threads.at(-1)
    const active = selected?.pr.url === pr.url
    const elsewhere = entry.sources.slice(1).map((source) => hostName(source.host))
    // The stage already says when checks are failing or running; the mark adds it only when the stage is about something else.
    const checksAside =
      entry.stage !== 'checks-failing' &&
      entry.stage !== 'checks-pending' &&
      (pr.checks === 'failure' || pr.checks === 'pending')
    return (
      <RowButton
        key={pr.url}
        data-pr-url={pr.url}
        stacked
        className="py-1.5"
        aria-selected={active}
        title={entry.outside ? `${pr.title} (${t('Opens on {0}', { '0': FORGE_NAMES[entry.service] })})` : pr.title}
        // Ramu has no checkout of a repository outside every project, so its pull request opens on the service.
        onClick={() => (entry.outside ? void openOnThisComputer('app.openExternal', pr.url) : setSelected(entry))}
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <PullRequestIcon pr={pr} stage={entry.stage} />
          <span className="min-w-0 flex-1 truncate text-foreground">{pr.title}</span>
          {entry.outside && <ExternalLink size={11} className="flex-none text-muted-foreground" aria-hidden="true" />}
          {pr.additions !== undefined && pr.deletions !== undefined && (
            <span
              className="flex-none text-caption tabular-nums"
              title={t('{0} lines added, {1} removed', { '0': pr.additions, '1': pr.deletions })}
            >
              <span className="text-ok">+{pr.additions}</span> <span className="text-bad">−{pr.deletions}</span>
            </span>
          )}
          <span className="flex-none text-caption text-muted-foreground tabular-nums">{timeAgo(pr.updatedAt)}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-2 pl-[21px] text-caption text-muted-foreground">
          {/* Everything but the host shares what is left of the line and gives way, least important first. */}
          <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
            <BrandIcon brand={forgeBrand(entry.service)} size={11} className="flex-none" />
            <span
              className="min-w-[56px] shrink truncate"
              title={`${FORGE_NAMES[entry.service]} · ${repoLabel(entry)}`}
            >
              {repoLabel(entry)} {pullRequestRef(entry.service, pr.number)}
            </span>
            {checksAside && <ChecksMark checks={pr.checks} />}
            <StageChip stage={entry.stage} />
            {!!pr.openThreads && (
              <span className="inline-flex flex-none items-center gap-0.5" title={t('Open review threads')}>
                <MessageSquare size={10} aria-hidden="true" />
                {pr.openThreads}
              </span>
            )}
            {pr.labels?.slice(0, 2).map((label) => (
              <span
                key={label}
                title={label}
                className="min-w-0 max-w-[96px] shrink-[2] truncate rounded-full bg-fill px-1.5 text-[11px] leading-4"
              >
                {label}
              </span>
            ))}
            {(pr.author || thread) && (
              <span className="min-w-0 shrink-[3] truncate">
                {[pr.author, thread ? t('In {0}', { '0': thread.title }) : ''].filter(Boolean).join(' · ')}
              </span>
            )}
          </span>
          {manyHosts && (
            <span
              className="inline-flex max-w-[112px] flex-none items-center gap-1"
              title={
                elsewhere.length
                  ? t('Opens on {0}. Also on {1}', { '0': hostName(entry.host), '1': elsewhere.join(', ') })
                  : t('On {0}', { '0': hostName(entry.host) })
              }
            >
              <DeviceIcon name={hostName(entry.host)} size={11} />
              <span className="min-w-0 truncate">{hostName(entry.host)}</span>
              {elsewhere.length > 0 && <span className="flex-none tabular-nums">+{elsewhere.length}</span>}
            </span>
          )}
        </span>
      </RowButton>
    )
  }

  const listRef = useRef<HTMLDivElement>(null)
  /** Up and down move through the list, opening each pull request as a mail list does. */
  const move = (event: React.KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const openable = rows.filter((entry) => !entry.outside)
    if (!openable.length) return
    event.preventDefault()
    const at = openable.findIndex((entry) => entry.pr.url === selected?.pr.url)
    const step = event.key === 'ArrowDown' ? 1 : -1
    const next = openable[at < 0 ? 0 : Math.min(openable.length - 1, Math.max(0, at + step))]!
    setSelected(next)
    listRef.current?.querySelector<HTMLElement>(`[data-pr-url="${CSS.escape(next.pr.url)}"]`)?.focus()
  }

  const services = [...new Set(repositories.map((repo) => repo.service ?? 'github'))]
  // One option per repository, however many hosts have it.
  const uniqueRepos = [...new Map(repositories.map((repo) => [pullRequestRepoKey(repo), repo])).values()]
  const repoOptions = [
    { value: ALL, label: t('All repositories') },
    // With more than one service, each can be chosen whole, and each repository says which it is on.
    ...(services.length > 1
      ? services.map((service) => ({
          value: `${SERVICE}${service}`,
          label: t('All on {0}', { '0': FORGE_NAMES[service] }),
        }))
      : []),
    ...uniqueRepos.map((repo) => ({
      value: pullRequestRepoKey(repo),
      label: services.length > 1 ? `${repoLabel(repo)} · ${FORGE_NAMES[repo.service ?? 'github']}` : repoLabel(repo),
    })),
  ]

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1">
      <section
        aria-label={t('Pull requests')}
        className={cn(
          'flex min-h-0 w-full flex-col @min-[900px]:w-[480px] @min-[1280px]:w-[540px] @min-[900px]:flex-none @min-[900px]:border-r @min-[900px]:border-(--line)',
          selected && '@max-[899px]:hidden',
        )}
      >
        <div className="flex flex-none flex-col gap-2 px-4 pt-4">
          <div className="flex items-center gap-1.5">
            <div className="relative min-w-0 flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('Search title, author, branch or repository')}
                aria-label={t('Search pull requests')}
                className="h-8 pl-7"
              />
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('Refresh pull requests')}
              title={t('Refresh')}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw size={14} className={cn((refreshing || fetching) && 'animate-spin')} />
            </Button>
          </div>
          <div className="flex items-center gap-1.5">
            <Dropdown
              label={t('Sort')}
              value={sort}
              options={[
                { value: 'updated', label: t('Recently updated') },
                { value: 'readiness', label: t('Closest to merging') },
              ]}
              onChange={(value) => {
                const next = value === 'readiness' ? 'readiness' : 'updated'
                setSort(next)
                try {
                  localStorage.setItem(SORT_KEY, next)
                } catch {
                  // The choice still applies until the page closes.
                }
              }}
              className="flex-1"
            />
            {uniqueRepos.length > 1 && (
              <Dropdown
                label={t('Repository')}
                value={repoKey}
                options={repoOptions}
                onChange={(value) => {
                  setRepoKey(value)
                  setSelected(null)
                }}
                className="flex-1"
              />
            )}
          </div>
          <Tabs value={filter} onValueChange={(value) => setFilter(value as PullRequestFilter)}>
            <TabsList
              variant="line"
              className="h-9! w-full justify-start gap-2.5 overflow-x-auto border-b border-(--line) p-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {PULL_REQUEST_FILTERS.map((entry) => (
                <TabsTrigger key={entry} value={entry} className="flex-none gap-1.5 px-0.5 text-control">
                  {t(PULL_REQUEST_FILTER_LABEL[entry])}
                  {count(entry) > 0 && (
                    <span className="min-w-4 rounded-full bg-fill px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
                      {count(entry)}
                    </span>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <OverlayScrollArea className="min-h-0 flex-1">
          <div ref={listRef} className="flex flex-col gap-px px-2 pt-2 pb-6" onKeyDown={move}>
            {unreachable.map(({ host, query }) => (
              <p
                key={host.id}
                role="status"
                className={cn(
                  'mx-2 my-1 flex items-center gap-1.5 text-caption',
                  query.isError ? 'text-bad' : 'text-muted-foreground',
                )}
              >
                {manyHosts && <DeviceIcon name={host.name} size={12} />}
                <span className="min-w-0 flex-1 truncate">
                  {[
                    manyHosts ? host.name : '',
                    host.status !== 'connected'
                      ? t('{0}. Its pull requests show when it is back.', { '0': statusText(host.status) })
                      : errorText(query.error),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {host.status === 'connected' && (
                  <Button variant="ghost" size="xs" onClick={() => void query.refetch()}>
                    {t('Retry')}
                  </Button>
                )}
              </p>
            ))}
            <RepositoryAccessNotices
              repos={attention}
              hostName={hostName}
              manyHosts={manyHosts}
              activeHost={activeHost}
            />
            {loading && !rows.length && <ContentSkeleton />}
            {rows.map(row)}
            {settled && !rows.length && (
              <Empty className="py-12">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <GitPullRequest />
                  </EmptyMedia>
                  <EmptyTitle>
                    {!reachable.length && !attention.length
                      ? t('No repositories with a hosting service')
                      : search
                        ? t('No pull requests match')
                        : filter === 'needs-you'
                          ? t('Nothing waiting on you')
                          : t('No pull requests here')}
                  </EmptyTitle>
                  <EmptyDescription>
                    {!reachable.length && !attention.length
                      ? t(
                          'Publish a project to GitHub, GitLab, Bitbucket or Azure DevOps to see its pull requests here.',
                        )
                      : filter === 'needs-you'
                        ? t('Reviews asked of you and your pull requests that are ready or blocked show here.')
                        : t('Try another tab or repository.')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </OverlayScrollArea>
      </section>
      <section
        aria-label={t('Pull request')}
        className={cn('min-h-0 min-w-0 flex-1 flex-col', selected ? 'flex' : 'hidden @min-[900px]:flex')}
      >
        {selected ? (
          <>
            <div className={cn('flex flex-none items-center gap-1 px-3 pt-2', !manyHosts && '@min-[900px]:hidden')}>
              <Button variant="ghost" size="sm" className="@min-[900px]:hidden" onClick={() => setSelected(null)}>
                <ArrowLeft size={13} />
                {t('Pull requests')}
              </Button>
              {manyHosts && (
                <PullRequestHost
                  row={selected}
                  name={hostName}
                  connected={connected}
                  onChange={(source) => setSelected({ ...selected, ...source })}
                />
              )}
            </div>
            <HostContent
              key={`${selected.host}\n${selected.pr.url}`}
              host={selected.host}
              fallback={
                <div className="flex-1 p-6">
                  <ContentSkeleton />
                </div>
              }
            >
              <PullRequestView
                taskId={projectCtx(selected.projectId)}
                view={{
                  kind: 'pull-request',
                  id: `pull-request:${selected.pr.url}`,
                  repoId: selected.repoId,
                  url: selected.pr.url,
                  number: selected.pr.number,
                  title: selected.pr.title,
                }}
              />
            </HostContent>
          </>
        ) : (
          <Empty className="flex-1">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <GitPullRequest />
              </EmptyMedia>
              <EmptyTitle>{t('Choose a pull request')}</EmptyTitle>
              <EmptyDescription>{t('It opens here with its checks, review threads and merge.')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </section>
    </div>
  )
}

/**
 * Which host the open pull request is read from and worked on: its thread and checkout live there. When several hosts
 * have its repository, the person can move it to another one that is connected.
 */
function PullRequestHost({
  row,
  name,
  connected,
  onChange,
}: {
  row: MergedPullRequestRow
  name: (host: string) => string
  connected: (host: string) => boolean
  onChange: (source: MergedPullRequestRow['sources'][number]) => void
}) {
  const choices = row.sources.filter(
    (source) => !source.outside && (source.host === row.host || connected(source.host)),
  )
  if (choices.length < 2)
    return (
      <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 px-1.5 text-caption text-muted-foreground">
        <DeviceIcon name={name(row.host)} size={12} />
        <span className="truncate">{t('On {0}', { '0': name(row.host) })}</span>
      </span>
    )
  return (
    <Dropdown
      label={t('Host for this pull request')}
      title={t('Its thread and checkout are on this host')}
      icon={<DeviceIcon name={name(row.host)} size={13} />}
      value={row.host}
      options={choices.map((source) => ({ value: source.host, label: t('On {0}', { '0': name(source.host) }) }))}
      onChange={(host) => {
        const source = choices.find((entry) => entry.host === host)
        if (source) onChange(source)
      }}
      className="ml-auto max-w-[220px]"
    />
  )
}
