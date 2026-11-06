import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, CircleCheck, CircleDot, CircleX, MessageSquare, RefreshCw, Search } from 'lucide-react'
import { ContentSkeleton } from '@/components/content-skeleton'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { RowButton } from '@/components/row-button'
import type { PullRequestGroup, PullRequestSummary, RepositoryBinding } from '@ramu/shared/types'
import { groupPullRequests, matchesPullRequest, pullRequestStage } from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { t } from '../../i18n'
import { ipcQueryKeyOn } from '../../dataQueries'
import { queryInvokerFor } from '../../git/hostQuery'
import { PullRequestIcon, StageChip } from '../../git/PullRequestIcon'
import { useHost } from '../../workspace/HostProvider'
import { useWorkspace } from '../../workspace/workspace'
import { ForgeAccessPanel } from './ForgeAccessPanel'
import { ICON_BUTTON } from './classes'

const GROUP_LABEL: Record<PullRequestGroup, string> = {
  mine: 'Yours',
  review: 'Review requested',
  other: 'Other open',
}

function ChecksMark({ checks }: { checks: PullRequestSummary['checks'] }) {
  if (checks === 'failure') return <CircleX size={11} className="flex-none text-bad" aria-label={t('Checks failing')} />
  if (checks === 'pending')
    return <CircleDot size={11} className="flex-none text-warn" aria-label={t('Checks running')} />
  if (checks === 'success')
    return <CircleCheck size={11} className="flex-none text-ok" aria-label={t('Checks passed')} />
  return null
}

/** The repository's pull requests: yours, those waiting on your review, and the rest. Opening one shows it in full. */
export function PullRequestsPane({
  taskId,
  binding,
  enabled,
}: {
  taskId: string
  binding: RepositoryBinding
  enabled: boolean
}) {
  const host = useHost()
  const ws = useWorkspace()
  const call = queryInvokerFor(host.id)
  const [search, setSearch] = useState('')
  const [showClosed, setShowClosed] = useState(false)
  const [openOther, setOpenOther] = useState(false)
  const query = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequests', taskId, binding.repoId, showClosed),
    queryFn: () => call('forge.pullRequests', taskId, binding.repoId, showClosed, false),
    enabled,
    refetchInterval: () => (document.hasFocus() ? 60_000 : false),
  })
  const { refetch } = query
  useEffect(() => {
    if (!enabled) return
    const refresh = () => void refetch()
    window.addEventListener('ramu:git-updated', refresh)
    return () => window.removeEventListener('ramu:git-updated', refresh)
  }, [enabled, refetch])

  const rows = useMemo(
    () => (query.data?.pullRequests ?? []).filter((pr) => matchesPullRequest(pr, search)),
    [query.data, search],
  )
  const open = rows.filter((pr) => pr.state === 'open')
  const closed = rows.filter((pr) => pr.state !== 'open').sort((a, b) => b.updatedAt - a.updatedAt)
  const groups = groupPullRequests(open)
  const threads = query.data?.threads ?? {}

  const openPullRequest = (pr: PullRequestSummary) =>
    ws.openView(taskId, {
      kind: 'pull-request',
      repoId: binding.repoId,
      url: pr.url,
      number: pr.number,
      title: pr.title,
    })

  const row = (pr: PullRequestSummary) => {
    const stage = pullRequestStage(pr)
    const linked = threads[pr.url] ?? []
    return (
      <RowButton key={pr.url} size="sm" stacked className="py-1" title={pr.title} onClick={() => openPullRequest(pr)}>
        <span className="flex w-full min-w-0 items-center gap-1.5">
          <PullRequestIcon pr={pr} stage={stage} />
          <span className="flex-none tabular-nums text-muted-foreground">#{pr.number}</span>
          <span className="min-w-0 truncate text-foreground">{pr.title}</span>
        </span>
        <span className="flex w-full min-w-0 items-center gap-1.5 pl-[19px] text-caption text-muted-foreground">
          <ChecksMark checks={pr.checks} />
          <StageChip stage={stage} />
          {!!pr.openThreads && (
            <span className="inline-flex flex-none items-center gap-0.5" title={t('Open review threads')}>
              <MessageSquare size={10} aria-hidden="true" />
              {pr.openThreads}
            </span>
          )}
          <span className="min-w-0 truncate">
            {pr.author ?? ''}
            {linked.length ? ` · ${t('In {0}', { '0': linked.at(-1)!.title })}` : ''}
          </span>
        </span>
      </RowButton>
    )
  }

  const data = query.data
  return (
    <TabsContent value="pulls" className="git-pane git-pulls">
      <div className="flex flex-none items-center gap-1 pb-1">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('Filter pull requests')}
            aria-label={t('Filter pull requests')}
            className="h-7 pl-6 text-control"
          />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON}
          aria-label={t('Refresh pull requests')}
          title={t('Refresh')}
          disabled={query.isFetching}
          onClick={() =>
            void call('forge.pullRequests', taskId, binding.repoId, showClosed, true).then(() => refetch())
          }
        >
          <RefreshCw size={13} className={cn(query.isFetching && 'animate-spin')} />
        </Button>
      </div>
      <OverlayScrollArea className="git-history">
        {data &&
          data.availability !== 'ready' &&
          data.availability !== 'not-github' &&
          data.availability !== 'no-remote' && (
            <ForgeAccessPanel
              taskId={taskId}
              repoId={binding.repoId}
              unavailable={data.availability}
              service={data.service}
            />
          )}
        {data?.availability === 'no-remote' && (
          <p className="git-empty m-[2px_0] p-1.5 text-caption text-muted-foreground">
            {t('Publish this repository to see its pull requests.')}
          </p>
        )}
        {groups.map(({ group, rows: items }) =>
          group === 'other' ? (
            <div key={group} className="flex flex-col">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 justify-start gap-1 px-1 text-caption text-muted-foreground"
                aria-expanded={openOther || !!search}
                onClick={() => setOpenOther((value) => !value)}
              >
                <ChevronRight size={12} className={cn('transition-transform', (openOther || search) && 'rotate-90')} />
                {t(GROUP_LABEL[group])} · {items.length}
              </Button>
              {(openOther || !!search) && items.map(row)}
            </div>
          ) : (
            <div key={group} className="flex flex-col">
              <div className="flex h-6 items-center px-1 text-caption text-muted-foreground">
                {t(GROUP_LABEL[group])} · {items.length}
              </div>
              {items.map(row)}
            </div>
          ),
        )}
        {showClosed && !!closed.length && (
          <div className="flex flex-col">
            <div className="flex h-6 items-center px-1 text-caption text-muted-foreground">
              {t('Merged and closed')} · {closed.length}
            </div>
            {closed.map(row)}
          </div>
        )}
        {query.isPending && enabled && <ContentSkeleton />}
        {data?.availability === 'ready' && !rows.length && (
          <p className="git-empty m-[2px_0] p-1.5 text-caption text-muted-foreground">
            {search ? t('No pull requests match.') : t('No open pull requests.')}
          </p>
        )}
        {data?.availability === 'ready' && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-1 h-6 justify-start px-1 text-caption text-muted-foreground"
            onClick={() => setShowClosed((value) => !value)}
          >
            {showClosed ? t('Hide merged and closed') : t('Show merged and closed')}
          </Button>
        )}
        {query.isError && (
          <p className="git-empty m-[2px_0] p-1.5 text-caption text-bad">{String(query.error.message)}</p>
        )}
      </OverlayScrollArea>
    </TabsContent>
  )
}
