import { useEffect, useState } from 'react'
import { keptPullRequestRead } from './keptPullRequests'
import { PullRequestTimeline } from './PullRequestTimeline'
import { PullRequestFiles, usePullRequestFiles } from './PullRequestFiles'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PullRequestMarkdown } from './PullRequestMarkdown'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  FolderDown,
  GitBranch,
  GitPullRequest,
  Info,
  LayoutList,
  FileDiff,
  GitMerge,
  MessageSquare,
  MessagesSquare,
  MoreHorizontal,
  RefreshCw,
  RotateCcw,
  SquareArrowOutUpRight,
  TriangleAlert,
  X,
} from 'lucide-react'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import type {
  MergeMethod,
  PullRequestAction,
  PullRequestFeedbackKind,
  PullRequestSummary,
  ViewDescriptor,
} from '@ramu/shared/types'
import {
  FORGE_NAMES,
  outsideRepository,
  pullRequestNextStep,
  pullRequestRef,
  pullRequestStage,
  shownReviewThreads,
  type PullRequestNextStep,
} from '@ramu/shared/pullRequests'
import { PullRequestReadiness } from './PullRequestReadiness'
import { forgeBrand } from '@ramu/shared/brands'
import { BrandIcon } from '@/components/brand-icon'
import { cn } from 'cn'
import { Dialog, Dropdown, Menu, timeAgo, type MenuEntry } from '../Menu'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/desktop-input'
import { SearchField } from '@/components/search-field'
import { supportsPullRequest } from '@ramu/shared/pullRequestSupport'
import type { ForgeService, PullRequestWrite } from '@ramu/shared/types'
import { PullRequestConversation, ReactionMenu } from './PullRequestConversation'
import { t, useLanguage } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { useModelSets } from '../models/ModelSets'
import { errorText } from '../workspace/TaskPane'
import { useHostRuntime, useWorkspace } from '../workspace/workspace'
import { useHost } from '../workspace/HostProvider'
import { queryInvokerFor } from './hostQuery'
import { PullRequestIcon, StageChip } from './PullRequestIcon'
import { ReviewDraftsCard } from './ReviewDraftsCard'
import { openPullRequestThread } from './pullRequestThreads'
import { ReviewThread } from './ReviewThread'
import { useAddProject } from '../workspace/addProject'
import { PullRequestNotice, RawError, readFailureText } from './PullRequestNotice'

type View = Extract<ViewDescriptor, { kind: 'pull-request' }>

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
}

const LAST_METHOD = 'ramu:merge-method:'

function storedMethod(repoId: string): MergeMethod | null {
  try {
    const value = localStorage.getItem(LAST_METHOD + repoId)
    return value === 'merge' || value === 'squash' || value === 'rebase' ? value : null
  } catch {
    return null
  }
}

/**
 * One pull request in full: where it stands, what was drafted for it, its open review threads, and every action from
 * opening it in a thread to merging it.
 */
