import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GitPullRequest, Undo2 } from 'lucide-react'
import type { PullRequestWriteCard, PullRequestWriteItem } from '@ramu/shared/types'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import {
  editableWrite,
  pullRequestWriteBody,
  pullRequestWriteDetail,
  pullRequestWriteTitle,
} from '@ramu/shared/pullRequestWriteText'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { errorText } from '../workspace/TaskPane'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { queryInvokerFor } from './hostQuery'
import { PullRequestMarkdown } from './PullRequestMarkdown'

const STATE_LABEL = {
  waiting: () => t('Waiting for you'),
  posted: () => t('Posted'),
  failed: () => t('Failed'),
  dismissed: () => t('Dismissed'),
  undone: () => t('Undone'),
}

/**
 * The pull request writes an agent asked for in one turn: exactly what goes out, the account it posts as, and Post,
 * Edit and Dismiss; Undo for what already went out where the service can take it back.
 */
export function PullRequestWritesCard({ cardId }: { cardId: string }) {
  useLanguage()
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const { on } = useHostRuntime()
  const query = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.writeCard', cardId),
    queryFn: () => call('forge.writeCard', cardId),
  })
  const { refetch } = query
  useEffect(() => on('workspace:changed', () => void refetch()), [on, refetch])
  const card = query.data
  if (query.isPending) return null
  if (!card)
    return <p className="m-[12px_0] text-caption text-muted-foreground">{t('This pull request card is gone.')}</p>
  return <WritesCard card={card} onChange={() => void refetch()} />
}

function WritesCard({ card, onChange }: { card: PullRequestWriteCard; onChange: () => void }) {
  const { invoke } = useHost()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const waiting = card.items.filter((item) => item.state === 'waiting' || item.state === 'failed')
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
      onChange()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const editList = (ids: string[]) =>
    Object.entries(edits)
      .filter(([itemId]) => ids.includes(itemId))
      .map(([itemId, body]) => ({ itemId, body }))
  const post = (ids: string[]) =>
    run(async () => {
      await invoke('forge.postWrites', card.id, ids, editList(ids))
      setEdits({})
      setEditing(null)
    })

  return (
    <section
      className="m-[12px_0] flex flex-col gap-2 rounded-(--radius-m) bg-fill p-[15px]"
      aria-label={t('Pull request actions')}
    >
      <div className="flex min-w-0 items-center gap-2">
        <GitPullRequest size={16} className="flex-none" aria-hidden="true" />
        <a
          className="min-w-0 flex-1 truncate font-semibold text-foreground"
          href={card.url}
          target="_blank"
          rel="noreferrer"
        >
          #{card.number} {card.title}
        </a>
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        {card.account
          ? t('Posts on {0} as {1}', { '0': FORGE_NAMES[card.service], '1': card.account })
          : t('Posts on {0}', { '0': FORGE_NAMES[card.service] })}
      </p>
      {card.items.map((item) => (
        <WriteRow
          key={item.id}
          item={item}
          busy={busy}
          editing={editing === item.id}
          text={edits[item.id]}
          onEdit={() => setEditing(item.id)}
          onText={(value) => setEdits((current) => ({ ...current, [item.id]: value }))}
          onPost={() => void post([item.id])}
          onDismiss={() => void run(() => invoke('forge.dismissWrites', card.id, [item.id]))}
          onUndo={() => void run(() => invoke('forge.undoWrite', card.id, item.id))}
        />
      ))}
      {error && (
        <p role="alert" className="m-0 text-caption text-bad [overflow-wrap:anywhere] whitespace-pre-wrap">
          {error}
        </p>
      )}
      {waiting.length > 1 && (
        <div className="flex justify-end gap-2 border-t border-line pt-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void run(() => invoke('forge.dismissWrites', card.id))}
          >
            {t('Dismiss all')}
          </Button>
          <Button size="sm" variant="default" disabled={busy} onClick={() => void post(waiting.map((item) => item.id))}>
            {t('Post all')}
          </Button>
        </div>
      )}
    </section>
  )
}

function WriteRow({
  item,
  busy,
  editing,
  text,
  onEdit,
  onText,
  onPost,
  onDismiss,
  onUndo,
}: {
  item: PullRequestWriteItem
  busy: boolean
  editing: boolean
  text: string | undefined
  onEdit: () => void
  onText: (value: string) => void
  onPost: () => void
  onDismiss: () => void
  onUndo: () => void
}) {
  const title = pullRequestWriteTitle(item.write)
  const body = text ?? pullRequestWriteBody(item.write)
  const detail = pullRequestWriteDetail(item.write)
  const open = item.state === 'waiting' || item.state === 'failed'
  const lineComments = item.write.kind === 'review' ? item.write.comments : []
  return (
    <div className="flex flex-col gap-1.5 border-t border-line pt-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium">{t(title.text, title.values)}</span>
        {detail && <span className="min-w-0 truncate text-caption text-muted-foreground">{detail}</span>}
        <span
          className={`ml-auto text-caption ${item.state === 'failed' ? 'text-bad' : item.state === 'posted' ? 'text-ok' : 'text-muted-foreground'}`}
        >
          {item.state === 'waiting' && item.decision ? t('Needs your decision') : STATE_LABEL[item.state]()}
        </span>
      </div>
      {editing && open && body !== null ? (
        <Textarea
          value={body}
          onChange={(event) => onText(event.target.value)}
          aria-label={t('Text to post')}
          className="min-h-24"
        />
      ) : (
        body && <PullRequestMarkdown className="text-control">{body}</PullRequestMarkdown>
      )}
      {lineComments.map((comment) => (
        <div key={comment.id} className="border-l-2 border-line pl-2">
          <div className="text-caption text-muted-foreground">
            {comment.path}:{comment.line}
          </div>
          <PullRequestMarkdown className="text-caption">
            {pullRequestWriteBody({ kind: 'line-comment', comment }) ?? ''}
          </PullRequestMarkdown>
        </div>
      ))}
      {item.error && (
        <p role="alert" className="m-0 text-caption text-bad [overflow-wrap:anywhere]">
          {item.error}
        </p>
      )}
      {(open || (item.state === 'posted' && item.undoable)) && (
        <div className="flex justify-end gap-2">
          {open && (
            <>
              <Button variant="ghost" size="sm" disabled={busy} onClick={onDismiss}>
                {t('Dismiss')}
              </Button>
              {editableWrite(item) && !editing && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
                  {t('Edit')}
                </Button>
              )}
              <Button size="sm" variant="default" disabled={busy} onClick={onPost}>
                {item.state === 'failed' ? t('Try again') : t('Post')}
              </Button>
            </>
          )}
          {item.state === 'posted' && item.undoable && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo}>
              <Undo2 size={13} aria-hidden="true" />
              {t('Undo')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
