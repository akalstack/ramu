import { Input } from '@/components/ui/input'
import { t } from '../../i18n'
import { Dialog } from '../../Menu'
import { commitActionLabel } from './helpers'
import type { Confirmation } from './types'

function confirmTitle(confirmation: Confirmation) {
  return confirmation.kind === 'smart-commit'
    ? t('Stage all changes and commit?')
    : confirmation.kind === 'discard'
      ? t('Discard changes?')
      : confirmation.kind === 'undo'
        ? t('Undo last commit?')
        : confirmation.kind === 'branch'
          ? t('Create branch')
          : confirmation.kind === 'stash'
            ? confirmation.staged
              ? t('Stash staged changes')
              : t('Stash changes')
            : confirmation.kind === 'delete-branch'
              ? t('Delete branch?')
              : t('Delete stash?')
}

function confirmLabel(confirmation: Confirmation) {
  return confirmation.kind === 'smart-commit'
    ? confirmation.action === 'commit'
      ? t('Stage all and commit')
      : commitActionLabel(confirmation.action)
    : confirmation.kind === 'discard'
      ? t('Discard changes')
      : confirmation.kind === 'undo'
        ? t('Undo commit')
        : confirmation.kind === 'branch'
          ? t('Create branch')
          : confirmation.kind === 'stash'
            ? t('Stash')
            : t('Delete')
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
  return (
    <Dialog
      title={confirmTitle(confirmation)}
      confirmLabel={confirmLabel(confirmation)}
      danger={
        confirmation.kind === 'discard' || confirmation.kind === 'drop-stash' || confirmation.kind === 'delete-branch'
      }
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      {confirmation.kind === 'smart-commit' ? (
        <p>{t('No changes are staged. All unstaged changes in this repository will be staged and committed.')}</p>
      ) : confirmation.kind === 'discard' ? (
        <>
          <p>
            {t(
              'Tracked edits return to their staged version. Untracked files are deleted permanently. Staged changes are kept.',
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
      ) : confirmation.kind === 'branch' || confirmation.kind === 'stash' ? (
        <>
          <label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch">
            {confirmation.kind === 'branch' ? t('Branch name') : t('Stash message')}
            <Input autoFocus value={operationName} onChange={(event) => onOperationName(event.target.value)} />
          </label>
          <p className="muted text-muted-foreground small text-caption">
            {confirmation.kind === 'branch'
              ? t('Creates and switches to a new local branch. The checkout must be clean.')
              : confirmation.kind === 'stash' && confirmation.staged
                ? t('Saves only staged changes and removes them from the checkout. Unstaged edits stay.')
                : t('Preserves tracked and untracked changes. Ignored files stay in place.')}
          </p>
        </>
      ) : (
        <>
          <p>
            {confirmation.kind === 'delete-branch'
              ? t('Deletes the local branch only. Git will refuse an unmerged branch or one in use by a worktree.')
              : t('This saved stash will be permanently removed.')}
          </p>
          <p className="strong font-semibold">
            {confirmation.kind === 'delete-branch' ? confirmation.name : confirmation.title}
          </p>
        </>
      )}
    </Dialog>
  )
}