export function PullRequestView({ taskId, view }: { taskId: string; view: View }) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { invoke } = host
  const call = queryInvokerFor(host.id)
  const { initialSettings } = useModelSets()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [closing, setClosing] = useState(false)
  const [people, setPeople] = useState<'reviewers' | 'labels' | 'assignees' | null>(null)
  const [tab, setTab] = useState<'overview' | 'files'>('overview')
  const [threadFilter, setThreadFilter] = useState<'open' | 'resolved' | 'all'>('open')
  const [threadOrder, setThreadOrder] = useState<'newest' | 'oldest'>('newest')
  const [threadSearch, setThreadSearch] = useState('')
  const fileCount = usePullRequestFiles(taskId, view.repoId, view.url)
  // A repository no project holds is read and acted on through the service; work in a thread needs it cloned first.
  const outside = outsideRepository(view.repoId)
  const addProject = useAddProject(host.id)

  const list = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequests', taskId, view.repoId, false),
    queryFn: () => call('forge.pullRequests', taskId, view.repoId, false, false),
    ...keptPullRequestRead(host.id, 'forge.pullRequests', taskId, view.repoId, false),
    refetchInterval: () => (document.hasFocus() ? 60_000 : false),
  })
  const inOpen = list.data?.pullRequests.find((pr) => pr.url === view.url)
  const closedList = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequests', taskId, view.repoId, true),
    queryFn: () => call('forge.pullRequests', taskId, view.repoId, true, false),
    ...keptPullRequestRead(host.id, 'forge.pullRequests', taskId, view.repoId, true),
    enabled: list.isSuccess && !inOpen,
  })
  const pr: PullRequestSummary | undefined =
    inOpen ?? closedList.data?.pullRequests.find((entry) => entry.url === view.url)
  const linked = (list.data?.threads ?? closedList.data?.threads ?? {})[view.url] ?? []
  // A list without a service is GitHub's.
  const service = list.data?.service ?? closedList.data?.service ?? 'github'
  const drafts = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.drafts', view.url),
    queryFn: () => call('forge.drafts', view.url),
    ...keptPullRequestRead(host.id, 'forge.drafts', view.url),
  })
  const description = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestDescription', taskId, view.repoId, view.url),
    queryFn: () => call('forge.pullRequestDescription', taskId, view.repoId, view.url),
    ...keptPullRequestRead(host.id, 'forge.pullRequestDescription', taskId, view.repoId, view.url),
    staleTime: 60_000,
  })
  const threads = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.reviewThreads', taskId, view.repoId, view.url),
    queryFn: () => call('forge.reviewThreads', taskId, view.repoId, view.url),
    ...keptPullRequestRead(host.id, 'forge.reviewThreads', taskId, view.repoId, view.url),
    enabled: !!pr,
  })
  const { refetch: refetchDrafts } = drafts
  const { on } = useHostRuntime()
  useEffect(
    () =>
      // Drafts arrive while the agent works; the host announces them with the thread lists.
      on('workspace:changed', () => {
        void refetchDrafts()
      }),
    [on, refetchDrafts],
  )

  const refresh = async () => {
    await call('forge.pullRequests', taskId, view.repoId, false, true).catch(() => {})
    await Promise.all([list.refetch(), threads.refetch(), drafts.refetch(), closedList.refetch()])
    window.dispatchEvent(new Event('ramu:git-updated'))
  }

  /** Whether the work went through, so a dialog that started it stays open on its error instead of losing its input. */
  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await work()
      await refresh()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(null)
    }
  }

  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null)
  const [threadsDetails, setThreadsDetails] = useState(false)
  /** The service updates the branch when it can; otherwise the thread's checkout merges the base in and pushes. */
  const updateBranch = () =>
    run('update-branch', async () => {
      setNotice(null)
      const result = await invoke('forge.updateBranch', taskId, view.repoId, view.url)
      if (result.conflicts && result.taskId) {
        ws.openTask(result.taskId)
        setNotice({
          text: t(
            '{0} files have conflicts. Choose a side for each in Source Control → Merge changes, then continue the merge.',
            {
              '0': String(result.conflicts),
            },
          ),
          warn: true,
        })
      } else if (result.pushed) setNotice({ text: t('The base branch was merged in and pushed.'), warn: false })
    })

  const act = (action: PullRequestAction) =>
    run(action.kind, () => invoke('forge.pullRequestAction', taskId, view.repoId, view.url, action))
  /** The person's own actions go through the call an agent's card posts with. */
  const write = (label: string, change: PullRequestWrite) =>
    run(label, () => invoke('forge.pullRequestWrite', taskId, view.repoId, view.url, change))

  const openThread = (purpose: 'work' | 'review') =>
    run(purpose, () =>
      openPullRequestThread(ws, invoke, {
        taskId,
        repoId: view.repoId,
        url: view.url,
        purpose,
        settings: initialSettings,
      }),
    )

  /** Hands the failing checks or the open review threads to the thread working on this pull request, as one round. */
  const sendFeedbackToAgent = (threadTaskId: string, kind: PullRequestFeedbackKind = 'reviews') =>
    run(kind, async () => {
      const sessionId = await invoke('forge.sendFeedback', threadTaskId, view.repoId, kind)
      if (sessionId) {
        ws.openTask(threadTaskId)
        ws.openView(threadTaskId, { kind: 'agent', sessionId })
        return
      }
      const prompt = await invoke('forge.pullRequestFeedback', threadTaskId, view.repoId, kind)
      const session = (await invoke('agent.list', threadTaskId)).findLast((entry) => !entry.parentId)
      if (!session) throw new Error(t('Open the thread and start its agent first.'))
      await invoke('agent.submit', session.id, prompt, 'queue', [], [])
      ws.openTask(threadTaskId)
      ws.openView(threadTaskId, { kind: 'agent', sessionId: session.id })
    })

  if (list.isPending || (!inOpen && closedList.isPending && list.isSuccess))
    return (
      <div className="flex-1 p-6">
        <ContentSkeleton />
      </div>
    )
  if (!pr) {
    const failure = list.error ? errorText(list.error) : null
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyMedia variant="icon">{failure ? <TriangleAlert /> : <GitPullRequest />}</EmptyMedia>
          <EmptyTitle>{failure ? t('This pull request could not be read') : t('Pull request not found')}</EmptyTitle>
          <EmptyDescription>
            {failure ? readFailureText(failure, service) : t('This pull request was not found with this account.')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="max-w-md">
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            <RefreshCw size={13} />
            {t('Try again')}
          </Button>
          {failure && <RawError>{failure}</RawError>}
        </EmptyContent>
      </Empty>
    )
  }

  const batch = drafts.data ?? null
  const stage = pullRequestStage(pr, {
    draftsReady:
      batch?.kind === 'review'
        ? !!batch.body || !!batch.comments.length
        : !!batch?.drafts.some((draft) => draft.outcome !== 'skipped' && !draft.postedId),
  })
  const open = pr.state === 'open'
  const mine = pr.group === 'mine'
  const openThreads = (threads.data ?? []).filter((thread) => !thread.resolved)
  const suggested = pullRequestNextStep(pr, stage, mine)
  // Without a checkout there is no thread to fix, resolve or review in; the clone button above is the next step.
  const step =
    outside &&
    (suggested === 'review' ||
      suggested === 'fix-checks' ||
      suggested === 'address-comments' ||
      suggested === 'resolve-conflicts')
      ? 'none'
      : suggested
  const takeStep = (next: PullRequestNextStep) => {
    if (next === 'merge') setMerging(true)
    else if (next === 'resolve-conflicts' || next === 'update-branch') void updateBranch()
    else if (next === 'mark-ready') void act({ kind: 'ready' })
    else if (next === 'review') void openThread('review')
    // Fixes go to the thread already on the pull request; without one, a new thread catches up on it first.
    else if (next === 'fix-checks' || next === 'address-comments') {
      const working = linked.at(-1)
      void (working
        ? sendFeedbackToAgent(working.taskId, next === 'fix-checks' ? 'checks' : 'reviews')
        : openThread('work'))
    }
  }
  const shownThreads = shownReviewThreads(threads.data ?? [], threadFilter, threadOrder, threadSearch)
  const thread = linked.at(-1)

  return (
    <OverlayScrollArea className="flex-1 min-h-0">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-start gap-2.5">
            <PullRequestIcon pr={pr} stage={stage} size={18} className="mt-1" />
            <h2 className="m-0 min-w-0 flex-1 text-[length:var(--font-title,18px)] font-semibold leading-snug [overflow-wrap:anywhere]">
              {pr.title} <span className="font-normal text-muted-foreground">{pullRequestRef(service, pr.number)}</span>
            </h2>
            <div className="flex flex-none items-center gap-0.5">
              <a
                href={pr.url}
                target="_blank"
                rel="noreferrer"
                title={t('Open on {0}', { '0': FORGE_NAMES[service] })}
                className="inline-flex h-6 items-center gap-1.5 rounded-(--radius-s) px-2 text-caption text-muted-foreground no-underline hover:bg-fill-hover hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <BrandIcon brand={forgeBrand(service)} size={12} />
                {t('Open on {0}', { '0': FORGE_NAMES[service] })}
                <ExternalLink size={11} aria-hidden="true" />
              </a>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={t('Refresh')}
                title={t('Refresh')}
                disabled={!!busy}
                onClick={() => void run('refresh', () => Promise.resolve())}
              >
                <RefreshCw size={13} className={cn(busy === 'refresh' && 'animate-spin motion-reduce:animate-none')} />
              </Button>
            </div>
          </div>
          {/* Who and where on one line, then what it waits on: the order a reviewer reads a pull request in. */}
          <div className="flex flex-col gap-1.5 pl-[28px] text-caption text-muted-foreground">
            <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
              <StageChip stage={stage} className="px-2 leading-5" />
              {pr.author && <span className="text-foreground">{pr.author}</span>}
              <span className="inline-flex min-w-0 items-center gap-1">
                {pr.author ? t('wants to merge') : null}
                <BranchName name={pr.headBranch} />
                <span aria-label={t('into')}>→</span>
                <BranchName name={pr.baseBranch} />
              </span>
              {pr.fork && (
                <span className="rounded-full border border-(--line) px-1.5 leading-4">{t('From a fork')}</span>
              )}
              <span aria-hidden="true">·</span>
              <span title={new Date(pr.updatedAt).toLocaleString()}>
                {t('Updated {0}', { '0': timeAgo(pr.updatedAt) })}
              </span>
            </div>
            {(pr.checks !== null ||
              pr.reviewDecision === 'approved' ||
              pr.reviewDecision === 'changes-requested' ||
              pr.requestedReviewers.length > 0 ||
              (pr.additions !== undefined && pr.deletions !== undefined)) && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                {/* The stage pill already says when checks fail or run; repeat them only when it is about something else. */}
                {stage !== 'checks-failing' && stage !== 'checks-pending' && <ChecksLine checks={pr.checks} />}
                {pr.reviewDecision === 'approved' && (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <CircleCheck size={11} aria-hidden="true" />
                    {t('Approved')}
                  </span>
                )}
                {pr.reviewDecision === 'changes-requested' && (
                  <span className="inline-flex items-center gap-1 text-warn">
                    <MessageSquare size={11} aria-hidden="true" />
                    {t('Changes requested')}
                  </span>
                )}
                {pr.requestedReviewers.length > 0 && (
                  <span className="min-w-0 truncate">
                    {t('Review requested from {0}', { '0': pr.requestedReviewers.join(', ') })}
                  </span>
                )}
                {pr.additions !== undefined && pr.deletions !== undefined && (
                  <span
                    className="tabular-nums"
                    title={t('{0} lines added, {1} removed', { '0': pr.additions, '1': pr.deletions })}
                  >
                    <span className="text-ok">+{pr.additions}</span> <span className="text-bad">−{pr.deletions}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Work on it with an agent on the left; change the pull request itself on the right. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {outside ? (
              <Button
                size="sm"
                disabled={addProject.busy}
                title={t('Clone it into a folder on the host and add it as a project')}
                onClick={() => void addProject.cloneProject(outside)}
              >
                <FolderDown size={13} />
                {t('Clone {0} as a project', { '0': outside })}
              </Button>
            ) : thread ? (
              <Button size="sm" onClick={() => ws.openTask(thread.taskId)}>
                <SquareArrowOutUpRight size={13} />
                {t('Open thread')}
              </Button>
            ) : (
              open && (
                <Button size="sm" disabled={!!busy || (pr.fork && !mine)} onClick={() => void openThread('work')}>
                  <MessagesSquare size={13} />
                  {busy === 'work' ? t('Starting…') : t('Open in thread')}
                </Button>
              )
            )}
            {open && !mine && !thread && !outside && (
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void openThread('review')}>
                <Bot size={13} />
                {busy === 'review' ? t('Starting…') : t('Review with agent')}
              </Button>
            )}
            {open && thread && openThreads.length > 0 && mine && (
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy}
                onClick={() => void sendFeedbackToAgent(thread.taskId)}
              >
                <MessageSquare size={13} />
                {busy === 'reviews' ? t('Starting…') : t('Address review comments')}
              </Button>
            )}
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {open && pr.draft && (
              <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void act({ kind: 'ready' })}>
                {t('Ready for review')}
              </Button>
            )}
            {open && (pr.mergeable === 'behind' || (pr.mergeable === 'conflicts' && !outside)) && (
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy}
                title={
                  pr.mergeable === 'conflicts'
                    ? t('Merges the base branch in the thread working on it, so you can resolve the conflicts there')
                    : undefined
                }
                onClick={() => void updateBranch()}
              >
                <RotateCcw size={13} />
                {busy === 'update-branch'
                  ? t('Updating…')
                  : pr.mergeable === 'conflicts'
                    ? t('Resolve conflicts')
                    : t('Update branch')}
              </Button>
            )}
            {open && (
              <Button
                variant="secondary"
                size="sm"
                disabled={!!busy || pr.draft}
                title={pr.draft ? t('Mark it ready for review before merging') : undefined}
                onClick={() => setMerging(true)}
              >
                <GitMerge size={13} />
                {t('Merge…')}
              </Button>
            )}
            {open ? (
              <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setClosing(true)}>
                <X size={13} />
                {t('Close')}
              </Button>
            ) : (
              pr.state === 'closed' && (
                <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => void act({ kind: 'reopen' })}>
                  {t('Reopen')}
                </Button>
              )
            )}
            {open && (
              <Menu
                label={t('More actions')}
                icon={<MoreHorizontal size={14} aria-hidden="true" />}
                disabled={!!busy}
                align="end"
                items={moreActions({
                  service,
                  pr,
                  onDraft: () => void act({ kind: 'draft' }),
                  onRerun: () => void write('rerun-checks', { kind: 'rerun-checks' }),
                  onPeople: (kind) => {
                    setError(null)
                    setPeople(kind)
                  },
                })}
              />
            )}
          </div>
        </div>
        {(error || notice || (outside && open) || (pr.fork && !mine && open && !outside)) && (
          <div className="flex flex-col gap-1">
            {error && !people && (
              <PullRequestNotice
                tone="bad"
                icon={<CircleX size={14} />}
                title={t('That did not go through')}
                detail={error}
                wrap
                live
                onDismiss={() => setError(null)}
              />
            )}
            {notice && (
              <PullRequestNotice
                tone={notice.warn ? 'warn' : 'muted'}
                icon={notice.warn ? <TriangleAlert size={14} /> : <CircleCheck size={14} />}
                title={notice.text}
                wrap
                live
                onDismiss={() => setNotice(null)}
              />
            )}
            {outside && open && (
              <PullRequestNotice
                icon={<Info size={14} />}
                title={t('Not in a project on this host')}
                detail={t(
                  '{0} is in no project on this host. Review, comment and merge here; clone it as a project to work on it in a thread or have an agent review it.',
                  { '0': outside },
                )}
                wrap
              />
            )}
            {pr.fork && !mine && open && !outside && (
              <PullRequestNotice
                icon={<Info size={14} />}
                title={t('From a fork')}
                detail={t(
                  'This pull request comes from a fork. An agent can review it here, but only its author can push to it.',
                )}
                wrap
              />
            )}
          </div>
        )}

        {/* As on the services: the conversation and the changed files, one tab each. */}
        <Tabs value={tab} onValueChange={(value) => setTab(value as 'overview' | 'files')} className="gap-4">
          <TabsList
            variant="line"
            // Pinned while scrolling, so either tab is one click away from anywhere in a long pull request.
            className="sticky top-0 z-20 h-9! w-full justify-start gap-4 border-b border-(--line) bg-canvas p-0"
          >
            <TabsTrigger value="overview" className="flex-none gap-1.5 px-0.5 text-control">
              <LayoutList size={14} />
              {t('Overview')}
            </TabsTrigger>
            <TabsTrigger value="files" className="flex-none gap-1.5 px-0.5 text-control">
              <FileDiff size={14} />
              {t('Files changed')}
              {!!fileCount.data?.files.length && (
                <span className="min-w-4 rounded-full bg-fill px-1.5 text-[11px] leading-4 text-muted-foreground tabular-nums">
                  {fileCount.data.files.length}
                  {fileCount.data.more ? '+' : ''}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="flex flex-col gap-5">
            <PullRequestReadiness
              pr={pr}
              openThreads={openThreads.length}
              step={step}
              busy={!!busy}
              onStep={takeStep}
            />
            {batch && <ReviewDraftsCard key={batch.id} batch={batch} onDone={() => void refresh()} />}

            {!!description.data?.trim() && (
              <section className="flex flex-col gap-1">
                <h3 className="m-0 text-control font-semibold">{t('Description')}</h3>
                {/* Descriptions are often HTML (Dependabot's are): rendered sanitized, as the service shows them. */}
                <PullRequestMarkdown className="text-body">{description.data}</PullRequestMarkdown>
              </section>
            )}

            <PullRequestTimeline taskId={taskId} repoId={view.repoId} url={view.url} />

            <PullRequestConversation
              taskId={taskId}
              repoId={view.repoId}
              url={view.url}
              service={service}
              open={open}
            />

            <section className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="m-0 text-control font-semibold">
                  {t('Review threads')}
                  {openThreads.length ? (
                    <span className="ml-1.5 font-normal text-muted-foreground">
                      {t('{0} unresolved', { '0': openThreads.length })}
                    </span>
                  ) : null}
                </h3>
                {/* Filters and an order, as GitHub's Overview page gives its comments. */}
                <div className="ml-auto flex min-w-0 items-center gap-1.5">
                  <SearchField
                    value={threadSearch}
                    onChange={setThreadSearch}
                    label={t('Search review threads')}
                    placeholder={t('Search comments, people or files')}
                    className="w-56"
                    inputClassName="h-7"
                  />
                  <Dropdown
                    label={t('Show')}
                    value={threadFilter}
                    options={[
                      { value: 'open', label: t('Unresolved') },
                      { value: 'resolved', label: t('Resolved') },
                      { value: 'all', label: t('All') },
                    ]}
                    onChange={(value) => setThreadFilter(value as 'open' | 'resolved' | 'all')}
                  />
                  <Dropdown
                    label={t('Sort')}
                    value={threadOrder}
                    options={[
                      { value: 'newest', label: t('Newest first') },
                      { value: 'oldest', label: t('Oldest first') },
                    ]}
                    onChange={(value) => setThreadOrder(value as 'newest' | 'oldest')}
                  />
                </div>
              </div>
              {threads.isPending && <ContentSkeleton />}
              {threads.isError && (
                <PullRequestNotice
                  tone="warn"
                  icon={<TriangleAlert size={14} />}
                  title={t('Review threads could not be loaded')}
                  detail={readFailureText(errorText(threads.error), service)}
                  expanded={threadsDetails}
                  onToggle={() => setThreadsDetails(!threadsDetails)}
                  actions={
                    <Button variant="secondary" size="xs" onClick={() => void threads.refetch()}>
                      <RefreshCw size={12} />
                      {t('Retry')}
                    </Button>
                  }
                >
                  <RawError>{errorText(threads.error)}</RawError>
                </PullRequestNotice>
              )}
              {threads.isSuccess && !shownThreads.length && (
                <p className="m-0 text-caption text-muted-foreground">
                  {threadSearch.trim()
                    ? t('No review thread matches “{0}”.', { '0': threadSearch.trim() })
                    : threadFilter === 'open'
                      ? t('No open review threads.')
                      : t('No review threads here.')}
                </p>
              )}
              {shownThreads.map((entry) => (
                <ReviewThread
                  key={entry.id}
                  thread={entry}
                  onWrite={open ? (change) => write(change.kind, change) : undefined}
                  commentActions={
                    supportsPullRequest(service, 'reactions')
                      ? (comment) => (
                          <ReactionMenu
                            service={service}
                            disabled={!!busy}
                            onReact={(reaction) =>
                              void write('react', { kind: 'react', commentId: comment.id, reaction, remove: false })
                            }
                          />
                        )
                      : undefined
                  }
                />
              ))}
            </section>
          </TabsContent>
          <TabsContent value="files">
            {tab === 'files' && (
              <PullRequestFiles
                taskId={taskId}
                repoId={view.repoId}
                url={view.url}
                threads={threads.data ?? []}
                canReview={open}
                own={mine}
                service={service}
                onReviewed={() => void refresh()}
              />
            )}
          </TabsContent>
        </Tabs>
      </div>
      {merging && (
        <MergeDialog
          taskId={taskId}
          repoId={view.repoId}
          url={view.url}
          service={service}
          threadTaskId={thread?.taskId ?? null}
          onClose={(merged) => {
            setMerging(false)
            if (merged) void refresh()
          }}
        />
      )}
      {people && (
        <PeopleDialog
          kind={people}
          current={people === 'reviewers' ? pr.requestedReviewers : people === 'labels' ? (pr.labels ?? []) : []}
          busy={busy === people}
          error={error}
          onCancel={() => setPeople(null)}
          onSave={(add, remove) =>
            void write(
              people,
              people === 'reviewers'
                ? { kind: 'reviewers', add, remove }
                : { kind: 'update', update: { [people]: { add, remove } } },
            ).then((done) => done && setPeople(null))
          }
        />
      )}
      {closing && (
        <Dialog
          title={t('Close pull request #{0}?', { '0': String(pr.number) })}
          confirmLabel={t('Close pull request')}
          danger
          busy={busy === 'close'}
          onConfirm={() => void act({ kind: 'close' }).then(() => setClosing(false))}
          onCancel={() => setClosing(false)}
        >
          <p className="m-0">{t('It can be reopened later. Its branch and threads stay.')}</p>
        </Dialog>
      )}
    </OverlayScrollArea>
  )
}

