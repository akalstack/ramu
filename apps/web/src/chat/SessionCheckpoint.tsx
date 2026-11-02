import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { BookmarkCheck } from 'lucide-react'
import { checkpointMarkdown } from '@ramu/shared/chat/checkpointMarkdown'
import { chatMarkdownComponents } from './ChatMarkdown'
import { Button } from '@/components/desktop-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ipcQueryKeyOn } from '../dataQueries'
import { ramu } from '../ipc'
import { ownHostId } from '../hosts'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
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
  const host = useHost().id
  const { on } = useHostRuntime()
  // The raw bridge call: this query already owns the cache key `invoke` would read through.
  const { data: checkpoint, refetch } = useQuery({
    queryKey: ipcQueryKeyOn(host, 'agent.checkpoint', sessionId),
    queryFn: () =>
      host === ownHostId()
        ? ramu.invoke('agent.checkpoint', sessionId)
        : ramu.invokeOn(host, 'agent.checkpoint', sessionId),
  })
  useEffect(
    () =>
      on('memory:changed', () => {
        void refetch()
      }),
    [on, refetch],
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
        title={t('Saved progress for this thread · {0}', { '0': saved })}
        onClick={() => setOpen(true)}
      >
        <BookmarkCheck size={13} />
        {t('Checkpoint')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[min(640px,calc(100vh-48px))] w-[min(680px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 p-0">
          <DialogHeader className="flex-none gap-1.5 px-5 pt-5 pb-3.5 pr-12 [border-bottom:1px_solid_var(--line)]">
            <DialogTitle className="flex items-center gap-2 text-heading font-semibold">
              <BookmarkCheck size={15} className="text-brand" />
              {t('Session checkpoint')}
            </DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              <span title={saved}>{t('Saved {0}', { '0': savedAgo(checkpoint.updatedAt) })}</span>
              {' · '}
              {t('This thread only. Newer messages and the current files win over this summary.')}
            </DialogDescription>
          </DialogHeader>
          <div
            className={`${MSG_CLASS} assistant min-h-0 flex-1 overflow-auto px-5 py-4 text-control [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:text-control [&_h2]:font-semibold [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_li]:my-1`}
          >
            <Markdown remarkPlugins={[remarkGfm]} components={chatMarkdownComponents}>
              {checkpointMarkdown(checkpoint.summary)}
            </Markdown>
          </div>
          <div className="flex flex-none items-center gap-2 px-4 py-2.5 [border-top:1px_solid_var(--line)]">
            <span className="flex-1 text-caption text-muted-foreground">{t('Copy to reuse it in another thread')}</span>
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
