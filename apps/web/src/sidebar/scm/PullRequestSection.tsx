import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CircleCheck, CircleDot, CircleX, ExternalLink, GitPullRequest, MessageSquare, Wrench } from 'lucide-react'
import type {
  AgentSettings,
  ForgeCheck,
  GitStatus,
  PullRequestFeedbackKind,
  PullRequestInfo,
  RepositoryBinding,
} from '@ramu/shared/types'
import { cn } from 'cn'
import { Button } from '@/components/desktop-button'
import { Dropdown } from '../../Menu'
import { t } from '../../i18n'
import { ipcQueryKeyOn } from '../../dataQueries'
import { useModelSets } from '../../models/ModelSets'
import { errorText } from '../../workspace/TaskPane'
import { useHostRuntime, useWorkspace } from '../../workspace/workspace'
import { CreatePullRequestDialog } from './CreatePullRequestDialog'
import { ForgeAccessPanel } from './ForgeAccessPanel'
import { startCheckoutChat } from './startCheckoutChat'
import { useHost } from '../../workspace/HostProvider'
import { queryInvokerFor } from '../../git/hostQuery'

const STATE_LABEL: Record<PullRequestInfo['state'], string> = { open: 'Open', closed: 'Closed', merged: 'Merged' }

/** "2 failing, 1 pending, 5 passed", most urgent first. */
function checksSummary(checks: ForgeCheck[]): string {
  const count = (state: ForgeCheck['state']) => checks.filter((check) => check.state === state).length
  return [
    count('failure') && t('{0} failing', { '0': count('failure') }),
    count('pending') && t('{0} pending', { '0': count('pending') }),
    count('success') && t('{0} passed', { '0': count('success') }),
  ]
    .filter(Boolean)
    .join(' · ')
}

function ChecksIcon({ checks }: { checks: ForgeCheck[] }) {
  if (checks.some((check) => check.state === 'failure')) return <CircleX size={12} className="text-bad flex-none" />
  if (checks.some((check) => check.state === 'pending')) return <CircleDot size={12} className="text-warn flex-none" />
  return <CircleCheck size={12} className="text-ok flex-none" />
}

/**
 * The branch's pull request on GitHub: open one, follow its checks and reviews, and hand failing checks or
 * review comments to an agent in this checkout. Hidden when the repository is not on GitHub.
 */