/** A branch name as a small code chip, cut short in narrow panes with the full name on hover. */
function BranchName({ name }: { name: string }) {
  return (
    <span
      title={name}
      className="inline-flex min-w-0 max-w-[260px] items-center gap-1 rounded-(--radius-xs) bg-fill px-1.5 font-mono text-[11px] leading-5 text-foreground"
    >
      <GitBranch size={10} className="flex-none text-muted-foreground" aria-hidden="true" />
      <span className="truncate">{name}</span>
    </span>
  )
}

function ChecksLine({ checks }: { checks: PullRequestSummary['checks'] }) {
  if (checks === 'failure')
    return (
      <span className="inline-flex items-center gap-1 text-bad">
        <CircleX size={11} />
        {t('Checks failing')}
      </span>
    )
  if (checks === 'pending')
    return (
      <span className="inline-flex items-center gap-1 text-warn">
        <CircleDot size={11} />
        {t('Checks running')}
      </span>
    )
  if (checks === 'success')
    return (
      <span className="inline-flex items-center gap-1 text-ok">
        <CircleCheck size={11} />
        {t('Checks passed')}
      </span>
    )
  return null
}

/** Merge with the method the repository allows, after saying what blocks it; then tidy up the thread. */
function MergeDialog({
  taskId,
  repoId,
  url,
  service,
  threadTaskId,
  onClose,
}: {
  taskId: string
  repoId: string
  url: string
  service: ForgeService
  threadTaskId: string | null
  onClose: (merged: boolean) => void
}) {
  const { invoke } = useHost()
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const options = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.mergeOptions', taskId, repoId, url),
    queryFn: () => call('forge.mergeOptions', taskId, repoId, url),
  })
  const [method, setMethod] = useState<MergeMethod | null>(storedMethod(repoId))
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [markDone, setMarkDone] = useState(true)
  const [whenChecksPass, setWhenChecksPass] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const methods = options.data?.methods ?? []
  const chosen = method && methods.includes(method) ? method : (methods[0] ?? null)
  const blockers = options.data?.blockers ?? []

  const merge = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.pullRequestAction', taskId, repoId, url, {
        kind: whenChecksPass ? 'auto-merge' : 'merge',
        method: chosen,
        deleteBranch: deleteBranch && !!options.data?.canDeleteBranch,
      })
      try {
        localStorage.setItem(LAST_METHOD + repoId, chosen)
      } catch {
        // Remembering the method is a convenience.
      }
      // An automatic merge happens later, so its thread stays open until it does.
      if (markDone && threadTaskId && !whenChecksPass) await invoke('tasks.done', threadTaskId, true).catch(() => {})
      onClose(true)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('Merge pull request')}
      confirmLabel={busy ? t('Merging…') : whenChecksPass ? t('Merge when checks pass') : t('Merge')}
      confirmDisabled={!chosen || (!!blockers.length && !whenChecksPass) || options.isPending}
      busy={busy}
      error={error ?? (options.isError ? errorText(options.error) : null)}
      onConfirm={() => void merge()}
      onCancel={() => onClose(false)}
    >
      <div className="flex flex-col gap-3">
        {options.isPending && <ContentSkeleton />}
        {!!blockers.length && (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption text-warn">
            {blockers.map((blocker) => (
              <li key={blocker}>{t(blocker)}</li>
            ))}
          </ul>
        )}
        {!!methods.length && (
          <Dropdown
            label={t('Merge method')}
            value={chosen ?? ''}
            options={methods.map((value) => ({ value, label: t(METHOD_LABEL[value]) }))}
            onChange={(value) => setMethod(value as MergeMethod)}
          />
        )}
        {options.data?.canDeleteBranch && (
          <label className="flex items-center gap-2 text-control">
            <Checkbox checked={deleteBranch} onCheckedChange={(checked) => setDeleteBranch(checked === true)} />
            {t('Delete the branch on the hosting service')}
          </label>
        )}
        {supportsPullRequest(service, 'auto-merge') && (
          <label className="flex items-center gap-2 text-control">
            <Checkbox checked={whenChecksPass} onCheckedChange={(checked) => setWhenChecksPass(checked === true)} />
            {t('Merge automatically once required checks pass')}
          </label>
        )}
        {threadTaskId && !whenChecksPass && (
          <label className="flex items-center gap-2 text-control">
            <Checkbox checked={markDone} onCheckedChange={(checked) => setMarkDone(checked === true)} />
            {t('Mark its thread done')}
          </label>
        )}
      </div>
    </Dialog>
  )
}

