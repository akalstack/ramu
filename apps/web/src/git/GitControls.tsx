import { cn } from 'cn'
import { t, useLanguage } from '../i18n'
import { Button } from '@/components/desktop-button'
import { AlertTriangle, CloudUpload, GitBranch, RefreshCcw } from 'lucide-react'
import { useEffect } from 'react'
import type { GitBranchInfo, GitStatus, PullMode, RepositoryBinding } from '@ramu/shared/types'
import { Combobox } from '../Menu'
import { BrandIcon } from '@/components/brand-icon'

export function BranchPicker({
  binding,
  status,
  branches,
  busy,
  onChange,
  className = '',
}: {
  binding: RepositoryBinding
  status: GitStatus | null
  branches: GitBranchInfo[]
  busy: boolean
  onChange: (branch: string) => void
  className?: string
}) {
  useLanguage()
  return (
    <Combobox
      label={t('Switch branch')}
      searchPlaceholder={t('Search branches…')}
      value={status?.branch ?? ''}
      icon={<GitBranch size={13} />}
      placeholder={status?.detached ? t('Detached at {0}', { '0': status.oid?.slice(0, 7) }) : t('No commits')}
      className={cn('branch-picker', className)}
      title={status?.branch ?? undefined}
      disabled={busy}
      options={branches.map((branch) => ({
        value: branch.name,
        label: branch.name,
        disabled: !!branch.worktree && branch.worktree !== binding.cwd,
      }))}
      onChange={(branch) => {
        if (branch !== status?.branch) onChange(branch)
      }}
    />
  )
}

const PULL_LABEL: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

/** VS Code-style sync: one control that pulls (with the configured mode) and then pushes, or publishes a new branch. */
export function SyncButton({
  status,
  busy,
  pullMode,
  onSync,
  onPublishRepository,
  className = '',
  showLabel = false,
}: {
  status: GitStatus | null
  busy: boolean
  pullMode: PullMode
  onSync: () => void
  /** Offered when the repository has no remote yet: create one on GitHub and push to it. */
  onPublishRepository?: () => void
  className?: string
  showLabel?: boolean
}) {
  useLanguage()
  if (!status) return null
  if (status.operation)
    return (
      <Button
        variant="secondary"
        className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button warn text-warn ${className}`}
        disabled
        title={t('A {0} is in progress. Continue or abort it in Source Control.', { '0': status.operation })}
      >
        <AlertTriangle size={13} />
        <span>{status.operation === 'rebase' ? t('Rebasing…') : t('Merging…')}</span>
      </Button>
    )
  if (!status.branch) return null
  if (!status.remote)
    return onPublishRepository && status.oid ? (
      <Button
        variant="secondary"
        className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button ${className}`}
        disabled={busy}
        aria-label={t('Publish to GitHub')}
        title={t('Create a GitHub repository for this folder and push {0}', { '0': status.branch })}
        onClick={onPublishRepository}
      >
        {showLabel ? <BrandIcon brand="github" size={13} /> : <CloudUpload size={13} />}
        <span>{showLabel ? t('Publish to GitHub') : t('Publish')}</span>
      </Button>
    ) : null
  if (!status.upstream)
    return (
      <Button
        variant="secondary"
        className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button ${className}`}
        disabled={busy}
        aria-label={t('Publish branch')}
        title={t('Publish {0} to the remote', { '0': status.branch })}
        onClick={onSync}
      >
        <CloudUpload size={13} />
        <span>{showLabel ? t('Publish branch') : t('Publish')}</span>
      </Button>
    )
  const counts = `${status.behind}↓ ${status.ahead}↑`
  const hasChanges = status.behind !== 0 || status.ahead !== 0
  return (
    <Button
      variant="secondary"
      className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button ${className}`}
      disabled={busy}
      aria-label={t('Sync changes')}
      title={t('Sync changes: pull {0} ({1}), then push {2}', {
        '0': status.behind,
        '1': PULL_LABEL[pullMode],
        '2': status.ahead,
      })}
      onClick={onSync}
    >
      <RefreshCcw size={13} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} />
      {hasChanges && <span>{showLabel ? t('Sync changes {0}', { '0': counts }) : counts}</span>}
    </Button>
  )
}

/**
 * Tells the host this repository is in view: on opening, on window focus and each minute while focused. The host decides
 * whether a fetch is due, so these visits stay cheap and switching projects repeats nothing. Failures stay quiet.
 */
export function useAutoFetch(visit: ((opening: boolean) => Promise<unknown>) | null) {
  useLanguage()
  useEffect(() => {
    if (!visit) return
    const run = (opening: boolean) => {
      if (document.hasFocus()) void visit(opening).catch(() => {})
    }
    const tick = () => run(false)
    run(true)
    const timer = setInterval(tick, 60_000)
    window.addEventListener('focus', tick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', tick)
    }
  }, [visit])
}
