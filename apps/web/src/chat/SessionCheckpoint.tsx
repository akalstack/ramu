import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BookOpen } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../Menu'
import { ipcQueryKey } from '../dataQueries'
import { ramu } from '../ipc'
import { t, useLanguage, formatLocale } from '../i18n'

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
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} title={t('Saved progress for this chat')}>
        <BookOpen data-icon="inline-start" />
        {t('Session checkpoint')}
      </Button>
      {open && (
        <Dialog
          title={t('Session checkpoint')}
          confirmLabel={t('Done')}
          onConfirm={() => setOpen(false)}
          onCancel={() => setOpen(false)}
        >
          <p className="text-muted-foreground">
            {t('Progress for this chat only. Current messages and files take precedence over this summary.')}
          </p>
          <p className="text-muted-foreground">
            {new Date(checkpoint.updatedAt).toLocaleString(formatLocale())} ·{' '}
            {t('Through event {0}', { 0: checkpoint.seq })}
          </p>
          <p className="whitespace-pre-wrap">{checkpoint.summary}</p>
        </Dialog>
      )}
    </>
  )
}
