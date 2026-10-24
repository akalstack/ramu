import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import { useEffect, useRef, useState } from 'react'
import type { Project } from '@ramu/shared/types'
import { Input } from '../../components/desktop-input'
import { Dialog } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'

/** Names and a short description Auto uses to choose this project; they never leave the host except in a routing call. */
export function ProjectRoutingDialog({
  project,
  onSave,
  onClose,
  readOnly = false,
}: {
  readOnly?: boolean
  project: Pick<Project, 'id' | 'name' | 'aliases' | 'description'>
  onSave: (aliases: string[], description: string) => Promise<void>
  onClose: () => void
}) {
  useLanguage()
  const [aliases, setAliases] = useState((project.aliases ?? []).join(', '))
  const [description, setDescription] = useState(project.description ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pending = useRef(false)
  const access = useRef(readOnly)
  access.current = readOnly
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const list = aliases
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean)
  const invalid = list.length > 8 || list.some((alias) => alias.length > 80) || description.length > 280
  const save = async () => {
    if (access.current || invalid || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await onSave(list, description.trim())
      if (live.current) onClose()
    } catch (reason) {
      if (live.current)
        setError(
          /unknown method/i.test(errorText(reason))
            ? t('Update this host to name projects for Auto.')
            : t(errorText(reason)),
        )
    } finally {
      pending.current = false
      if (live.current) setBusy(false)
    }
  }
  return (
    <Dialog
      title={t('Help Auto find {0}', { '0': project.name })}
      confirmLabel={t('Save')}
      confirmDisabled={readOnly || invalid}
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={() => {
        if (!pending.current) onClose()
      }}
    >
      {readOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      <p>
        {t('Auto matches these names in your first message. The description is shared with the model that chooses.')}
      </p>
      <Input
        autoFocus
        aria-label={t('Other names, separated by commas')}
        placeholder={t('Other names, separated by commas')}
        value={aliases}
        disabled={readOnly || busy}
        onChange={(event) => setAliases(event.target.value)}
      />
      <Input
        aria-label={t('What this project is')}
        placeholder={t('What this project is')}
        value={description}
        maxLength={280}
        disabled={readOnly || busy}
        onChange={(event) => setDescription(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void save()
          }
        }}
      />
    </Dialog>
  )
}
