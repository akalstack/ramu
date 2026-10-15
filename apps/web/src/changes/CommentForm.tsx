import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { t, useLanguage } from '../i18n'
import { useHostConnection } from '../workspace/computers'
import { formatKeys } from '../commands'
import { NOTE_CLASS, WHERE_CLASS } from './styles'

/** The comment form, new or editing. Its card, header and actions match the posted note and the chat's inline edit. */
export function CommentForm({
  inputRef,
  path,
  where,
  editing,
  value,
  unchanged,
  error,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  inputRef: React.RefObject<HTMLTextAreaElement | null>
  path: string
  where: string
  editing: boolean
  value: string
  unchanged: boolean
  error: string | null
  busy: boolean
  onChange: (value: string) => void
  onCancel: () => void
  onSave: () => void
}) {
  useLanguage()
  const host = useHostConnection()
  const blocked = busy || host.offline || !value.trim() || unchanged
  const save = () => {
    if (!blocked) onSave()
  }
  const hint = host.offline
    ? t('Your draft is kept. Saving needs {0} online.', { 0: host.name })
    : unchanged
      ? t('Nothing changed yet.')
      : t('Goes with your next message to the agent.')
  return (
    <div
      className={`${NOTE_CLASS} editing`}
      role="region"
      aria-label={editing ? t('Editing comment') : t('New comment')}
    >
      <header>
        <span className={WHERE_CLASS}>{where}</span>
        <span className="muted text-muted-foreground small text-caption">
          {editing ? t('Editing comment') : t('New comment')}
        </span>
      </header>
      <Textarea
        ref={inputRef}
        aria-label={t('Comment on {0}', { '0': path })}
        rows={2}
        maxLength={10000}
        placeholder={t('What should change, or what would you like to ask?')}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            save()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      {error && (
        <p className="error m-0 text-bad small text-caption" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span className="mr-auto min-w-0 text-caption text-muted-foreground" role={host.offline ? 'status' : undefined}>
          {hint}
        </span>
        <Button variant="ghost" size="sm" className="text-caption" disabled={busy} title={t('Esc')} onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="text-caption font-semibold"
          disabled={blocked}
          title={formatKeys('mod+enter')}
          onClick={save}
        >
          {editing ? t('Save') : t('Comment')}
        </Button>
      </div>
    </div>
  )
}