/** The rarer actions, offered only where the service has them. */
function moreActions({
  service,
  pr,
  onDraft,
  onRerun,
  onPeople,
}: {
  service: ForgeService
  pr: PullRequestSummary
  onDraft: () => void
  onRerun: () => void
  onPeople: (kind: 'reviewers' | 'labels' | 'assignees') => void
}): MenuEntry[] {
  return [
    ...(supportsPullRequest(service, 'reviewers')
      ? [{ key: 'reviewers', label: t('Reviewers…'), onSelect: () => onPeople('reviewers') }]
      : []),
    ...(supportsPullRequest(service, 'labels')
      ? [{ key: 'labels', label: t('Labels…'), onSelect: () => onPeople('labels') }]
      : []),
    ...(supportsPullRequest(service, 'assignees')
      ? [{ key: 'assignees', label: t('Assignees…'), onSelect: () => onPeople('assignees') }]
      : []),
    ...(supportsPullRequest(service, 'rerun-checks') && pr.checks === 'failure'
      ? [{ key: 'rerun', label: t('Re-run failed checks'), onSelect: onRerun }]
      : []),
    ...(supportsPullRequest(service, 'draft') && !pr.draft
      ? [{ key: 'draft', label: t('Back to draft'), onSelect: onDraft }]
      : []),
  ]
}

