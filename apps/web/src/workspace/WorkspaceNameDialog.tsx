import { useEffect, useRef, useState } from 'react'
import type { WorktreeWorkspace } from '@ramu/shared/types'
import { Input } from '../components/desktop-input'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'

/** Editing a shared display label uses the original name as an optimistic concurrency check. */
export function WorkspaceNameDialog({
  workspace,
  online,
  onSave,
  onClose,
}: {
  workspace: Pick<WorktreeWorkspace, 'id' | 'name'>
  online: boolean
  onSave: (name: string, before: string) => Promise<void>
  onClose: () => void
}) {
  useLanguage()
  const before = useRef(workspace.name).current
  const [name, setName] = useState(before)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const save = async () => {
    if (!online || !name.trim() || name.trim().length > 200 || pending.current) return
    if (name.trim() === before) return onClose()
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await onSave(name.trim(), before)
      if (live.current) onClose()
    } catch (reason) {
      if (live.current)
        setError(
          /unknown method/i.test(errorText(reason))
            ? t('Update this host to rename workspace labels.')
            : t(errorText(reason)),
        )
    } finally {
      pending.current = false
      if (live.current) setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Rename workspace')}
      confirmLabel={t('Save')}
      confirmDisabled={!online || !name.trim() || name.trim().length > 200}
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={() => {
        if (!pending.current) onClose()
      }}
    >
      <p>{t('Used by every thread sharing this workspace.')}</p>
      <Input
        autoFocus
        aria-label={t('Workspace name')}
        value={name}
        maxLength={200}
        disabled={busy || !online}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void save()
          }
        }}
      />
      {!online && <p role="status">{t('Connect to this host to rename the workspace.')}</p>}
    </Dialog>
  )
}