export function PullRequestSection({
  taskId,
  binding,
  status,
  busy,
  settings,
  reportError,
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus | null
  busy: boolean
  settings: AgentSettings
  reportError: (message: string) => void
}) {
  const ws = useWorkspace()
  const host = useHost()
  const { invoke } = host
  const call = queryInvokerFor(host.id)
  const { on } = useHostRuntime()
  const { initialSettings } = useModelSets()
  const [creating, setCreating] = useState(false)
  const [starting, setStarting] = useState<PullRequestFeedbackKind | null>(null)
  const [watching, setWatching] = useState(false)
  const query = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequest', taskId, binding.repoId, status?.branch ?? null),
    queryFn: () => call('forge.pullRequest', taskId, binding.repoId),
    enabled: !!status?.remote,
  })
  const branchInfo = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'git.commitBranchInfo', taskId, binding.repoId, status?.branch ?? null),
    queryFn: () => call('git.commitBranchInfo', taskId, binding.repoId),
    enabled: !!status?.remote,
  })
  const pr = query.data?.pullRequest ?? null
  const watchQuery = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.watchStatus', taskId, binding.repoId, pr?.url ?? ''),
    queryFn: () => call('forge.watchStatus', taskId, binding.repoId, pr!.url),
    enabled: pr?.state === 'open',
  })
  const { refetch: refreshWatch } = watchQuery
  useEffect(() => {
    if (pr?.state !== 'open') return
    return on('workspace:changed', () => {
      void refreshWatch()
    })
  }, [on, refreshWatch, pr?.state])
  const { refetch } = query

  // Keep visible PR details fresh; opted-in feedback delivery belongs to the background service.
  useEffect(() => {
    const refresh = () => void refetch()
    window.addEventListener('ramu:git-updated', refresh)
    const timer =
      pr?.state === 'open'
        ? setInterval(() => {
            if (document.hasFocus()) refresh()
          }, 30_000)
        : undefined
    return () => {
      window.removeEventListener('ramu:git-updated', refresh)
      clearInterval(timer)
    }
  }, [refetch, pr?.state])

  if (!status?.remote || !status.branch || !query.data) return null
  const { availability } = query.data
  if (availability === 'not-github' || availability === 'no-remote') return null
  if (availability !== 'ready')
    return (
      <div className="m-[0_2px_8px]">
        <ForgeAccessPanel taskId={taskId} repoId={binding.repoId} unavailable={availability} />
      </div>
    )

  const handOff = async (kind: PullRequestFeedbackKind) => {
    if (!pr) return
    setStarting(kind)
    try {
      const sessionId = await invoke('forge.sendFeedback', taskId, binding.repoId, kind)
      if (sessionId) {
        const session = await invoke('agent.get', sessionId)
        await ws.refresh()
        ws.openTask(session.taskId)
        ws.openView(session.taskId, { kind: 'agent', sessionId })
        return
      }
      const prompt = await invoke('forge.pullRequestFeedback', taskId, binding.repoId, kind)
      await startCheckoutChat(
        ws,
        taskId,
        kind === 'checks'
          ? t('Fix checks on #{0}', { '0': pr.number })
          : t('Address review on #{0}', { '0': pr.number }),
        prompt,
        settings.model ? settings : initialSettings,
        invoke,
      )
    } catch (error) {
      reportError(errorText(error))
    } finally {
      setStarting(null)
    }
  }

  const setWatch = async (sessionId: string) => {
    if (!pr) return
    setWatching(true)
    try {
      await invoke('forge.watch', taskId, binding.repoId, pr.url, sessionId || null)
      await refreshWatch()
    } catch (error) {
      reportError(errorText(error))
    } finally {
      setWatching(false)
    }
  }

  const failing = !!pr?.checks.some((check) => check.state === 'failure')
  // On the default branch only commits the remote lacks can be proposed; they move to a new branch.
  // A merged pull request is finished.
  const onBase = !!branchInfo.data && status.branch === branchInfo.data.defaultBranch
  const canCreate = !!branchInfo.data && (!pr || pr.state === 'closed') && !onBase
  if (!pr && !canCreate) return null
  return (
    <div
      className={cn(
        'scm-pull-request flex flex-col gap-1.5 mb-2 text-control leading-[18px]',
        pr && 'p-2 rounded-(--radius-s) bg-fill',
      )}
    >
      {creating && (
        <CreatePullRequestDialog
          taskId={taskId}
          repoId={binding.repoId}
          onDone={(created) => {
            setCreating(false)
            if (created) void refetch()
          }}
        />
      )}
      {!pr || pr.state !== 'open' ? (
        <>
          {pr && (
            <a
              href={pr.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 min-w-0 text-muted-foreground hover:text-foreground"
              title={pr.title}
            >
              <GitPullRequest size={13} className="flex-none" />
              <span className="truncate">
                #{pr.number} · {t(STATE_LABEL[pr.state])}
              </span>
            </a>
          )}
          {canCreate && (
            <Button
              variant="outline"
              size="sm"
              className="h-(--action-size) min-h-(--action-size) w-full justify-center gap-2 rounded-(--radius-s) border border-line bg-transparent! text-control text-foreground hover:bg-hover! disabled:opacity-50"
              disabled={busy || !!status.operation}
              onClick={() => setCreating(true)}
            >
              <GitPullRequest size={13} />
              {t('Create pull request')}
            </Button>
          )}
        </>
      ) : (
        <>
          <a
            href={pr.url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 min-w-0 text-foreground hover:underline"
            title={t('Open on GitHub')}
          >
            <GitPullRequest size={13} className="flex-none text-ok" />
            <span className="truncate">
              #{pr.number} {pr.title}
            </span>
            <ExternalLink size={11} className="flex-none text-muted-foreground" />
          </a>
          <div className="flex items-center gap-1.5 min-w-0 text-muted-foreground text-caption">
            {pr.checks.length ? (
              <>
                <ChecksIcon checks={pr.checks} />
                <span className="truncate" title={pr.checks.map((check) => `${check.name}: ${check.state}`).join('\n')}>
                  {checksSummary(pr.checks)}
                </span>
              </>
            ) : (
              <span>{t('No checks')}</span>
            )}
            {pr.draft && <span className="flex-none">· {t('Draft')}</span>}
            {pr.reviewDecision === 'approved' && <span className="flex-none text-ok">· {t('Approved')}</span>}
            {pr.reviewDecision === 'changes-requested' && (
              <span className="flex-none text-warn">· {t('Changes requested')}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 [&_button]:flex-1 [&_button]:justify-center [&_button]:whitespace-nowrap">
            {failing && (
              <Button
                variant="secondary"
                size="sm"
                className="bg-raised hover:bg-hover small text-caption"
                disabled={!!starting}
                onClick={() => void handOff('checks')}
              >
                <Wrench size={13} />
                {starting === 'checks' ? t('Starting…') : t('Fix failing checks')}
              </Button>
            )}
            <Button
              variant="secondary"
              size="sm"
              className="bg-raised hover:bg-hover small text-caption"
              disabled={!!starting}
              onClick={() => void handOff('reviews')}
            >
              <MessageSquare size={13} />
              {starting === 'reviews' ? t('Starting…') : t('Address review comments')}
            </Button>
          </div>
          {watchQuery.data && (
            <div className="flex flex-col gap-1.5">
              <Dropdown
                label={t('Watch in thread')}
                placeholder={t('Watch in thread')}
                value={watchQuery.data.sessionId ?? ''}
                options={[
                  { value: '', label: t('Watch off') },
                  ...watchQuery.data.threads.map((thread) => ({ value: thread.id, label: thread.title })),
                ]}
                onChange={(value) => void setWatch(value)}
                disabled={watching || (!watchQuery.data.threads.length && !watchQuery.data.sessionId)}
              />
              <p className="text-caption text-muted-foreground">
                {watchQuery.data.sessionId
                  ? t(
                      'New failures and requested changes return to this thread, even with the window closed. You review and push.',
                    )
                  : t('Choose a thread to handle new failures and requested changes automatically.')}
              </p>
            </div>
          )}
        </>
      )}
      <details className="text-caption">
        <summary className="cursor-default text-muted-foreground">{t('GitHub access')}</summary>
        <div className="mt-1.5">
          <ForgeAccessPanel taskId={taskId} repoId={binding.repoId} />
        </div>
      </details>
    </div>
  )
}
