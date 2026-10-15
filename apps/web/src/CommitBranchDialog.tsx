import { useEffect, useState } from 'react'
import { errorText } from './errors'
import { Button } from '@/components/desktop-button'
import { ArrowLeftRight } from 'lucide-react'
import type { CommitBranchOptions } from '@ramu/shared/types'
import { Dialog } from './Menu'
import { invoke } from './ipc'
import { t, useLanguage } from './i18n'
import { useAppSettings } from './AppSettings'

type Request = {
  branch: string | null
  forceNew: boolean
  action: 'push' | 'sync'
  resolve: (choice: CommitBranchOptions | null) => void
}
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

/** Shared by Source Control and the shortcut, including when Source Control is closed. */
export async function chooseCommitBranch(
  taskId: string,
  repoId: string,
  forceNew = false,
  action: 'push' | 'sync' = 'push',
): Promise<CommitBranchOptions | null> {
  const { branch, defaultBranch } = await invoke('git.commitBranchInfo', taskId, repoId)
  if (!forceNew && (!branch || branch !== defaultBranch)) return { expectedBranch: branch }
  // Like T3 Code, the new branch is named from the commit (an AI suggestion or its subject), so there is nothing to ask.
  if (forceNew) return { expectedBranch: branch, autoBranch: true }
  // A repeated shortcut must not replace a pending choice or start another commit.
  if (active) return null
  if (!listener) throw new Error('The commit branch dialog is unavailable.')
  return new Promise((resolve) => {
    active = { branch, forceNew, action, resolve }
    listener!(active)
  })
}

export function CommitBranchDialog() {
  useLanguage()
  const { preferences, save } = useAppSettings()
  const [request, setRequest] = useState<Request | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    listener = (value) => {
      setError(null)
      setRequest(value)
    }
    return () => {
      listener = null
      active?.resolve(null)
      active = null
    }
  }, [])
  const finish = (choice: CommitBranchOptions | null) => {
    const current = active
    active = null
    setRequest(null)
    current?.resolve(choice)
  }
  if (!request) return null
  const createBranch = () => finish({ expectedBranch: request.branch, autoBranch: true })
  const continueHere = () => finish({ expectedBranch: request.branch })
  const newBranchPrimary = request.forceNew || preferences.defaultCommitBranch === 'new-branch'
  const swapLabel = newBranchPrimary ? t('Use current branch by default') : t('Use new branch by default')
  const swapDefault = async () => {
    setSaving(true)
    setError(null)
    try {
      await save({ ...preferences, defaultCommitBranch: newBranchPrimary ? 'current' : 'new-branch' })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : errorText(reason))
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog
      title={request.action === 'sync' ? t('Commit & Sync to default branch?') : t('Commit & Push to default branch?')}
      confirmLabel={newBranchPrimary ? t('Create feature branch') : t('Continue on {0}', { '0': request.branch! })}
      busy={saving}
      error={error}
      onCancel={() => finish(null)}
      onConfirm={newBranchPrimary ? createBranch : continueHere}
      footerLeading={
        <Button
          variant="ghost"
          size="icon-sm"
          className="mr-auto flex-none"
          aria-label={swapLabel}
          title={swapLabel}
          disabled={saving}
          onClick={() => void swapDefault()}
        >
          <ArrowLeftRight />
        </Button>
      }
      extraActions={
        <Button
          variant="outline"
          className="whitespace-nowrap"
          disabled={saving}
          title={newBranchPrimary ? t('Continue on {0}', { '0': request.branch! }) : undefined}
          onClick={newBranchPrimary ? continueHere : createBranch}
        >
          {newBranchPrimary ? t('Continue on {0}', { '0': request.branch! }) : t('Create feature branch')}
        </Button>
      }
    >
      <p>
        {t('You are on {0}. Continue on this branch or create a feature branch before committing and pushing.', {
          '0': request.branch!,
        })}
      </p>
      <p className="muted text-muted-foreground small text-caption">
        {t(
          'The feature branch is named from your changes. Staged and unstaged changes are preserved, and it stays checked out.',
        )}
      </p>
    </Dialog>
  )
}
