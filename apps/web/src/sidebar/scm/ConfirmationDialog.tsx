import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import { Input } from '@/components/ui/input'
import { t } from '../../i18n'
import { Dialog } from '../../Menu'
import type { Confirmation } from './types'

function confirmTitle(confirmation: Confirmation) {
  switch (confirmation.kind) {
    case 'discard':
      return t('Discard changes?')
    case 'undo':
      return t('Undo last commit?')
    case 'branch':
      return t('Create branch')
    case 'branch-from':
      return t('Create branch from {0}', { '0': confirmation.from })
    case 'rename-branch':
      return t('Rename branch')
    case 'merge':
      return t('Merge {0} into this branch?', { '0': confirmation.name })
    case 'stash':
      return confirmation.staged ? t('Stash staged changes') : t('Stash changes')
    case 'delete-branch':
      return t('Delete branch?')
    default:
      return t('Delete stash?')
  }
}

function confirmLabel(confirmation: Confirmation) {
  switch (confirmation.kind) {
    case 'discard':
      return t('Discard changes')
    case 'undo':
      return t('Undo commit')
    case 'branch':
    case 'branch-from':
      return t('Create branch')
    case 'rename-branch':
      return t('Rename')
    case 'merge':
      return t('Merge')
    case 'stash':
      return t('Stash')
    default:
      return t('Delete')
  }
}

/** Confirmation (and name prompt for branches and stashes) for destructive or multi-step repository actions. */
export function ConfirmationDialog({
  confirmation,
  busy,
  operationName,
  onOperationName,
  onCancel,
  onConfirm,
}: {
  confirmation: Confirmation
  busy: boolean
  operationName: string
  onOperationName: (name: string) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const { viewOnly, canWrite } = useHostWriteAccess()
  return (
    <Dialog
      title={confirmTitle(confirmation)}
      confirmLabel={confirmLabel(confirmation)}
      danger={
        confirmation.kind === 'discard' || confirmation.kind === 'drop-stash' || confirmation.kind === 'delete-branch'
      }
      busy={busy}
      confirmDisabled={viewOnly}
      onCancel={onCancel}
      onConfirm={() => {
        if (canWrite()) onConfirm()
      }}
    >
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      {confirmation.kind === 'discard' ? (
        <>
          <p>
            {t(
              'Tracked edits go back to their staged version. Untracked files are deleted permanently. Staged changes are kept.',
            )}
          </p>
          <pre className="confirm-paths max-h-[240px] overflow-auto p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) text-caption bg-fill">
            {confirmation.paths.join('\n')}
          </pre>
        </>
      ) : confirmation.kind === 'undo' ? (
        <>
          <p>{t('The last local commit will be undone. Its files stay in your checkout and index.')}</p>
          <p className="strong font-semibold">{confirmation.title}</p>
        </>
      ) : confirmation.kind === 'branch' ||
        confirmation.kind === 'branch-from' ||
        confirmation.kind === 'rename-branch' ||
        confirmation.kind === 'stash' ? (
        <>
          <label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch">
            {confirmation.kind === 'stash' ? t('Stash message') : t('Branch name')}
            <Input
              readOnly={viewOnly}
              autoFocus
              value={operationName}
              onChange={(event) => onOperationName(event.target.value)}
            />
          </label>
          <p className="muted text-muted-foreground small text-caption">
            {confirmation.kind === 'branch'
              ? t('Creates and switches to a new local branch. The checkout must be clean.')
              : confirmation.kind === 'branch-from'
                ? t('Creates a branch at the tip of {0} and switches to it. The checkout must be clean.', {
                    '0': confirmation.from,
                  })
                : confirmation.kind === 'rename-branch'
                  ? t('Renames the current local branch. Its remote branch is not changed.')
                  : confirmation.kind === 'stash' && confirmation.staged
                    ? t('Saves only staged changes and removes them from the checkout. Unstaged edits stay.')
                    : t('Saves tracked and untracked changes. Ignored files stay in place.')}
          </p>
        </>
      ) : (
        <>
          <p>
            {confirmation.kind === 'delete-branch'
              ? t('Deletes the local branch only. Git will refuse an unmerged branch or one in use by a worktree.')
              : confirmation.kind === 'merge'
                ? t('Brings its commits into the current branch. A conflict leaves the merge open to resolve here.')
                : t('This saved stash will be permanently removed.')}
          </p>
          <p className="strong font-semibold">
            {confirmation.kind === 'delete-branch' || confirmation.kind === 'merge'
              ? confirmation.name
              : confirmation.title}
          </p>
        </>
      )}
    </Dialog>
  )
}
