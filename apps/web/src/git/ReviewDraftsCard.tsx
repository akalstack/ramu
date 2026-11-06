import { useState } from 'react'
import { Send, Trash2, Upload } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import type {
  PullRequestDraftBatch,
  ReviewDraftBatch,
  ReviewReplyBatch,
  ReviewReplyOutcome,
  ReviewVerdict,
} from '@ramu/shared/types'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { errorText } from '../workspace/TaskPane'
import { useHost } from '../workspace/HostProvider'

const OUTCOMES: { value: ReviewReplyOutcome; label: string }[] = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'no-change', label: 'No change' },
  { value: 'question', label: 'Question' },
  { value: 'skipped', label: 'Skip' },
]

const VERDICTS: { value: ReviewVerdict; label: string }[] = [
  { value: 'comment', label: 'Comment' },
  { value: 'approve', label: 'Approve' },
  { value: 'request-changes', label: 'Request changes' },
]

/** What the agent drafted for a pull request, to check, edit and send in one action. */
export function ReviewDraftsCard({ batch, onDone }: { batch: PullRequestDraftBatch; onDone: () => void }) {
  return batch.kind === 'replies' ? (
    <RepliesCard batch={batch} onDone={onDone} />
  ) : (
    <ReviewCard batch={batch} onDone={onDone} />
  )
}

const CARD = 'flex flex-col gap-2 rounded-(--radius-s) border border-line bg-fill p-3'

function RepliesCard({ batch, onDone }: { batch: ReviewReplyBatch; onDone: () => void }) {
  const { invoke } = useHost()
  const [edits, setEdits] = useState<Record<string, { outcome: ReviewReplyOutcome; reply: string }>>({})
  const [push, setPush] = useState(true)
  const [resolveFixed, setResolveFixed] = useState(false)
  const [requestReview, setRequestReview] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const drafts = batch.drafts.filter((draft) => !draft.postedId)
  /** Saves one thread's edit on the host, then shows the host's copy again so the agent's later revisions appear. */
  const persist = (threadId: string, edit: { outcome: ReviewReplyOutcome; reply: string }) =>
    void invoke('forge.editDrafts', batch.id, { kind: 'replies', edits: [{ threadId, ...edit }] }).then(
      () =>
        setEdits((current) => {
          const { [threadId]: _saved, ...rest } = current
          return rest
        }),
      (e: unknown) => setError(errorText(e)),
    )
  const value = (threadId: string) => {
    const draft = batch.drafts.find((entry) => entry.threadId === threadId)!
    return edits[threadId] ?? { outcome: draft.outcome, reply: draft.reply }
  }
  const sending = drafts.filter(
    (draft) => value(draft.threadId).outcome !== 'skipped' && value(draft.threadId).reply.trim(),
  )
  const waiting = batch.threads.filter((thread) => !batch.drafts.some((draft) => draft.threadId === thread.id)).length

  const send = async (withPush: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const result = await invoke('forge.sendReplies', batch.id, {
        push: withPush,
        resolveFixed,
        requestReview,
        edits: Object.entries(edits).map(([threadId, edit]) => ({ threadId, ...edit })),
      })
      if (result.failed.length) setError(result.failed.map((entry) => entry.error).join('\n'))
      else {
        setNotice(t('{0} replies posted.', { '0': String(result.posted) }))
        onDone()
      }
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={CARD} aria-label={t('Review replies')}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-control font-semibold">{t('Review replies')}</h3>
        <span className="text-caption text-muted-foreground">
          {waiting
            ? t('{0} drafted · the agent is still on {1}', { '0': String(drafts.length), '1': String(waiting) })
            : t('{0} drafted', { '0': String(drafts.length) })}
        </span>
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Edit here, or ask in the thread to change a reply. The agent sees your edits.')}
      </p>
      {drafts.map((draft) => {
        const thread = batch.threads.find((entry) => entry.id === draft.threadId)
        const current = value(draft.threadId)
        const last = thread?.comments.at(-1)
        return (
          <div key={draft.threadId} className="flex flex-col gap-1.5 border-t border-line pt-2">
            <div className="text-caption text-muted-foreground">
              {thread?.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : t('Conversation')}
            </div>
            {last && (
              <blockquote className="m-0 border-l-2 border-line pl-2 text-caption text-soft [overflow-wrap:anywhere] whitespace-pre-wrap">
                <span className="text-muted-foreground">{last.author ?? t('Reviewer')}: </span>
                {last.body.slice(0, 600)}
              </blockquote>
            )}
            <div className="flex items-start gap-2">
              <Dropdown
                label={t('Outcome')}
                value={current.outcome}
                options={OUTCOMES.map((option) => ({ value: option.value, label: t(option.label) }))}
                onChange={(outcome) => persist(draft.threadId, { ...current, outcome: outcome as ReviewReplyOutcome })}
                className="w-32 flex-none"
              />
              <Textarea
                rows={2}
                value={current.reply}
                maxLength={8_000}
                aria-label={t('Reply')}
                disabled={current.outcome === 'skipped'}
                onChange={(event) =>
                  setEdits({ ...edits, [draft.threadId]: { ...current, reply: event.target.value } })
                }
                onBlur={() => {
                  if (edits[draft.threadId]) persist(draft.threadId, edits[draft.threadId]!)
                }}
                className="min-h-14 flex-1 resize-y text-control"
              />
            </div>
            {draft.outcome === 'fixed' && draft.commit && (
              <div className="text-caption text-muted-foreground">
                {t('Fixed in {0}', { '0': draft.commit.slice(0, 7) })}
              </div>
            )}
            {draft.error && <div className="text-caption text-bad">{draft.error}</div>}
          </div>
        )
      })}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-caption">
        <label className="flex items-center gap-1.5">
          <Checkbox checked={push} onCheckedChange={(checked) => setPush(checked === true)} />
          {t('Push first')}
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={requestReview} onCheckedChange={(checked) => setRequestReview(checked === true)} />
          {batch.reviewers.length
            ? t('Ask {0} to review again', { '0': batch.reviewers.join(', ') })
            : t('Ask reviewers to review again')}
        </label>
        <label className="flex items-center gap-1.5">
          <Checkbox checked={resolveFixed} onCheckedChange={(checked) => setResolveFixed(checked === true)} />
          {t('Resolve fixed threads')}
        </label>
      </div>
      {error && <p className="m-0 whitespace-pre-wrap text-caption text-bad">{error}</p>}
      {notice && <p className="m-0 text-caption text-ok">{notice}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy || !sending.length} onClick={() => void send(push)}>
          {push ? <Upload size={13} /> : <Send size={13} />}
          {busy ? t('Sending…') : push ? t('Push and reply') : t('Reply')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void invoke('forge.discardDrafts', batch.id)
              .then(onDone)
              .catch((e: unknown) => setError(errorText(e)))
          }
        >
          <Trash2 size={13} />
          {t('Discard')}
        </Button>
      </div>
    </section>
  )
}

