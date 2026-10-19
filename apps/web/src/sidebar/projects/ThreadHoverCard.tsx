import { useQueries, useQuery } from '@tanstack/react-query'
import { Folder, GitBranch } from 'lucide-react'
import { HoverCardContent } from '@/components/ui/hover-card'
import type { RepositoryBinding, Task } from '@ramu/shared/types'
import type { ThreadStatus } from '@ramu/shared/chat/threadStatus'
import { t, useLanguage } from '../../i18n'
import { useHost } from '../../workspace/HostProvider'
import { ipcQueryKeyOn, cachedDataOn } from '../../dataQueries'
import { queryInvokerFor } from '../../git/hostQuery'
import { repositoryQueryKey } from '../../git/repositoryQueryKey'
import { workspaceOfTask } from '../../workspace/workspaceModel'

interface Place {
  binding: RepositoryBinding
  /** The branch the thread is on now: the task branch of a worktree, or the checkout's current branch. */
  branch: string | null
  detached: boolean
  loading: boolean
}

/** Branches follow the live checkout, shared with the status bar and Source Control. */
function useThreadPlaces(task: Task, enabled: boolean) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const context = workspaceOfTask(task)
  const bindings = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'tasks.bindings', context),
    enabled,
    staleTime: 3_000,
    initialData: () => cachedDataOn(host.id, 'tasks.bindings', task.id),
    queryFn: () => call('tasks.bindings', context),
  })
  const statuses = useQueries({
    queries: (bindings.data ?? []).map((binding) => ({
      queryKey: repositoryQueryKey(host.id, 'git.status', binding),
      enabled: enabled && !binding.folderOnly && !binding.notGit && binding.setupState === 'ready',
      queryFn: () => call('git.status', task.id, binding.repoId),
    })),
  })
  return {
    isPending: bindings.isPending,
    isError: bindings.isError,
    data: bindings.data?.map((binding, index): Place => {
      const status = statuses[index]?.data
      return {
        binding,
        branch: status ? status.branch : binding.taskBranch,
        detached: !!status?.detached,
        loading: statuses[index]?.isLoading ?? false,
      }
    }),
  }
}

const MAX_REPOSITORIES = 3

/**
 * One thread's context, shown next to its row on hover or focus: what it is doing, where it works and on which
 * branch. Read-only: it never switches branches, resumes work or marks the thread read.
 */
type CardProps = {
  task: Task
  status: ThreadStatus | null
  hostName?: string
  workspaceName?: string
  sharedWorkspace: boolean
  offline: boolean
}

export function ThreadHoverCard(props: CardProps) {
  return (
    <HoverCardContent
      side="right"
      align="start"
      sideOffset={6}
      alignOffset={-4}
      className="thread-hover-card relative z-1200 w-[320px] max-w-[calc(100vw_-_24px)] p-2 flex flex-col gap-1.5 [border:1px_solid_var(--edge)] rounded-(--radius-m) [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [box-shadow:var(--shadow-float)]"
    >
      <ThreadCardBody {...props} />
    </HoverCardContent>
  )
}

/** Mounted only while the card is open, so nothing is fetched for rows nobody is looking at. */
function ThreadCardBody({ task, status, hostName, workspaceName, sharedWorkspace, offline }: CardProps) {
  useLanguage()
  const places = useThreadPlaces(task, !offline)
  const worktree = task.mode === 'worktree'
  const list = places.data ?? []
  return (
    <>
      <div className="flex items-start gap-2">
        <strong className="flex-1 min-w-0 font-semibold [overflow-wrap:anywhere]">{task.title}</strong>
        {status && (
          <span className="flex-none rounded-full bg-fill px-2 text-caption" title={t(status.full)}>
            {t(status.short)}
          </span>
        )}
      </div>
      {status && status.short !== status.full && (
        <div className="text-caption text-muted-foreground">{t(status.full)}</div>
      )}
      {task.goalState && (
        <div className="flex flex-col gap-0.5 text-caption">
          <span className="text-soft [overflow-wrap:anywhere]">
            {t('Goal')}: {task.goalState.objective}
          </span>
          {task.goalState.reason && task.goalState.status !== 'active' && (
            <span className="text-muted-foreground [overflow-wrap:anywhere]">{task.goalState.reason}</span>
          )}
        </div>
      )}
      {hostName && <div className="text-caption text-muted-foreground">{hostName}</div>}
      {offline && <div className="text-caption text-warn">{t('Offline · last-known activity')}</div>}
      <div className="h-px [background:var(--line)]" />
      <div className="flex items-center gap-2 text-caption text-soft">
        <Folder size={14} className="flex-none text-muted-foreground" />
        <span>
          {worktree ? (workspaceName ? `${t('Worktree')} · ${workspaceName}` : t('Worktree')) : t('Current checkout')}
          {worktree && sharedWorkspace && ` · ${t('Shared workspace')}`}
        </span>
      </div>
      {offline ? (
        <div className="text-caption text-muted-foreground">{t('Branch unavailable while offline')}</div>
      ) : places.isPending ? (
        <div className="text-caption text-muted-foreground">{t('Loading…')}</div>
      ) : places.isError ? (
        <div className="text-caption text-muted-foreground">{t('Location unavailable')}</div>
      ) : (
        list.slice(0, MAX_REPOSITORIES).map(({ binding, branch, detached, loading }) => (
          <div key={binding.repoId} className="flex flex-col gap-0.5 text-caption">
            <div className="flex items-center gap-2">
              <GitBranch size={14} className="flex-none text-muted-foreground" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {list.length > 1 && <span className="text-muted-foreground">{binding.repoName} · </span>}
                {binding.folderOnly
                  ? t('Plain folder')
                  : binding.notGit
                    ? t('Not a Git repository yet')
                    : loading && !branch
                      ? t('Loading…')
                      : detached
                        ? t('Detached HEAD')
                        : (branch ?? t('No commits yet'))}
              </span>
            </div>
            <div className="pl-[22px] text-muted-foreground [overflow-wrap:anywhere]" title={binding.cwd}>
              {binding.cwd}
            </div>
            {binding.setupState === 'failed' && (
              <div className="pl-[22px] text-bad">{binding.setupError || t('Workspace setup failed')}</div>
            )}
          </div>
        ))
      )}
      {list.length > MAX_REPOSITORIES && (
        <div className="text-caption text-muted-foreground">
          {t('+{0} more repositories', { '0': String(list.length - MAX_REPOSITORIES) })}
        </div>
      )}
    </>
  )
}
