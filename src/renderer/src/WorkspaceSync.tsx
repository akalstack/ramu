import { t, useLanguage } from './i18n'
import { Spinner } from '@/components/ui/spinner'
import { Check, CircleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { GitBranchInfo, GitStatus, RepositoryBinding } from '../../shared/types'
import { Checkbox } from '@/components/ui/checkbox'
import { BranchPicker } from './GitControls'
import { invoke } from './ipc'
import { Dialog } from './Menu'
import { errorText } from './TaskPane'
import { useWorkspace } from './workspace'

type Row = { status: GitStatus | null; branches: GitBranchInfo[]; result?: 'running' | 'done' | string }

/** Sync every repository in the workspace in one go: see each branch and state first, switch branches, then pull and push the ones you tick. */
export function WorkspaceSyncDialog({ taskId, bindings, onClose }: { taskId: string; bindings: RepositoryBinding[]; onClose: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [finished, setFinished] = useState(false)
  const patch = (repoId: string, change: Partial<Row>) => setRows((current) => ({ ...current, [repoId]: { status: null, branches: [], ...current[repoId], ...change } }))
  const load = useCallback(async (binding: RepositoryBinding) => {
    const [status, branches] = await Promise.allSettled([invoke('git.status', taskId, binding.repoId), invoke('git.branches', taskId, binding.repoId)])
    patch(binding.repoId, { status: status.status === 'fulfilled' ? status.value : null, branches: branches.status === 'fulfilled' ? branches.value : [] })
  }, [taskId])
  useEffect(() => { void Promise.all(bindings.map(load)) }, [bindings, load])
  const canSync = (status: GitStatus | null) => !!status && !status.operation && !status.detached && !!status.branch && !!status.remote
  // Until the user chooses, every repository that can sync is ticked.
  const selection = picked ?? new Set(bindings.filter((b) => canSync(rows[b.repoId]?.status ?? null)).map((b) => b.repoId))
  const toggle = (repoId: string) => { const next = new Set(selection); next.has(repoId) ? next.delete(repoId) : next.add(repoId); setPicked(next) }
  const unsaved = Object.values(ws.dirty).some(Boolean)
  const switchBranch = async (binding: RepositoryBinding, branch: string) => {
    if (unsaved) { setError('Save or close unsaved editor buffers before switching branches or pulling.'); return }
    setError(null); patch(binding.repoId, { result: undefined })
    try { await invoke('git.checkout', taskId, binding.repoId, branch) } catch (e) { patch(binding.repoId, { result: errorText(e) }) }
    await load(binding); window.dispatchEvent(new Event('ramu:git-updated'))
  }
  const chosen = bindings.filter((b) => selection.has(b.repoId) && canSync(rows[b.repoId]?.status ?? null))
  const run = async () => {
    if (unsaved) { setError('Save or close unsaved editor buffers before switching branches or pulling.'); return }
    setBusy(true); setError(null)
    // Repositories are independent (the server locks each checkout), so they sync side by side, a few at a time.
    const queue = [...chosen]
    const worker = async () => {
      for (let binding = queue.shift(); binding; binding = queue.shift()) {
        patch(binding.repoId, { result: 'running' })
        try { await invoke('git.sync', taskId, binding.repoId); patch(binding.repoId, { result: 'done' }) } catch (e) { patch(binding.repoId, { result: errorText(e) }) }
        await load(binding)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, queue.length) }, worker))
    setBusy(false); setFinished(true); window.dispatchEvent(new Event('ramu:git-updated'))
  }
  return <Dialog title={t("Sync workspace")} confirmLabel={finished ? t("Sync again") : chosen.length ? t("Sync {0} {1}", { "0": chosen.length, "1": chosen.length === 1 ? t('repository') : 'repositories' }) : t("Nothing to sync")} confirmDisabled={busy || !chosen.length} busy={busy} error={error} onConfirm={() => void run()} onCancel={onClose}>
    <div className="workspace-sync [&_>_p]:m-[0_0_8px] flex flex-col gap-0.5">
      <p className="muted text-muted-foreground small text-caption">{t("Pulls, then pushes, each ticked repository, up to four at a time. Change a branch first if a repository is on the wrong one.")}</p>
      {bindings.map((binding) => {
        const row = rows[binding.repoId], status = row?.status ?? null, ok = canSync(status)
        const note = !status ? 'Loading…' : status.operation ? `${status.operation === 'rebase' ? 'Rebase' : 'Merge'} in progress` : status.detached ? 'Detached HEAD' : !status.remote ? 'No remote' : !status.upstream ? 'Not published' : `${status.behind}↓ ${status.ahead}↑`
        const changes = status?.entries.length ?? 0
        return <div key={binding.repoId} className="workspace-sync-row [&:hover]:bg-hover grid [grid-template-columns:20px_minmax(80px,_1fr)_minmax(120px,_170px)_minmax(110px,_auto)_18px] items-center gap-2.5 min-h-[36px] p-[2px_4px] rounded-(--radius-s)">
          <Checkbox aria-label={t("Sync {0}", { "0": binding.repoName })} checked={selection.has(binding.repoId) && ok} disabled={!ok || busy} onCheckedChange={() => toggle(binding.repoId)} />
          <span className="workspace-sync-name overflow-hidden text-ellipsis whitespace-nowrap strong font-semibold" title={binding.cwd}>{binding.repoName}</span>
          <BranchPicker binding={binding} status={status} branches={row?.branches ?? []} busy={busy || !status} className="workspace-sync-branch" onChange={(branch) => void switchBranch(binding, branch)} />
          <span className="muted text-muted-foreground small text-caption workspace-sync-state whitespace-nowrap text-right">{note}{changes ? ` · ${changes} ${changes === 1 ? 'change' : 'changes'}` : ''}</span>
          <span className="workspace-sync-result" title={row?.result && row.result !== 'running' && row.result !== 'done' ? row.result : undefined}>
            {row?.result === 'running' ? <Spinner className="size-3.5" /> : row?.result === 'done' ? <Check size={14} className="ok" /> : row?.result ? <CircleAlert size={14} className="bad" /> : null}
          </span>
          {row?.result && row.result !== 'running' && row.result !== 'done' && <p className="error text-bad small text-caption workspace-sync-error [grid-column:2_/_-1] m-[0_0_4px] [overflow-wrap:anywhere]">{row.result}</p>}
        </div>
      })}
    </div>
  </Dialog>
}
