import { Button } from '@/components/ui/button'
import { AlertTriangle, CloudUpload, GitBranch, RefreshCcw } from 'lucide-react'
import { useEffect } from 'react'
import type { GitBranchInfo, GitStatus, PullMode, RepositoryBinding } from '../../shared/types'
import { Dropdown } from './Menu'

export function BranchPicker({ binding, status, branches, busy, onChange, className = '' }: {
  binding: RepositoryBinding; status: GitStatus | null; branches: GitBranchInfo[]; busy: boolean
  onChange: (branch: string) => void; className?: string
}) {
  return <Dropdown label="Switch branch" value={status?.branch ?? ''} icon={<GitBranch size={13} />} placeholder={status?.detached ? `Detached at ${status.oid?.slice(0, 7)}` : 'No commits'} className={className} disabled={busy} options={branches.map((branch) => ({ value: branch.name, label: branch.name, disabled: branch.current || !!branch.worktree && branch.worktree !== binding.cwd }))} onChange={onChange} />
}

const PULL_LABEL: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

/** VS Code-style sync: one control that pulls (with the configured mode) and then pushes, or publishes a new branch. */
export function SyncButton({ status, busy, pullMode, onSync, className = '', showLabel = false }: {
  status: GitStatus | null; busy: boolean; pullMode: PullMode; onSync: () => void; className?: string; showLabel?: boolean
}) {
  if (!status) return null
  if (status.operation) return <Button className={`ghost sync-button warn ${className}`} disabled title={`A ${status.operation} is in progress. Continue or abort it in Source Control.`}><AlertTriangle size={13} /><span>{status.operation === 'rebase' ? 'Rebasing…' : 'Merging…'}</span></Button>
  if (!status.branch || !status.remote) return null
  if (!status.upstream) return <Button className={`ghost sync-button ${className}`} disabled={busy} aria-label="Publish branch" title={`Publish ${status.branch} to the remote`} onClick={onSync}><CloudUpload size={13} /><span>{showLabel ? 'Publish branch' : 'Publish'}</span></Button>
  const counts = `${status.behind}↓ ${status.ahead}↑`
  return <Button className={`ghost sync-button ${className}`} disabled={busy} aria-label="Sync changes" title={`Sync changes: pull ${status.behind} (${PULL_LABEL[pullMode]}), then push ${status.ahead}`} onClick={onSync}>
    <RefreshCcw size={13} className={busy ? 'spin' : ''} /><span>{showLabel ? `Sync changes ${counts}` : counts}</span>
  </Button>
}

/** Keeps ahead/behind counts current, like VS Code's autofetch: on window focus and every few minutes. Failures stay quiet. */
export function useAutoFetch(fetch: (() => Promise<unknown>) | null) {
  useEffect(() => {
    if (!fetch) return
    let last = 0
    const run = () => { if (Date.now() - last < 60_000) return; last = Date.now(); void fetch().catch(() => {}) }
    run()
    const timer = setInterval(run, 3 * 60_000)
    window.addEventListener('focus', run)
    return () => { clearInterval(timer); window.removeEventListener('focus', run) }
  }, [fetch])
}
