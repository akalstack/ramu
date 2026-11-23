import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { LocalInlineAction } from '@/components/inline-action'
import { Dialog } from '../Menu'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'

/**
 * Renames a host or a device. `original` is the name it goes back to; once the name differs, one click restores it.
 * `onSave` gets the new name, or `null` to go back to the original.
 */
export function RenameDialog({
  title,
  help,
  name,
  original,
  onSave,
  onClose,
}: {
  title: string
  help?: string
  name: string
  original: string | null
  onSave: (name: string | null) => Promise<unknown>
  onClose: () => void
}) {
  useLanguage()
  const [value, setValue] = useState(name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async (next: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await onSave(next)
      onClose()
    } catch (cause) {
      setError(errorText(cause))
      setBusy(false)
    }
  }
  const trimmed = value.trim()
  return (
    <Dialog
      title={title}
      confirmLabel={t('Rename')}
      confirmDisabled={!trimmed || trimmed === name}
      busy={busy}
      error={error}
      onConfirm={() => void save(original !== null && trimmed === original ? null : trimmed)}
      onCancel={onClose}
      footerLeading={
        original !== null && name !== original ? (
          <LocalInlineAction disabled={busy} onClick={() => void save(null)}>
            {t('Use “{0}”', { 0: original })}
          </LocalInlineAction>
        ) : undefined
      }
    >
      {help && <p className="m-0 text-caption text-muted-foreground">{help}</p>}
      <Input
        autoFocus
        value={value}
        maxLength={60}
        aria-label={t('Name')}
        placeholder={original ?? undefined}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && trimmed && trimmed !== name)
            void save(original !== null && trimmed === original ? null : trimmed)
        }}
      />
    </Dialog>
  )
}
