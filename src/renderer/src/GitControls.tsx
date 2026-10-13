import { cn } from 'cn'
import { t, useLanguage } from './i18n'
import { Button } from '@/components/desktop-button'
import { AlertTriangle, CloudUpload, GitBranch, RefreshCcw } from 'lucide-react'
import { useEffect } from 'react'
import type { GitBranchInfo, GitStatus, PullMode, RepositoryBinding } from '../../shared/types'
import { Dropdown } from './Menu'

export function BranchPicker({ binding, status, branches, busy, onChange, className = '' }: {
  binding: RepositoryBinding; status: GitStatus | null; branches: GitBranchInfo[]; busy: boolean
  onChange: (branch: string) => void; className?: string
}) {
  useLanguage()
  return <Dropdown label={t("Switch branch")} value={status?.branch ?? ''} icon={<GitBranch size={13} />} placeholder={status?.detached ? t("Detached at {0}", { "0": status.oid?.slice(0, 7) }) : t("No commits")} className={cn("branch-picker", className)} title={status?.branch ?? undefined} disabled={busy} options={branches.map((branch) => ({ value: branch.name, label: branch.name, disabled: !!branch.worktree && branch.worktree !== binding.cwd }))} onChange={(branch) => { if (branch !== status?.branch) onChange(branch) }} />
}

const PULL_LABEL: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

/** VS Code-style sync: one control that pulls (with the configured mode) and then pushes, or publishes a new branch. */
export function SyncButton({ status, busy, pullMode, onSync, className = '', showLabel = false }: {
  status: GitStatus | null; busy: boolean; pullMode: PullMode; onSync: () => void; className?: string; showLabel?: boolean
}) {
  useLanguage()
  if (!status) return null
  if (status.operation) return <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button warn text-warn ${className}`} disabled title={t("A {0} is in progress. Continue or abort it in Source Control.", { "0": status.operation })}><AlertTriangle size={13} /><span>{status.operation === 'rebase' ? t("Rebasing…") : t("Merging…")}</span></Button>
  if (!status.branch || !status.remote) return null
  if (!status.upstream) return <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button ${className}`} disabled={busy} aria-label={t("Publish branch")} title={t("Publish {0} to the remote", { "0": status.branch })} onClick={onSync}><CloudUpload size={13} /><span>{showLabel ? t("Publish branch") : t("Publish")}</span></Button>
  const counts = `${status.behind}↓ ${status.ahead}↑`
  return <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button ${className}`} disabled={busy} aria-label={t("Sync changes")} title={t("Sync changes: pull {0} ({1}), then push {2}", { "0": status.behind, "1": PULL_LABEL[pullMode], "2": status.ahead })} onClick={onSync}>
    <RefreshCcw size={13} className={busy ? 'spin [animation:spin_0.9s_linear_infinite]' : ''} /><span>{showLabel ? t("Sync changes {0}", { "0": counts }) : counts}</span>
  </Button>
}

/** Keeps ahead/behind counts current, like VS Code's autofetch: on window focus and every few minutes. Failures stay quiet. */
const AUTH_FAILURE = /Authentication failed|could not read (Username|Password)|terminal prompts disabled|Permission denied \(publickey/i

export function useAutoFetch(fetch: (() => Promise<unknown>) | null) {
  useLanguage()
  useEffect(() => {
    if (!fetch) return
    let last = 0
    let running = false
    let failures = 0
    let stopped = false
    // Like VS Code, only fetch while the window is focused; regaining focus fetches right away.
    const run = () => {
      // Offline or failing remotes back off (1, 2, 4… minutes, at most 30) instead of retrying every tick.
      const gap = failures ? Math.min(60_000 * 2 ** failures, 30 * 60_000) : 60_000
      if (stopped || running || !document.hasFocus() || Date.now() - last < gap) return
      last = Date.now(); running = true
      void fetch()
        .then(() => { failures = 0 })
        .catch((error: unknown) => {
          // Credentials won't fix themselves, so stop until the repository is reopened (as VS Code does).
          if (AUTH_FAILURE.test(String(error instanceof Error ? error.message : error))) stopped = true
          else failures++
        })
        .finally(() => { running = false })
    }
    run()
    const timer = setInterval(run, 3 * 60_000)
    window.addEventListener('focus', run)
    return () => { clearInterval(timer); window.removeEventListener('focus', run) }
  }, [fetch])
}
