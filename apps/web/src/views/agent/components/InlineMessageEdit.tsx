import { t as translate, useLanguage } from '../../../i18n'
import { Button } from '@/components/desktop-button'
import { Send } from 'lucide-react'
import { useState } from 'react'
import type { Attachment } from '@ramu/shared/types'
import { Textarea } from '@/components/ui/textarea'
import { UndoRun } from '../../../chat/UndoRun'
import { outbox } from '../../../composer/outbox'

/** Edits a sent message inside its bubble. Enter sends, Shift+Enter adds a line, Esc cancels. */
/** `offlineHost` names the unreachable computer: the revision goes to the outbox and file restore is unavailable until it is back. */
export function InlineMessageEdit({
  original,
  files,
  sessionId,
  seq,
  busy,
  offlineHost,
  onCancel,
  onSubmit,
}: {
  original: string
  files: Attachment[]
  sessionId: string
  seq: number
  busy: boolean
  offlineHost?: string
  onCancel: () => void
  onSubmit: (text: string, restored: boolean) => void
}) {
  useLanguage()
  const [text, setText] = useState(original)
  const [restored, setRestored] = useState(false)
  // Sending an unchanged message only reruns it, so the first press asks.
  const [confirmSame, setConfirmSame] = useState(false)
  const empty = !text.trim() && !files.length
  const submit = () => {
    if (busy || empty) return
    if (text.trim() === original.trim() && !restored && !confirmSame) {
      setConfirmSame(true)
      return
    }
    onSubmit(text, restored)
  }
  return (
    <div
      className="inline-edit self-end mt-[18px] flex w-[min(640px,_100%)] flex-col gap-2 rounded-(--radius-l) [background:var(--bubble)] p-[8px_10px_10px] [box-shadow:0_0_0_1.5px_var(--accent)]"
      role="region"
      aria-label={translate('Editing message')}
    >
      <Textarea
        autoFocus
        value={text}
        aria-label={translate('Edit your message')}
        disabled={busy}
        className="min-h-[44px] max-h-[40vh] resize-none overflow-y-auto border-0 bg-transparent! p-[4px_6px] text-chat leading-[1.55] shadow-none focus-visible:border-0 focus-visible:ring-0"
        onFocus={(event) => {
          const end = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(end, end)
        }}
        onChange={(event) => {
          setText(event.target.value)
          setConfirmSame(false)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onCancel()
          } else if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      {confirmSame && (
        <p className="m-0 px-1.5 text-caption text-warn" role="status">
          {translate('Nothing changed. Send it again anyway?')}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <span className="mr-auto min-w-0 px-1.5 text-caption text-muted-foreground">
          {restored
            ? translate('Selected files restored.')
            : offlineHost
              ? translate('Replaces this request. Sends when {0} is back; restoring files needs it online.', {
                  0: offlineHost,
                })
              : translate('Replaces this request. Files stay as they are unless you restore them.')}
        </span>
        {!restored && !offlineHost && (
          <UndoRun sessionId={sessionId} userSeq={seq} onRestored={() => setRestored(true)} />
        )}
        <Button
          variant="ghost"
          size="sm"
          className="text-caption"
          disabled={busy}
          title={translate('Esc')}
          onClick={onCancel}
        >
          {translate('Cancel')}
        </Button>
        <Button
          variant="default"
          size="sm"
          className="text-caption font-semibold"
          disabled={busy || empty}
          title={translate('Enter')}
          onClick={submit}
        >
          {confirmSame ? translate('Send anyway') : offlineHost ? translate('Queue') : translate('Send')}
        </Button>
      </div>
    </div>
  )
}
