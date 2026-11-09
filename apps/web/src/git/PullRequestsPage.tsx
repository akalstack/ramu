import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
  FORGE_NAMES,
  pullRequestRef,
  pullRequestRows,
  sortPullRequestRows,
  type PullRequestFilter,
  type PullRequestRow,
  type PullRequestSort,
} from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t, useLanguage } from '../i18n'
import { Dropdown, timeAgo } from '../Menu'
import { ipcQueryKeyOn } from '../dataQueries'
import { useHost } from '../workspace/HostProvider'
import { projectCtx, type useWorkspace } from '../workspace/workspace'
import { ForgeAccessPanel } from '../sidebar/scm/ForgeAccessPanel'
import { queryInvokerFor } from './hostQuery'
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
/** A repository asked for before the page mounted, such as from a thread's Source Control. */
let pendingRepo: string | null = null

/** Opens the Pull requests page, narrowed to one repository when given. */
export function showPullRequests(ws: ReturnType<typeof useWorkspace>, repoId: string | null = null) {
  pendingRepo = repoId
  window.dispatchEvent(new CustomEvent(FILTER_EVENT, { detail: repoId }))
  ws.setSidebar('pulls')
}

/** Every repository's pull requests on this host, refreshed while the window has focus. */
export function useAllPullRequests(includeClosed: boolean, enabled = true) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  return useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.allPullRequests', includeClosed),
    queryFn: () => call('forge.allPullRequests', includeClosed, false),
    enabled,
    refetchInterval: () => (document.hasFocus() ? 120_000 : false),
  })
}

