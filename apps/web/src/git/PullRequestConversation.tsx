import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pencil, SmilePlus, Trash2 } from 'lucide-react'
import type { ForgeService, PullRequestReaction, PullRequestWrite } from '@ramu/shared/types'
import { PULL_REQUEST_REACTIONS, supportsPullRequest } from '@ramu/shared/pullRequestSupport'
import { REACTION_EMOJI } from '@ramu/shared/pullRequestWriteText'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/desktop-button'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Menu } from '../Menu'
import { t } from '../i18n'
import { ipcQueryKeyOn } from '../dataQueries'
import { errorText } from '../workspace/TaskPane'
import { useHost } from '../workspace/HostProvider'
import { queryInvokerFor } from './hostQuery'
import { PullRequestMarkdown } from './PullRequestMarkdown'

/** One action the person takes on a pull request, through the same server call an agent's card posts with. */
export function usePullRequestWrite(taskId: string, repoId: string, url: string, onDone: () => void) {
  const { invoke } = useHost()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const write = async (change: PullRequestWrite) => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.pullRequestWrite', taskId, repoId, url, change)
      onDone()
      return true
    } catch (e) {
      setError(errorText(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { write, busy, error }
}

/** A reaction picker for one comment, offering only what the service has. */
export function ReactionMenu({
  service,
  disabled,
  onReact,
}: {
  service: ForgeService
  disabled: boolean
  onReact: (reaction: PullRequestReaction) => void
}) {
  const reactions = PULL_REQUEST_REACTIONS[service]
  if (!reactions.length) return null
  return (
    <Menu
      label={t('Add a reaction')}
      icon={<SmilePlus size={13} aria-hidden="true" />}
      disabled={disabled}
      items={reactions.map((reaction) => ({
        key: reaction,
        label: REACTION_EMOJI[reaction],
        onSelect: () => onReact(reaction),
      }))}
    />
  )
}

/** The comments on the pull request itself, the person's own editable, and a box to add one. */
export function PullRequestConversation({
  taskId,
  repoId,
  url,
  service,
  open,
}: {
  taskId: string
  repoId: string
  url: string
  service: ForgeService
  open: boolean
}) {
  const host = useHost()
  const call = queryInvokerFor(host.id)
  const comments = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'forge.pullRequestConversation', taskId, repoId, url),
    queryFn: () => call('forge.pullRequestConversation', taskId, repoId, url),
  })
  const { refetch } = comments
  const { write, busy, error } = usePullRequestWrite(taskId, repoId, url, () => void refetch())
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)

  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-0 text-control font-semibold">{t('Comments')}</h3>
      {comments.isPending && <ContentSkeleton />}
      {comments.isError && <p className="m-0 text-caption text-bad">{errorText(comments.error)}</p>}
      {comments.data?.map((comment) => (
        <article key={comment.id} className="flex flex-col gap-1 rounded-(--radius-m) bg-fill p-3">
          <div className="flex items-center gap-1.5 text-control">
            <span className="font-medium">{comment.author ?? t('Someone')}</span>
            {comment.bot && (
              <span className="rounded-full bg-fill px-1.5 text-caption text-muted-foreground">{t('bot')}</span>
            )}
            <span className="ml-auto flex items-center gap-0.5">
              {supportsPullRequest(service, 'reactions') && (
                <ReactionMenu
                  service={service}
                  disabled={busy}
                  onReact={(reaction) => void write({ kind: 'react', commentId: comment.id, reaction, remove: false })}
                />
              )}
              {comment.own && supportsPullRequest(service, 'edit-comment') && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('Edit comment')}
                  title={t('Edit comment')}
                  disabled={busy}
                  onClick={() => setEditing({ id: comment.id, body: comment.body })}
                >
                  <Pencil size={13} />
                </Button>
              )}
              {comment.own && supportsPullRequest(service, 'delete-comment') && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t('Delete comment')}
                  title={t('Delete comment')}
                  disabled={busy}
                  onClick={() => void write({ kind: 'delete-comment', commentId: comment.id })}
                >
                  <Trash2 size={13} />
                </Button>
              )}
            </span>
          </div>
          {editing?.id === comment.id ? (
            <div className="flex flex-col gap-1.5">
              <Textarea
                value={editing.body}
                aria-label={t('Edit comment')}
                onChange={(event) => setEditing({ id: comment.id, body: event.target.value })}
                className="min-h-24"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>
                  {t('Cancel')}
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  disabled={busy || !editing.body.trim()}
                  onClick={() =>
                    void write({ kind: 'edit-comment', commentId: comment.id, body: editing.body }).then(
                      (done) => done && setEditing(null),
                    )
                  }
                >
                  {t('Save')}
                </Button>
              </div>
            </div>
          ) : (
            <PullRequestMarkdown>{comment.body}</PullRequestMarkdown>
          )}
        </article>
      ))}
      {open && (
        <div className="flex flex-col gap-1.5">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label={t('Comment on this pull request')}
            placeholder={t('Comment on this pull request. Markdown works.')}
            className="min-h-20"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="default"
              disabled={busy || !draft.trim()}
              onClick={() => void write({ kind: 'comment', body: draft }).then((done) => done && setDraft(''))}
            >
              {t('Comment')}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="m-0 whitespace-pre-wrap text-caption text-bad">{error}</p>}
    </section>
  )
}
