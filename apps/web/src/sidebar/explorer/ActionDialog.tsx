import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../../composer/viewerAccess'
import type { RefObject } from 'react'
import { Input } from '@/components/ui/input'
import { t, useLanguage } from '../../i18n'
import { Dialog } from '../../Menu'
import type { TreeAction } from './shared'

/** Confirms creating, renaming or deleting entries in a repository tree. */
export function ActionDialog({
  action,
  repoName,
  name,
  setName,
  nameInput,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  action: TreeAction
  repoName: string
  name: string
  setName: (name: string) => void
  nameInput: RefObject<HTMLInputElement | null>
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}) {
  useLanguage()
  const { viewOnly, canWrite } = useHostWriteAccess()
  return (
    <Dialog
      title={
        action.type === 'create'
          ? action.kind === 'file'
            ? t('New file')
            : t('New folder')
          : action.type === 'rename'
            ? t('Rename')
            : t('Delete permanently?')
      }
      confirmLabel={action.type === 'create' ? t('Create') : action.type === 'rename' ? t('Rename') : t('Delete')}
      danger={action.type === 'delete'}
      busy={busy}
      confirmDisabled={viewOnly}
      error={error}
      onCancel={onCancel}
      onConfirm={() => {
        if (canWrite()) onConfirm()
      }}
    >
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      {action.type === 'delete' ? (
        <>
          <p>
            {action.entries.length === 1
              ? t('This item and its contents will be deleted permanently.')
              : t('These {0} items and their contents will be deleted permanently.', {
                  '0': action.entries.length,
                })}
          </p>
          <pre className="confirm-paths max-h-[240px] overflow-auto p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) text-caption bg-fill">
            {action.entries.map((entry) => entry.path).join('\n')}
          </pre>
        </>
      ) : (
        <>
          <label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch">
            {t('Name')}
            <Input
              ref={nameInput}
              readOnly={viewOnly}
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !busy && canWrite()) onConfirm()
              }}
            />
          </label>
          <p className="muted text-muted-foreground small text-caption">
            {repoName}
            {action.type === 'create' && action.parent ? ` / ${action.parent}` : ''}
          </p>
        </>
      )}
    </Dialog>
  )
}
