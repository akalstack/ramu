import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookmarkCheck } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ipcQueryKey } from '../dataQueries'
import { ramu } from '../ipc'
import { t, useLanguage, formatLocale } from '../i18n'
import { CopyButton } from '../views/agent/components/CopyButton'
import { GHOST_TEXT_BUTTON_CLASS, MSG_CLASS } from '../views/agent/styles'

/** "5 minutes ago", falling back to the date once it is more than a week old. */
function savedAgo(at: number): string {
  const seconds = Math.round((at - Date.now()) / 1000)
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ]
  if (-seconds > 7 * 86_400)
    return new Date(at).toLocaleString(formatLocale(), { dateStyle: 'medium', timeStyle: 'short' })
  const format = new Intl.RelativeTimeFormat(formatLocale(), { numeric: 'auto' })
  for (const [unit, size] of units)
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit)
  return t('just now')
}

/** The chat's saved progress summary: a header chip, and a dialog to read it. */
export function SessionCheckpointButton({ sessionId }: { sessionId: string }) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const { data: checkpoint, refetch } = useQuery({
    queryKey: ipcQueryKey('agent.checkpoint', sessionId),
    queryFn: () => ramu.invoke('agent.checkpoint', sessionId),
  })
  useEffect(
    () =>
      ramu.on('memory:changed', () => {
        void refetch()
      }),
    [refetch],
  )
  useEffect(() => {
    setOpen(false)
  }, [sessionId])
  if (!checkpoint) return null
  const saved = new Date(checkpoint.updatedAt).toLocaleString(formatLocale())
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`${GHOST_TEXT_BUTTON_CLASS} checkpoint-chip gap-1.5 text-soft`}
        aria-haspopup="dialog"
        title={t('Saved progress for this chat · {0}', { '0': saved })}
        onClick={() => setOpen(true)}
      >
        <BookmarkCheck size={13} />
        {t('Checkpoint')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(640px,calc(100vh-48px))] w-[min(600px,calc(100vw-48px))] max-w-none flex-col gap-0 p-0">
          <DialogHeader className="flex-none gap-1.5 px-5 pt-5 pb-3.5 pr-12 [border-bottom:1px_solid_var(--line)]">
            <DialogTitle className="flex items-center gap-2 text-heading font-semibold">
              <BookmarkCheck size={15} className="text-brand" />
              {t('Session checkpoint')}
            </DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              <span title={saved}>{t('Saved {0}', { '0': savedAgo(checkpoint.updatedAt) })}</span>
              {' · '}
              {t('This chat only. Newer messages and the current files win over this summary.')}
            </DialogDescription>
          </DialogHeader>
          <div className={`${MSG_CLASS} assistant min-h-0 flex-1 overflow-auto px-5 py-4 text-control`}>
            <Markdown remarkPlugins={[remarkGfm]}>{checkpoint.summary}</Markdown>
          </div>
          <div className="flex flex-none items-center gap-2 px-4 py-2.5 [border-top:1px_solid_var(--line)]">
            <span className="flex-1 text-caption text-muted-foreground">{t('Copy to reuse it in another chat')}</span>
            <CopyButton text={checkpoint.summary} />
            <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
              {t('Done')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
