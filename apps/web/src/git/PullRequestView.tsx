import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Bot,
  CircleCheck,
  CircleDot,
  CircleX,
  ExternalLink,
  GitMerge,
  MessageSquare,
  MessagesSquare,
  RefreshCw,
  RotateCcw,
  SquareArrowOutUpRight,
  X,
} from 'lucide-react'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import type { MergeMethod, PullRequestAction, PullRequestSummary, ViewDescriptor } from '@ramu/shared/types'
import { pullRequestStage } from '@ramu/shared/pullRequests'
import { cn } from 'cn'
import { Dialog, Dropdown } from '../Menu'
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

  const list = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequests', taskId, view.repoId, false),
    queryFn: () => call('forge.pullRequests', taskId, view.repoId, false, false),
    refetchInterval: () => (document.hasFocus() ? 60_000 : false),
  })
  const inOpen = list.data?.pullRequests.find((pr) => pr.url === view.url)
  const closedList = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequests', taskId, view.repoId, true),
    queryFn: () => call('forge.pullRequests', taskId, view.repoId, true, false),
    enabled: list.isSuccess && !inOpen,
  })
  const pr: PullRequestSummary | undefined =
    inOpen ?? closedList.data?.pullRequests.find((entry) => entry.url === view.url)
  const linked = (list.data?.threads ?? closedList.data?.threads ?? {})[view.url] ?? []
  const drafts = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.drafts', view.url),
    queryFn: () => call('forge.drafts', view.url),
  })
  const threads = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.reviewThreads', taskId, view.repoId, view.url),
    queryFn: () => call('forge.reviewThreads', taskId, view.repoId, view.url),
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

  const run = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await work()
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const act = (action: PullRequestAction) =>
    run(action.kind, () => invoke('forge.pullRequestAction', taskId, view.repoId, view.url, action))

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

  /** Hands the open review threads to the thread working on this pull request, as one round. */
  const sendThreadsToAgent = (threadTaskId: string) =>
    run('reviews', async () => {
      const sessionId = await invoke('forge.sendFeedback', threadTaskId, view.repoId, 'reviews')
      if (sessionId) {
        ws.openTask(threadTaskId)
        ws.openView(threadTaskId, { kind: 'agent', sessionId })
        return
      }
      const prompt = await invoke('forge.pullRequestFeedback', threadTaskId, view.repoId, 'reviews')
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
  if (!pr)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <p className="m-0">
          {list.error ? errorText(list.error) : t('This pull request was not found with this account.')}
        </p>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw size={13} />
          {t('Try again')}
        </Button>
      </div>
    )

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
  const thread = linked.at(-1)

  return (
    <OverlayScrollArea className="flex-1 min-h-0">
      <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 p-6">
        <header className="flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <PullRequestIcon pr={pr} stage={stage} size={18} className="mt-1" />
            <h2 className="m-0 min-w-0 flex-1 text-[length:var(--font-title,18px)] font-semibold leading-snug [overflow-wrap:anywhere]">
              {pr.title} <span className="font-normal text-muted-foreground">#{pr.number}</span>
            </h2>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('Refresh')}
              title={t('Refresh')}
              disabled={!!busy}
              onClick={() => void run('refresh', () => Promise.resolve())}
            >
              <RefreshCw size={13} className={cn(busy === 'refresh' && 'animate-spin')} />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[26px] text-caption text-muted-foreground">
            <StageChip stage={stage} />
            {pr.author && <span>{pr.author}</span>}
            <span className="font-mono">
              {pr.headBranch} → {pr.baseBranch}
            </span>
            {pr.fork && <span>{t('From a fork')}</span>}
            <ChecksLine checks={pr.checks} />
            {pr.reviewDecision === 'approved' && <span className="text-ok">{t('Approved')}</span>}
            {pr.reviewDecision === 'changes-requested' && <span className="text-warn">{t('Changes requested')}</span>}
            {pr.requestedReviewers.length > 0 && (
              <span>{t('Review requested from {0}', { '0': pr.requestedReviewers.join(', ') })}</span>
            )}
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              {t('Open on the hosting service')}
              <ExternalLink size={11} />
            </a>
          </div>
        </header>

        <div className="flex flex-wrap gap-1.5">
          {thread ? (
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
          {open && !mine && !thread && (
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
              onClick={() => void sendThreadsToAgent(thread.taskId)}
            >
              <MessageSquare size={13} />
              {busy === 'reviews' ? t('Starting…') : t('Address review comments')}
            </Button>
          )}
          {open && pr.draft && (
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void act({ kind: 'ready' })}>
              {t('Ready for review')}
            </Button>
          )}
          {open && (pr.mergeable === 'behind' || pr.mergeable === 'conflicts') && (
            <Button
              variant="secondary"
              size="sm"
              disabled={!!busy}
              title={pr.mergeable === 'conflicts' ? t('Conflicts need resolving in a thread first') : undefined}
              onClick={() => void act({ kind: 'update-branch' })}
            >
              <RotateCcw size={13} />
              {busy === 'update-branch' ? t('Updating…') : t('Update branch')}
            </Button>
          )}
          {open && (
            <Button variant="secondary" size="sm" disabled={!!busy || pr.draft} onClick={() => setMerging(true)}>
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
        </div>
        {error && <p className="m-0 whitespace-pre-wrap text-caption text-bad">{error}</p>}
        {pr.fork && !mine && open && (
          <p className="m-0 text-caption text-muted-foreground">
            {t('This pull request comes from a fork: an agent can review it here, but pushing to it needs its author.')}
          </p>
        )}

        {batch && <ReviewDraftsCard key={batch.id} batch={batch} onDone={() => void refresh()} />}

        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-control font-semibold">
            {t('Open review threads')}
            {openThreads.length ? (
              <span className="ml-1.5 font-normal text-muted-foreground">{openThreads.length}</span>
            ) : null}
          </h3>
          {threads.isPending && <ContentSkeleton />}
          {threads.isError && <p className="m-0 text-caption text-bad">{errorText(threads.error)}</p>}
          {threads.isSuccess && !openThreads.length && (
            <p className="m-0 text-caption text-muted-foreground">{t('No open review threads.')}</p>
          )}
          {openThreads.map((entry) => (
            <article key={entry.id} className="flex flex-col gap-1.5 rounded-(--radius-s) border border-line p-2.5">
              <div className="text-caption text-muted-foreground">
                {entry.path ? `${entry.path}${entry.line ? `:${entry.line}` : ''}` : t('Conversation')}
                {entry.outdated && ` · ${t('Outdated')}`}
              </div>
              {entry.comments.map((comment) => (
                <div key={comment.id} className="text-control [overflow-wrap:anywhere] whitespace-pre-wrap">
                  <span className="font-medium">{comment.author ?? t('Someone')}</span>
                  {comment.bot && <span className="ml-1 text-caption text-muted-foreground">{t('bot')}</span>}
                  {!comment.trusted && (
                    <span className="ml-1 text-caption text-warn">{t('From outside the project')}</span>
                  )}
                  <div className="text-soft">{comment.body}</div>
                </div>
              ))}
            </article>
          ))}
        </section>
      </div>
      {merging && (
        <MergeDialog
          taskId={taskId}
          repoId={view.repoId}
          url={view.url}
          threadTaskId={thread?.taskId ?? null}
          onClose={(merged) => {
            setMerging(false)
            if (merged) void refresh()
          }}
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
  threadTaskId,
  onClose,
}: {
  taskId: string
  repoId: string
  url: string
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
        kind: 'merge',
        method: chosen,
        deleteBranch: deleteBranch && !!options.data?.canDeleteBranch,
      })
      try {
        localStorage.setItem(LAST_METHOD + repoId, chosen)
      } catch {
        // Remembering the method is a convenience.
      }
      if (markDone && threadTaskId) await invoke('tasks.done', threadTaskId, true).catch(() => {})
      onClose(true)
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  return (
    <Dialog
      title={t('Merge pull request')}
      confirmLabel={busy ? t('Merging…') : t('Merge')}
      confirmDisabled={!chosen || !!blockers.length || options.isPending}
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
        {threadTaskId && (
          <label className="flex items-center gap-2 text-control">
            <Checkbox checked={markDone} onCheckedChange={(checked) => setMarkDone(checked === true)} />
            {t('Mark its thread done')}
          </label>
        )}
      </div>
    </Dialog>
  )
}
