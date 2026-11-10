import { useState } from 'react'
import { CheckCircle2, CornerDownRight, RotateCcw } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import { t, useLanguage } from '../i18n'

/**
 * Answering a review thread where it is read: Reply opens a box under its last comment, and Resolve closes the thread
 * (Reopen brings it back) in the same row, so a review is answered without leaving the pull request.
 */
export function ThreadReply({
  resolved,
  resolvable,
  onReply,
  onStatus,
}: {
  resolved: boolean
  resolvable: boolean
  /** Posts the reply; resolves false when it failed, keeping the text. */
  onReply: (body: string) => Promise<boolean>
  onStatus?: (resolve: boolean) => Promise<boolean>
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState<'reply' | 'status' | null>(null)
  const send = async (andResolve: boolean) => {
    setBusy('reply')
    const posted = await onReply(body.trim())
    if (posted && andResolve && onStatus) await onStatus(true)
    setBusy(null)
    if (posted) {
      setBody('')
      setOpen(false)
    }
  }
  if (!open)
    return (
      <div className="flex items-center gap-2">
        {/* Reads as the field it opens, so answering is one click on the obvious place. */}
        <Button
          variant="ghost"
          className="h-8 min-w-0 flex-1 justify-start gap-2 rounded-(--radius-s) border border-line bg-field px-3 font-normal text-muted-foreground hover:bg-field hover:text-soft"
          onClick={() => setOpen(true)}
        >
          <CornerDownRight size={13} className="flex-none" />
          <span className="truncate">{t('Write a reply…')}</span>
        </Button>
        {resolvable && onStatus && (
          <Button
            size="sm"
            variant="secondary"
            className="flex-none"
            disabled={busy !== null}
            onClick={() => {
              setBusy('status')
              void onStatus(!resolved).finally(() => setBusy(null))
            }}
          >
            {resolved ? <RotateCcw size={13} /> : <CheckCircle2 size={13} />}
            {resolved ? t('Unresolve') : t('Resolve')}
          </Button>
        )}
      </div>
    )
  return (
    <div className="flex flex-col gap-1.5">
      <Textarea
        autoFocus
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && body.trim()) void send(false)
          if (event.key === 'Escape' && !body.trim()) setOpen(false)
        }}
        aria-label={t('Reply to this thread')}
        placeholder={t('Reply. Markdown works.')}
        className="min-h-16 text-control"
      />
      <div className="flex flex-wrap justify-end gap-1.5">
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setOpen(false)}>
          {t('Cancel')}
        </Button>
        {resolvable && onStatus && !resolved && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy !== null || !body.trim()}
            onClick={() => void send(true)}
          >
            {t('Reply and resolve')}
          </Button>
        )}
        <Button size="sm" disabled={busy !== null || !body.trim()} onClick={() => void send(false)}>
          {busy === 'reply' ? t('Posting…') : t('Reply')}
        </Button>
      </div>
    </div>
  )
}