const PEOPLE_TEXT = {
  reviewers: { title: 'Reviewers', placeholder: 'Logins, separated by commas' },
  labels: { title: 'Labels', placeholder: 'Labels, separated by commas' },
  assignees: { title: 'Assignees', placeholder: 'Logins, separated by commas' },
} as const

/** Reviewers, labels or assignees as one editable list; saving sends only what changed. */
function PeopleDialog({
  kind,
  current,
  busy,
  error,
  onSave,
  onCancel,
}: {
  kind: 'reviewers' | 'labels' | 'assignees'
  current: string[]
  busy: boolean
  error: string | null
  onSave: (add: string[], remove: string[]) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(current.join(', '))
  const next = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ]
  const add = next.filter((entry) => !current.includes(entry))
  const remove = current.filter((entry) => !next.includes(entry))
  const text = PEOPLE_TEXT[kind]
  return (
    <Dialog
      title={t(text.title)}
      confirmLabel={t('Save')}
      confirmDisabled={!add.length && !remove.length}
      busy={busy}
      error={error}
      onConfirm={() => onSave(add, remove)}
      onCancel={onCancel}
    >
      <Input
        autoFocus
        value={value}
        aria-label={t(text.title)}
        placeholder={t(text.placeholder)}
        onChange={(event) => setValue(event.target.value)}
      />
    </Dialog>
  )
}
