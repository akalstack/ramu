import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import { useId, useState } from 'react'
import { Dialog } from '../../Menu'
import { t } from '../../i18n'

/** Asks where to publish a branch when several remotes leave the destination ambiguous; it never guesses. */
export function RemoteChoiceDialog({
  branch,
  remotes,
  busy,
  onCancel,
  onChoose,
}: {
  branch: string | null
  remotes: string[]
  busy?: boolean
  onCancel(): void
  onChoose(remote: string): void
}) {
  const name = useId()
  const [chosen, setChosen] = useState(remotes[0] ?? '')
  const { viewOnly, canWrite } = useHostWriteAccess()
  return (
    <Dialog
      title={t('Choose a remote')}
      confirmLabel={t('Publish')}
      confirmDisabled={viewOnly || !chosen}
      busy={busy}
      onCancel={onCancel}
      onConfirm={() => {
        if (canWrite()) onChoose(chosen)
      }}
    >
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <p>
        {branch
          ? t('{branch} has no upstream and this repository has several remotes. Where should it be published?', {
              branch,
            })
          : t('This repository has several remotes. Where should the branch be published?')}
      </p>
      <fieldset disabled={viewOnly} className="m-0 flex flex-col gap-2 border-0 p-0">
        {remotes.map((remote) => (
          <label key={remote} className="flex items-center gap-2">
            <input type="radio" name={name} checked={chosen === remote} onChange={() => setChosen(remote)} />
            {remote}
          </label>
        ))}
      </fieldset>
    </Dialog>
  )
}