/** How many open pull requests wait on the person, for the sidebar's badge. */
export function usePullRequestsWaiting(): number {
  const { data } = useAllPullRequests(false)
  return useMemo(
    () => pullRequestRows(data ?? []).filter((row) => inPullRequestFilter(row, 'needs-you')).length,
    [data],
  )
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
 * Every pull request across this host's projects in one list, as GitHub's own page shows them across repositories,
 * with what only Ramu knows: the thread working on each one, replies an agent drafted, and the next step that is
 * yours. Choosing one shows it in full beside the list.
 */
export function PullRequestsPage() {
  useLanguage()
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const [filter, setFilter] = useState<PullRequestFilter>('needs-you')
  const [repoId, setRepoId] = useState<string>(() => pendingRepo ?? ALL)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<PullRequestRow | null>(null)
  const [sort, setSort] = useState<PullRequestSort>(savedSort)
  const [refreshing, setRefreshing] = useState(false)
  const open = useAllPullRequests(false)
  const closed = useAllPullRequests(true, filter === 'closed')
  const query = filter === 'closed' ? closed : open

  useEffect(() => {
    pendingRepo = null
    const onFilter = (event: Event) => {
      setRepoId((event as CustomEvent<string | null>).detail ?? ALL)
      setSelected(null)
      pendingRepo = null
    }
    window.addEventListener(FILTER_EVENT, onFilter)
    return () => window.removeEventListener(FILTER_EVENT, onFilter)
  }, [])

  const { refetch } = query
  useEffect(() => {
    const refresh = () => void refetch()
    window.addEventListener('ramu:git-updated', refresh)
    return () => window.removeEventListener('ramu:git-updated', refresh)
  }, [refetch])

  const repositories: RepositoryPullRequests[] = useMemo(() => query.data ?? [], [query.data])
  const allRows = useMemo(() => pullRequestRows(repositories), [repositories])
  // The repository picker also narrows to one service: a value of `service:<id>`.
  const inScope = (entry: { repoId: string; service?: ForgeService }) =>
    repoId === ALL ||
    (repoId.startsWith(SERVICE)
      ? (entry.service ?? 'github') === repoId.slice(SERVICE.length)
      : entry.repoId === repoId)
  const scoped = allRows.filter((row) => inScope(row) && matchesPullRequestRow(row, search))
  const rows = sortPullRequestRows(
    scoped.filter((row) => inPullRequestFilter(row, filter)),
    sort,
  )
  // Counts come from the open list, so switching to Merged and closed does not blank them.
  const openRows = useMemo(() => pullRequestRows(open.data ?? []), [open.data])
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

  const refresh = async () => {
    setRefreshing(true)
    try {
      await call('forge.allPullRequests', filter === 'closed', true).catch(() => {})
      await query.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const row = (entry: PullRequestRow) => {
    const { pr } = entry
    const thread = entry.threads.at(-1)
    const active = selected?.pr.url === pr.url
    return (
      <RowButton
        key={pr.url}
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
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-[21px] text-caption text-muted-foreground">
          <span className="inline-flex min-w-0 flex-none items-center gap-1" title={FORGE_NAMES[entry.service]}>
            <BrandIcon brand={forgeBrand(entry.service)} size={11} className="flex-none" />
            <span className="truncate">
              {repoLabel(entry)} {pullRequestRef(entry.service, pr.number)}
            </span>
          </span>
          <ChecksMark checks={pr.checks} />
          <StageChip stage={entry.stage} />
          {!!pr.openThreads && (
            <span className="inline-flex flex-none items-center gap-0.5" title={t('Open review threads')}>
              <MessageSquare size={10} aria-hidden="true" />
              {pr.openThreads}
            </span>
          )}
          {pr.labels?.slice(0, 2).map((label) => (
            <span key={label} className="flex-none rounded-full bg-fill px-1.5 text-[11px] leading-4">
              {label}
            </span>
          ))}
          <span className="min-w-0 truncate">
            {pr.author ?? ''}
            {thread ? ` · ${t('In {0}', { '0': thread.title })}` : ''}
          </span>
        </span>
      </RowButton>
    )
  }

  const services = [...new Set(repositories.map((repo) => repo.service ?? 'github'))]
  const repoOptions = [
    { value: ALL, label: t('All repositories') },
    // With more than one service, each can be chosen whole, and each repository says which it is on.
    ...(services.length > 1
      ? services.map((service) => ({
          value: `${SERVICE}${service}`,
          label: t('All on {0}', { '0': FORGE_NAMES[service] }),
        }))
      : []),
    ...repositories.map((repo) => ({
      value: repo.repoId,
      label: services.length > 1 ? `${repoLabel(repo)} · ${FORGE_NAMES[repo.service ?? 'github']}` : repoLabel(repo),
    })),
  ]

  return (
    <div className="@container flex min-h-0 min-w-0 flex-1">
      <section
        aria-label={t('Pull requests')}
        className={cn(
          'flex min-h-0 w-full flex-col @min-[900px]:w-[460px] @min-[900px]:flex-none @min-[900px]:border-r @min-[900px]:border-(--line)',
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
              <RefreshCw size={14} className={cn((refreshing || query.isFetching) && 'animate-spin')} />
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
            {repositories.length > 1 && (
              <Dropdown
                label={t('Repository')}
                value={repoId}
                options={repoOptions}
                onChange={(value) => {
                  setRepoId(value)
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
          <div className="flex flex-col gap-px px-2 pt-1 pb-6">
            {attention.map((repo) => (
              <div key={repo.repoId} className="mx-2 my-1 flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">{repoLabel(repo)}</span>
                {repo.error ? (
                  <p className="m-0 text-caption text-bad">{repo.error}</p>
                ) : (
                  <ForgeAccessPanel
                    taskId={projectCtx(repo.projectId)}
                    repoId={repo.repoId}
                    unavailable={repo.availability}
                    service={repo.service}
                  />
                )}
              </div>
            ))}
            {query.isPending && <ContentSkeleton />}
            {query.isError && <p className="m-2 text-caption text-bad">{String(query.error.message)}</p>}
            {rows.map(row)}
            {query.isSuccess && !rows.length && (
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
            <div className="flex flex-none items-center gap-1 px-3 pt-2 @min-[900px]:hidden">
              <Button variant="ghost" size="sm" onClick={() => setSelected(null)}>
                <ArrowLeft size={13} />
                {t('Pull requests')}
              </Button>
            </div>
            <PullRequestView
              key={selected.pr.url}
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
