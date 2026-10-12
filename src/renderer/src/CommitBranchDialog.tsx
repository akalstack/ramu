import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CommitBranchOptions } from '../../shared/types'
import { Dialog } from './Menu'
import { invoke } from './ipc'
import { t, useLanguage } from './i18n'

type Request = { branch: string | null; forceNew: boolean; resolve: (choice: CommitBranchOptions | null) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

/** Shared by Source Control and the shortcut, including when Source Control is closed. */
export async function chooseCommitBranch(taskId: string, repoId: string, forceNew = false): Promise<CommitBranchOptions | null> {
  const { branch, defaultBranch } = await invoke('git.commitBranchInfo', taskId, repoId)
  if (!forceNew && (!branch || branch !== defaultBranch)) return { expectedBranch: branch }
  // A repeated shortcut must not replace a pending choice or start another commit.
  if (active) return null
  if (!listener) throw new Error('The commit branch dialog is unavailable.')
  return new Promise((resolve) => { active = { branch, forceNew, resolve }; listener!(active) })
}

export function CommitBranchDialog() {
  useLanguage()
  const [request, setRequest] = useState<Request | null>(null)
  const [name, setName] = useState('')
  useEffect(() => {
    listener = (value) => { setName(`feature/changes-${Date.now().toString(36)}`); setRequest(value) }
    return () => { listener = null; active?.resolve(null); active = null }
  }, [])
  const finish = (choice: CommitBranchOptions | null) => { const current = active; active = null; setRequest(null); current?.resolve(choice) }
  if (!request) return null
  return <Dialog title={request.forceNew ? t('Commit on new branch') : t('Commit & Push to default branch?')} confirmLabel={t('Check out feature branch & continue')} confirmDisabled={!name.trim()} onCancel={() => finish(null)} onConfirm={() => finish({ expectedBranch: request.branch, newBranch: name.trim() })}>
    <p>{request.forceNew ? t('Create a feature branch from the current checkout, then commit your staged changes.') : t('You are on {0}. Continue on this branch or create a feature branch before committing and pushing.', { '0': request.branch! })}</p>
    <label className="explorer-name-field">{t('Branch name')}<Input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
    <p className="muted small">{t('Staged and unstaged changes are preserved. The new branch stays checked out.')}</p>
    {!request.forceNew && <Button variant="outline" onClick={() => finish({ expectedBranch: request.branch })}>{t('Continue on {0}', { '0': request.branch! })}</Button>}
  </Dialog>
}