function ReviewCard({ batch, onDone }: { batch: ReviewDraftBatch; onDone: () => void }) {
  const { invoke } = useHost()
  // Unsaved typing only; everything else is the host's copy, which the agent may revise while the card is open.
  const [typedBody, setTypedBody] = useState<string | null>(null)
  const [typed, setTyped] = useState<Record<string, string>>({})
  const verdict = batch.verdict
  const body = typedBody ?? batch.body
  const comments = batch.comments.map((comment) => ({ ...comment, body: typed[comment.id] ?? comment.body }))
  const save = (change: { verdict?: ReviewVerdict; body?: string; comments?: { id: string; body: string }[] }) =>
    void invoke('forge.editDrafts', batch.id, {
      kind: 'review',
      verdict: change.verdict ?? verdict,
      body: change.body ?? body,
      comments: change.comments ?? comments.map(({ id, body: text }) => ({ id, body: text })),
    }).then(
      () => {
        setTypedBody(null)
        setTyped({})
      },
      (e: unknown) => setError(errorText(e)),
    )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empty = !batch.body && !batch.comments.length

  const post = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.sendReview', batch.id, {
        verdict,
        body,
        comments: comments.map(({ path, line, body: text }) => ({ path, line, body: text })),
      })
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={CARD} aria-label={t('Drafted review')}>
      <div className="flex items-center gap-2">
        <h3 className="m-0 text-control font-semibold">{t('Drafted review')}</h3>
        {empty && <span className="text-caption text-muted-foreground">{t('The agent is reviewing…')}</span>}
      </div>
      {!empty && (
        <>
          <Dropdown
            label={t('Verdict')}
            value={verdict}
            options={VERDICTS.map((option) => ({ value: option.value, label: t(option.label) }))}
            onChange={(value) => save({ verdict: value as ReviewVerdict })}
            className="w-44"
          />
          <Textarea
            rows={3}
            value={body}
            maxLength={20_000}
            aria-label={t('Summary')}
            onChange={(event) => setTypedBody(event.target.value)}
            onBlur={() => {
              if (typedBody !== null) save({ body: typedBody })
            }}
            className="resize-y text-control"
          />
          {comments.map((comment) => (
            <div key={comment.id} className="flex flex-col gap-1 border-t border-line pt-2">
              <div className="flex items-center gap-2 text-caption text-muted-foreground">
                <span className="min-w-0 truncate">
                  {comment.path}:{comment.line}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ml-auto"
                  aria-label={t('Remove comment')}
                  onClick={() =>
                    save({
                      comments: comments
                        .filter((entry) => entry.id !== comment.id)
                        .map(({ id, body: text }) => ({ id, body: text })),
                    })
                  }
                >
                  <Trash2 size={12} />
                </Button>
              </div>
              <Textarea
                rows={2}
                value={comment.body}
                maxLength={8_000}
                aria-label={t('Comment')}
                onChange={(event) => setTyped({ ...typed, [comment.id]: event.target.value })}
                onBlur={() => {
                  if (typed[comment.id] !== undefined) save({})
                }}
                className="resize-y text-control"
              />
            </div>
          ))}
        </>
      )}
      {error && <p className="m-0 whitespace-pre-wrap text-caption text-bad">{error}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" disabled={busy || empty || (!body.trim() && !comments.length)} onClick={() => void post()}>
          <Send size={13} />
          {busy ? t('Posting…') : t('Post review')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() =>
            void invoke('forge.discardDrafts', batch.id)
              .then(onDone)
              .catch((e: unknown) => setError(errorText(e)))
          }
        >
          <Trash2 size={13} />
          {t('Discard')}
        </Button>
      </div>
    </section>
  )
}
