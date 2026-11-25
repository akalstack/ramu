import { useEffect, useState } from 'react'
import { GitPullRequest } from 'lucide-react'
import { shipActivityText } from '@ramu/shared/ship'
import type { ShipActivity } from '@ramu/shared/types/ship'
import { Button } from '@/components/desktop-button'
import { Dialog } from '../Menu'
import { useViewOnly } from '../composer/useViewOnly'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useHost } from '../workspace/HostProvider'
import { useHostSelection } from '../workspace/HostSelection'
import { useHostRuntime } from '../workspace/workspace'
import { InboxList, InboxMark, InboxRow } from './InboxParts'

/**
 * Inbox's Done: what Ship did without asking, such as a check fix it pushed, with Open for the thread and Undo, which
 * reverts that fix while nothing came after it. Listed for a week.
 */
export function ShipActivityList() {
  useLanguage()
  const { id: hostId, invoke } = useHost()
  const runtime = useHostRuntime()
  const viewOnly = useViewOnly()
  const { select } = useHostSelection()
  const [entries, setEntries] = useState<ShipActivity[]>([])
  const [undoing, setUndoing] = useState<ShipActivity | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (viewOnly) return
    let current = true
    // An older host has no Ship, and lists nothing.
    const read = () =>
      void invoke('ship.activity').then(
        (next) => current && setEntries(next),
        () => {},
      )
    read()
    const off = runtime.on('workspace:changed', read)
    return () => {
      current = false
      off()
    }
  }, [invoke, runtime, viewOnly])
  if (!entries.length) return null
  const undo = () => {
    if (!undoing) return
    setBusy(true)
    setError(null)
    void invoke('ship.undo', undoing.id)
      .then((next) => {
        setEntries(next)
        setUndoing(null)
      })
      .catch((reason) => setError(errorText(reason)))
      .finally(() => setBusy(false))
  }
  return (
    <FeedSection title={t('Done for you')} count={entries.length}>
      <p className="m-0 text-caption text-muted-foreground">
        {t('What Ship did without asking in the last week, which you can undo while nothing came after it.')}
      </p>
      <InboxList label={t('Done for you')}>
        {entries.map((entry) => {
          const text = shipActivityText(entry, t)
          const open = () => select(hostId, { kind: 'task', taskId: entry.taskId, sessionId: entry.sessionId })
          return (
            <InboxRow
              key={entry.id}
              mark={
                <InboxMark tone={entry.undoneAt ? 'neutral' : 'warn'}>
                  <GitPullRequest />
                </InboxMark>
              }
              title={text.title}
              meta={[text.detail, entry.title].filter(Boolean).join(' · ')}
              at={entry.undoneAt ?? entry.at}
              onOpen={open}
              actions={
                !entry.undoneAt && (
                  <Button variant="ghost" size="xs" onClick={() => setUndoing(entry)}>
                    {t('Undo')}
                  </Button>
                )
              }
            />
          )
        })}
      </InboxList>
      {undoing && (
        <Dialog
          title={t('Undo this fix?')}
          confirmLabel={t('Undo fix')}
          danger
          busy={busy}
          error={error}
          onConfirm={undo}
          onCancel={() => {
            if (busy) return
            setUndoing(null)
            setError(null)
          }}
        >
          <p className="m-0">
            {t(
              'Ramu adds a commit that reverts {0} on {1} and pushes it, then tells the thread not to push it again.',
              {
                0: `${undoing.from.slice(0, 7)}..${undoing.to.slice(0, 7)}`,
                1: undoing.number === null ? undoing.url : `#${undoing.number}`,
              },
            )}
          </p>
        </Dialog>
      )}
    </FeedSection>
  )
}
