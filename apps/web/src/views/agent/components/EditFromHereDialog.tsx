import { useEffect, useState } from 'react'
import { History, LoaderCircle, Paperclip, RotateCcw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { notify } from '@/components/app-toaster'
import type { Attachment, UndoPreview } from '@ramu/shared/types'
import { t, useLanguage } from '../../../i18n'
import { invoke } from '../../../ipc'
import { useWorkspace } from '../../../workspace/workspace'
import { errorText } from '../../../workspace/TaskPane'
import type { MessageEdit } from '../types'

/**
 * Editing a sent message rewinds the chat to just before it, as T3 Code does: the message and everything after it leave
 * the transcript, and the text and attachments go back into the message box to change and send. Files stay as they
 * are unless "Revert files too" restores what the agent changed from that message on.
 */
export function EditFromHereDialog({
  edit,
  sessionId,
  live,
  offlineHost,
  onCancel,
  onRewound,
}: {
  edit: MessageEdit
  sessionId: string
  /** The agent is working: rewinding stops it first. */
  live: boolean
  offlineHost: string | undefined
  onCancel: () => void
  onRewound: (text: string, files: Attachment[]) => void
}) {
  useLanguage()
  const ws = useWorkspace()
  const [plan, setPlan] = useState<UndoPreview | null>(null)
  const [busy, setBusy] = useState<'keep' | 'revert' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which files a revert would restore, so the button can say so (or step aside when there are none).
  useEffect(() => {
    if (offlineHost) return
    let cancelled = false
    void invoke('reviews.chatUndoPreview', sessionId, edit.seq).then(
      (preview) => !cancelled && setPlan(preview),
      () => !cancelled && setPlan(null),
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, edit.seq, offlineHost])
  const ready = plan?.files.filter((file) => file.status === 'ready') ?? []
  const skipped = (plan?.files.length ?? 0) - ready.length

  const rewind = async (revert: boolean) => {
    setBusy(revert ? 'revert' : 'keep')
    setError(null)
    try {
      if (revert) {
        if (Object.values(ws.dirty).some(Boolean))
          throw new Error(t('Save or close unsaved files before reverting files.'))
        if (plan && ready.length) {
          await invoke(
            'reviews.chatUndoApply',
            plan.token,
            ready.map((file) => file.fileId),
          )
          window.dispatchEvent(new Event('ramu:git-updated'))
        }
      }
      await invoke('agent.rewind', sessionId, edit.seq)
      if (revert && skipped > 0)
        notify.add({
          title: skipped === 1 ? t('1 file was left as it is') : t('{0} files were left as they are', { '0': skipped }),
          description: t('They changed again after the agent edited them. Review them in Source Control.'),
          type: 'warning',
        })
      onRewound(edit.text, edit.files)
    } catch (reason) {
      setError(errorText(reason))
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onCancel()}>
      <DialogContent className="w-[min(480px,calc(100vw-48px))] max-w-none gap-0 p-0" showCloseButton={false}>
        <DialogHeader className="gap-1.5 px-5 pt-5 pb-4">
          <DialogTitle className="flex items-center gap-2 text-heading font-semibold">
            <History size={15} className="text-brand" />
            {t('Edit from here?')}
          </DialogTitle>
          <DialogDescription className="text-control leading-[1.5] text-muted-foreground">
            {live
              ? t(
                  'Stops the agent and rewinds the thread to before this message. Your prompt and attachments return to the message box.',
                )
              : t('Rewinds the thread to before this message. Your prompt and attachments return to the message box.')}
          </DialogDescription>
        </DialogHeader>
        <blockquote className="mx-5 mb-4 line-clamp-3 rounded-(--radius-m) bg-(--bubble) px-3.5 py-2.5 text-control leading-[1.5] whitespace-pre-wrap text-(--text-body)">
          {edit.text || t('(attachments only)')}
          {edit.files.length > 0 && (
            <span className="mt-1 flex items-center gap-1 text-caption text-muted-foreground">
              <Paperclip size={12} />
              {edit.files.length === 1 ? t('1 attachment') : t('{0} attachments', { '0': edit.files.length })}
            </span>
          )}
        </blockquote>
        {(error || offlineHost) && (
          <p role="alert" className="mx-5 mb-3 text-caption text-bad">
            {error ?? t('{0} is offline. Rewinding needs it connected.', { '0': offlineHost })}
          </p>
        )}
        <div className="flex items-center gap-2 px-4 py-3 [border-top:1px_solid_var(--line)]">
          <Button variant="ghost" size="sm" disabled={!!busy} onClick={onCancel}>
            {t('Cancel')}
          </Button>
          <span className="flex-1" />
          {ready.length > 0 && (
            <Button
              variant="destructive"
              size="sm"
              disabled={!!busy || !!offlineHost}
              title={t('Restore the files the agent changed from this message on')}
              onClick={() => void rewind(true)}
            >
              {busy === 'revert' ? <LoaderCircle className="animate-spin" /> : <RotateCcw />}
              {ready.length === 1 ? t('Revert 1 file too') : t('Revert {0} files too', { '0': ready.length })}
            </Button>
          )}
          <Button
            variant="default"
            size="sm"
            autoFocus
            disabled={!!busy || !!offlineHost}
            title={t('Files stay as they are')}
            onClick={() => void rewind(false)}
          >
            {busy === 'keep' && <LoaderCircle className="animate-spin" />}
            {ready.length > 0 ? t('Rewind and keep files') : t('Rewind')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
