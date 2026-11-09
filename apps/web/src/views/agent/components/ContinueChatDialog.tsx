import { useState } from 'react'
import { Checkbox } from '@/components/desktop-checkbox'
import { t as translate, useLanguage } from '../../../i18n'
import { Dialog } from '../../../Menu'

/** Confirms starting a new chat from this one's transcript. It cannot be dismissed while the new chat is being created. */
export function ContinueChatDialog({
  busy,
  canUseWorktree,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  /** The thread is on the project's own checkout, so the new one may take a worktree and the uncommitted changes. */
  canUseWorktree: boolean
  onCancel: () => void
  onConfirm: (worktree: boolean) => void
}) {
  useLanguage()
  const [worktree, setWorktree] = useState(false)
  return (
    <Dialog
      title={translate('Continue in a new thread?')}
      confirmLabel={translate('Continue in new thread')}
      busy={busy}
      onCancel={() => {
        if (!busy) onCancel()
      }}
      onConfirm={() => onConfirm(worktree)}
    >
      <p>
        {worktree
          ? translate(
              'Start a new thread on a new branch in its own worktree, with the current conversation and a copy of the uncommitted changes, new files included. This checkout keeps its changes.',
            )
          : translate('Start a new thread in this checkout using the current conversation as context.')}
      </p>
      {canUseWorktree && (
        <label className="mt-2 flex items-center gap-2">
          <Checkbox checked={worktree} disabled={busy} onCheckedChange={(checked) => setWorktree(checked === true)} />
          {translate('In a new worktree, with the uncommitted changes')}
        </label>
      )}
    </Dialog>
  )
}
