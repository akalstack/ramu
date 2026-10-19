import { useEffect, useRef, useState } from 'react'
import { BookmarkPlus, Library } from 'lucide-react'
import {
  hasMessageDraft,
  SavedDraftError,
  savedDraftScopeKey,
  type MessageDraftSnapshot,
  type SavedDraftCommand,
  type SavedDraftLibrary,
  type SavedDraftScope,
  type SavedMessageDraft,
} from '@ramu/shared/chat/savedDrafts'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { formatLocale, t, useLanguage } from '../i18n'
import { SAVE_DRAFT_EVENT, SAVED_DRAFTS_EVENT } from './savedDraftEvents'
import { commitSavedDraftMove, loadSavedDrafts, savedDraftPreview } from './savedDrafts'

const problemText = (error: unknown) => {
  const code = error instanceof SavedDraftError ? error.code : 'invalid'
  if (code === 'full' || code === 'recovery-size')
    return t(
      'Saved drafts are full. Delete a saved item or reduce this message before trying again. Your message is kept.',
    )
  if (code === 'conflict' || code === 'scope')
    return t('The message or saved drafts changed. Review the current composer and try again.')
  if (code === 'uploading') return t('Wait for attachments to finish uploading before saving or restoring.')
  if (code === 'empty') return t('Nothing to save yet.')
  return t('Could not save draft. Your message is kept. Check available device storage and try again.')
}

/**
 * Save draft / Saved drafts for one composer. Saving and restoring persist the library before the visible composer
 * changes (`onApply`), and never send, queue or start anything.
 */
export function SavedDraftsControl({
  host,
  scope,
  snapshot,
  uploading,
  onApply,
  focused,
}: {
  host: string
  scope: SavedDraftScope | null
  snapshot: MessageDraftSnapshot
  uploading: boolean
  onApply: (next: MessageDraftSnapshot) => void
  /** Whether this composer owns keyboard focus, for the palette/shortcut events. */
  focused: () => boolean
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const [allOnHost, setAllOnHost] = useState(false)
  const [library, setLibrary] = useState<SavedDraftLibrary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<SavedMessageDraft | null>(null)
  const latest = useRef({ snapshot, uploading, scope, host })
  latest.current = { snapshot, uploading, scope, host }

  const read = () => {
    try {
      setLibrary(loadSavedDrafts(latest.current.host))
      setError(null)
    } catch {
      setLibrary(null)
      setError(t('Could not read saved drafts. The stored data has been kept for recovery.'))
    }
  }
  useEffect(() => {
    setDeleted(null)
    setNotice(null)
    read()
  }, [host])

  const run = (command: SavedDraftCommand, applied = true) => {
    const { snapshot: active, uploading: busy, scope: where, host: owner } = latest.current
    if (!where) return false
    if (busy && command.kind !== 'delete' && command.kind !== 'undo-delete') {
      setError(t('Wait for attachments to finish uploading before saving or restoring.'))
      return false
    }
    try {
      const moved = commitSavedDraftMove({ host: owner, scope: where, active, command })
      setLibrary(moved.library)
      setError(null)
      if (applied && command.kind !== 'delete' && command.kind !== 'undo-delete') onApply(moved.active)
      setDeleted(moved.deleted ?? null)
      return true
    } catch (problem) {
      setError(problemText(problem))
      return false
    }
  }
  const save = () => {
    if (!hasMessageDraft(latest.current.snapshot)) return
    if (run({ kind: 'save', id: crypto.randomUUID(), at: Date.now() })) setNotice(t('Draft saved'))
  }
  useEffect(() => {
    const onSave = () => focused() && save()
    const onList = () => {
      if (!focused()) return
      read()
      setOpen(true)
    }
    window.addEventListener(SAVE_DRAFT_EVENT, onSave)
    window.addEventListener(SAVED_DRAFTS_EVENT, onList)
    return () => {
      window.removeEventListener(SAVE_DRAFT_EVENT, onSave)
      window.removeEventListener(SAVED_DRAFTS_EVENT, onList)
    }
  }, [])

  const items = (library?.items ?? []).filter(
    (item) => allOnHost || (scope && savedDraftScopeKey(item.scope) === savedDraftScopeKey(scope)),
  )
  const occupied = hasMessageDraft(snapshot)
  const restore = (item: SavedMessageDraft) => {
    const here = scope && savedDraftScopeKey(item.scope) === savedDraftScopeKey(scope)
    const ok = run({
      kind: here ? 'restore' : 'restore-here',
      id: item.id,
      itemRevision: item.revision,
      ...(occupied ? { parkId: crypto.randomUUID() } : {}),
      at: Date.now(),
    })
    if (ok) setOpen(false)
  }
  const when = (time: number) =>
    new Date(time).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })
  const canSave = !!scope && hasMessageDraft(snapshot) && !uploading

  return (
    <>
      <Button
        variant="ghost"
        size="icon-xs"
        className="icon small-icon"
        aria-label={t('Save draft')}
        title={t('Save draft')}
        disabled={!canSave}
        onClick={save}
      >
        <BookmarkPlus size={15} />
      </Button>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (next) read()
          setOpen(next)
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="icon small-icon"
              aria-label={t('Saved drafts')}
              title={t('Saved drafts')}
            />
          }
        >
          <Library size={15} />
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-[360px] max-w-[92vw] gap-2 p-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <strong className="text-control">{t('Saved drafts')}</strong>
            <Button variant="ghost" size="xs" onClick={() => setAllOnHost((value) => !value)}>
              {allOnHost ? t('Drafts for this composer') : t('All drafts on this host')}
            </Button>
          </div>
          <p className="px-1 text-caption text-muted-foreground">
            {t('Saved on this device. Restoring never sends a message.')}
          </p>
          {error && (
            <div role="alert" className="px-1 text-caption text-bad">
              {error}
            </div>
          )}
          <div role="status" className="sr-only">
            {notice}
          </div>
          {deleted && (
            <div className="flex items-center justify-between gap-2 px-1 text-caption">
              <span>{t('Draft deleted')}</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  run({ kind: 'undo-delete', item: deleted }, false)
                }}
              >
                {t('Undo delete')}
              </Button>
            </div>
          )}
          {!items.length && !error && (
            <p className="px-1 py-3 text-center text-control text-muted-foreground">{t('No saved drafts here yet.')}</p>
          )}
          <ul className="m-0 flex max-h-[280px] list-none flex-col gap-1 overflow-auto p-0">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 rounded-(--radius-row) p-1.5 hover:bg-hover">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-control">{savedDraftPreview(item.snapshot) || t('Attachments')}</div>
                  <div className="text-caption text-muted-foreground">
                    {when(item.savedAt)}
                    {item.snapshot.attachments.length > 0 &&
                      ` · ${t('{0} attachments', { '0': item.snapshot.attachments.length })}`}
                    {item.snapshot.context.length > 0 && ` · ${t('{0} files', { '0': item.snapshot.context.length })}`}
                    {item.scope.label && ` · ${item.scope.label}`}
                  </div>
                </div>
                <Button variant="secondary" size="xs" onClick={() => restore(item)}>
                  {occupied ? t('Save current and restore') : t('Restore')}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  aria-label={t('Delete draft')}
                  onClick={() => run({ kind: 'delete', id: item.id, itemRevision: item.revision }, false)}
                >
                  {t('Delete')}
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
    </>
  )
}
