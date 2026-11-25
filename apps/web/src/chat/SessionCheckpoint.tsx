import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookmarkCheck, Pencil } from 'lucide-react'
import { checkpointMarkdown } from '@ramu/shared/chat/checkpointMarkdown'
import { MarkdownText } from './MarkdownText'
import { Button } from '@/components/desktop-button'
import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { ipcQueryKeyOn } from '../dataQueries'
import { invokerFor, ramu } from '../ipc'
import { errorText } from '../lib/errors'
import { useViewOnly } from '../composer/useViewOnly'
import { ownHostId } from '../hosts'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { t, useLanguage, formatLocale } from '../i18n'
import { CopyButton } from '../views/agent/components/CopyButton'
import { GHOST_TEXT_BUTTON_CLASS } from '../views/agent/styles'

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
  // The text being edited, or null while the summary is only being read.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const host = useHost().id
  const viewOnly = useViewOnly()
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
    setDraft(null)
    setError(null)
  }, [sessionId])
  if (!checkpoint) return null
  const show = (next: boolean) => {
    setOpen(next)
    if (next) return
    setDraft(null)
    setError(null)
  }
  // The host refuses text that looks like a credential; the reason shows here and the edit stays open to fix it.
  const save = (summary: string) => {
    setSaving(true)
    setError(null)
    invokerFor(host)('agent.saveCheckpoint', sessionId, summary)
      .then(
        async () => {
          await refetch()
          setDraft(null)
        },
        (reason) => setError(errorText(reason)),
      )
      .finally(() => setSaving(false))
  }
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
      <Dialog open={open} onOpenChange={(next) => !saving && show(next)}>
        <DialogContent className="flex max-h-[min(640px,calc(100vh-48px))] w-[min(680px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 p-0">
          <DialogHeader className="flex-none gap-1.5 px-5 pt-5 pb-3.5 pr-12 [border-bottom:1px_solid_var(--line)]">
            <DialogTitle className="flex items-center gap-2 text-heading font-semibold">
              <BookmarkCheck size={15} className="text-brand" />
              {t('Session checkpoint')}
            </DialogTitle>
            <DialogDescription className="text-caption text-muted-foreground">
              <span title={saved}>{t('Saved {0}', { '0': savedAgo(checkpoint.updatedAt) })}</span>
              {' · '}
              {t('This thread only. Newer messages and current files take priority over this summary.')}
            </DialogDescription>
          </DialogHeader>
          {draft === null ? (
            <MarkdownText className="min-h-0 flex-1 overflow-auto px-5 py-4">
              {checkpointMarkdown(checkpoint.summary)}
            </MarkdownText>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 px-5 py-4">
              <Textarea
                autoFocus
                aria-label={t('Checkpoint text')}
                className="min-h-64 flex-1 font-mono text-caption"
                value={draft}
                disabled={saving}
                onChange={(event) => setDraft(event.target.value)}
              />
              {error && (
                <p role="alert" className="m-0 text-caption text-bad">
                  {error}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-none items-center gap-2 px-4 py-2.5 [border-top:1px_solid_var(--line)]">
            {draft === null ? (
              <>
                <span className="flex-1 text-caption text-muted-foreground">
                  {t('Copy to reuse it in another thread')}
                </span>
                {!viewOnly && (
                  <Button variant="ghost" size="sm" onClick={() => setDraft(checkpoint.summary)}>
                    <Pencil size={13} />
                    {t('Edit')}
                  </Button>
                )}
                <CopyButton text={checkpoint.summary} />
                <Button variant="secondary" size="sm" onClick={() => show(false)}>
                  {t('Done')}
                </Button>
              </>
            ) : (
              <>
                <span className="flex-1 text-caption text-muted-foreground">
                  {t('Agents read this when the thread continues.')}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving}
                  onClick={() => {
                    setDraft(null)
                    setError(null)
                  }}
                >
                  {t('Cancel')}
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className={PRIMARY_ACTION_CLASS}
                  disabled={saving || !draft.trim() || draft === checkpoint.summary}
                  onClick={() => save(draft)}
                >
                  {saving ? t('Saving…') : t('Save')}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
