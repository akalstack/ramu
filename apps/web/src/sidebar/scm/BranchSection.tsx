import { ArrowDown, ArrowUp, Check, GitCompareArrows } from 'lucide-react'
import type { GitBranchInfo, GitStatus, RepositoryBinding } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t } from '../../i18n'
import { BranchPicker } from '../../GitControls'
import { useWorkspace } from '../../workspace'
import { GIT_BRANCH_ROW, ICON_BUTTON } from './classes'

/** Explains where the branch stands relative to its upstream. */
function TrackingLine({ status }: { status: GitStatus }) {
  return (
    <div className="git-tracking [&_>_*]:flex-none [&_>_*_+_*::before]:[content:'·'] [&_>_*_+_*::before]:mr-1.5 [&_>_*_+_*::before]:text-muted-foreground [&_>_span:only-child]:overflow-hidden [&_>_span:only-child]:text-ellipsis [&_>_span:only-child]:flex-initial flex items-center gap-1.5 min-w-0 p-[0_6px_0_25px] min-h-[18px] text-muted-foreground text-caption leading-[18px] whitespace-nowrap overflow-hidden tabular-nums">
      {status.upstream ? (
        <>
          <span className="git-upstream flex-initial! min-w-0 overflow-hidden text-ellipsis" title={status.upstream}>
            {status.upstream}
          </span>
          {status.ahead || status.behind ? (
            <>
              {!!status.ahead && (
                <span
                  className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums"
                  title={t('{0} commits to push', { '0': status.ahead })}
                >
                  <ArrowUp size={11} />
                  {t('{0} outgoing', { '0': status.ahead })}
                </span>
              )}
              {!!status.behind && (
                <span
                  className="git-count inline-flex items-center gap-0.5 text-soft tabular-nums"
                  title={t('{0} commits to pull', { '0': status.behind })}
                >
                  <ArrowDown size={11} />
                  {t('{0} incoming', { '0': status.behind })}
                </span>
              )}
            </>
          ) : (
            <span className="git-synced [&_svg]:text-ok inline-flex items-center gap-[3px]">
              <Check size={11} />
              {t('Up to date')}
            </span>
          )}
        </>
      ) : status.detached ? (
        <span>{t('Not on a branch. Switch to one to commit and sync.')}</span>
      ) : !status.oid ? (
        <span>{t('No commits yet.')}</span>
      ) : !status.remote ? (
        <span>{t('Local only. Add a remote to push.')}</span>
      ) : (
        <span>{t('Not published yet. Sync to publish it.')}</span>
      )}
    </div>
  )
}

/** Branch picker, compare-with-upstream shortcut and tracking state. */
export function BranchSection({
  taskId,
  binding,
  status,
  branches,
  busy,
  onCheckout,
}: {
  taskId: string
  binding: RepositoryBinding
  status: GitStatus | null
  branches: GitBranchInfo[]
  busy: boolean
  onCheckout: (branch: string) => void
}) {
  const ws = useWorkspace()
  return (
    <div className="git-branch flex flex-col gap-0 p-[0_0_6px]">
      <div className={GIT_BRANCH_ROW}>
        <BranchPicker
          binding={binding}
          status={status}
          branches={branches}
          busy={busy}
          className="git-branch-btn"
          onChange={onCheckout}
        />
        {status?.upstream && (
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON}
            aria-label={t('Compare with {0}', { '0': status.upstream })}
            title={t('Compare with {0}', { '0': status.upstream })}
            onClick={() =>
              ws.openView(taskId, {
                kind: 'git',
                repoId: binding.repoId,
                title: t('Compare with {0}', { '0': status.upstream }),
              })
            }
          >
            <GitCompareArrows size={13} />
          </Button>
        )}
      </div>
      {status && <TrackingLine status={status} />}
    </div>
  )
}
