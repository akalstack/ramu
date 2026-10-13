import { useEffect, useState } from 'react'
import { errorText } from './errors'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { ArrowLeftRight } from 'lucide-react'
import type { CommitBranchOptions } from '../../shared/types'
import { Dialog } from './Menu'
import { invoke } from './ipc'
import { t, useLanguage } from './i18n'
import { useAppSettings } from './AppSettings'

type Request = { branch: string | null; forceNew: boolean; action: 'push' | 'sync'; resolve: (choice: CommitBranchOptions | null) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

/** Shared by Source Control and the shortcut, including when Source Control is closed. */
export async function chooseCommitBranch(taskId: string, repoId: string, forceNew = false, action: 'push' | 'sync' = 'push'): Promise<CommitBranchOptions | null> {
  const { branch, defaultBranch } = await invoke('git.commitBranchInfo', taskId, repoId)
  if (!forceNew && (!branch || branch !== defaultBranch)) return { expectedBranch: branch }
  // A repeated shortcut must not replace a pending choice or start another commit.
  if (active) return null
  if (!listener) throw new Error('The commit branch dialog is unavailable.')
  return new Promise((resolve) => { active = { branch, forceNew, action, resolve }; listener!(active) })
}

export function CommitBranchDialog() {
  useLanguage()
  const { preferences, save } = useAppSettings()
  const [request, setRequest] = useState<Request | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listener = (value) => { setName(`feature/changes-${Date.now().toString(36)}`); setError(null); setRequest(value) }
    return () => { listener = null; active?.resolve(null); active = null }
  }, [])
  const finish = (choice: CommitBranchOptions | null) => { const current = active; active = null; setRequest(null); current?.resolve(choice) }
  if (!request) return null
  const createBranch = () => finish({ expectedBranch: request.branch, newBranch: name.trim() })
  const continueHere = () => finish({ expectedBranch: request.branch })
  const newBranchPrimary = request.forceNew || preferences.defaultCommitBranch === 'new-branch'
  const swapLabel = newBranchPrimary ? t('Use current branch by default') : t('Use new branch by default')
  const swapDefault = async () => {
    setSaving(true); setError(null)
    try { await save({ ...preferences, defaultCommitBranch: newBranchPrimary ? 'current' : 'new-branch' }) }
    catch (reason) { setError(reason instanceof Error ? reason.message : errorText(reason)) }
    finally { setSaving(false) }
  }
  return <Dialog title={request.forceNew ? t('Commit on new branch') : request.action === 'sync' ? t('Commit & Sync to default branch?') : t('Commit & Push to default branch?')} confirmLabel={newBranchPrimary ? t('Create branch') : t('Continue on {0}', { '0': request.branch! })} confirmDisabled={newBranchPrimary && !name.trim()} busy={saving} error={error} onCancel={() => finish(null)} onConfirm={newBranchPrimary ? createBranch : continueHere}
    footerLeading={!request.forceNew && <Button variant="ghost" size="icon-sm" className="mr-auto flex-none" aria-label={swapLabel} title={swapLabel} disabled={saving} onClick={() => void swapDefault()}><ArrowLeftRight /></Button>}
    extraActions={!request.forceNew && <Button variant="outline" className="whitespace-nowrap" disabled={saving || (!newBranchPrimary && !name.trim())} title={newBranchPrimary ? t('Continue on {0}', { '0': request.branch! }) : undefined} onClick={newBranchPrimary ? continueHere : createBranch}>{newBranchPrimary ? t('Continue on {0}', { '0': request.branch! }) : t('Create branch')}</Button>}
  >
    <p>{request.forceNew ? t('Create a feature branch from the current checkout, then commit your staged changes.') : t('You are on {0}. Continue on this branch or create a feature branch before committing and pushing.', { '0': request.branch! })}</p>
    <label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch gap-1.5">{t('Branch name')}<Input autoFocus maxLength={200} value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p className="muted text-muted-foreground small text-caption">{t('Staged and unstaged changes are preserved. The new branch stays checked out.')}</p>
  </Dialog>
}
