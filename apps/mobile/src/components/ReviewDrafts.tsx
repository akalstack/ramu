import { useState } from 'react'
import { TextInput, View } from 'react-native'
import { Send, Trash2, Upload } from 'lucide-react-native'
import type {
  PullRequestDraftBatch,
  ReviewDraftBatch,
  ReviewReplyBatch,
  ReviewReplyOutcome,
  ReviewVerdict,
} from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Button, Card, Divider, IconButton, Segmented, T, Toggle } from './ui'

const OUTCOMES: { key: ReviewReplyOutcome; label: string }[] = [
  { key: 'fixed', label: 'Fixed' },
  { key: 'no-change', label: 'No change' },
  { key: 'question', label: 'Question' },
  { key: 'skipped', label: 'Skip' },
]

const VERDICTS: { key: ReviewVerdict; label: string }[] = [
  { key: 'comment', label: 'Comment' },
  { key: 'approve', label: 'Approve' },
  { key: 'request-changes', label: 'Request changes' },
]

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** What the agent drafted for a pull request, to check, edit and send in one action. `readOnly` shows it without sending. */
export function ReviewDrafts({
  computerId,
  batch,
  readOnly,
  onDone,
}: {
  computerId: string
  batch: PullRequestDraftBatch
  readOnly: boolean
  onDone: () => void
}) {
  return batch.kind === 'replies' ? (
    <Replies computerId={computerId} batch={batch} readOnly={readOnly} onDone={onDone} />
  ) : (
    <Review computerId={computerId} batch={batch} readOnly={readOnly} onDone={onDone} />
  )
}

function useField(multiline = true) {
  const { c } = useTheme()
  return {
    color: c.text,
    backgroundColor: c.fill,
    borderRadius: radius.s,
    paddingHorizontal: space.m,
    paddingVertical: space.s,
    fontSize: font.control,
    minHeight: multiline ? 64 : 40,
    textAlignVertical: 'top' as const,
  }
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (on: boolean) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, minHeight: 40 }}>
      <T size={font.control} style={{ flex: 1 }}>
        {label}
      </T>
      <Toggle value={value} onValueChange={onChange} accessibilityLabel={label} />
    </View>
  )
}

function Replies({
  computerId,
  batch,
  readOnly,
  onDone,
}: {
  computerId: string
  batch: ReviewReplyBatch
  readOnly: boolean
  onDone: () => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const field = useField()
  const [edits, setEdits] = useState<Record<string, { outcome: ReviewReplyOutcome; reply: string }>>({})
  const [push, setPush] = useState(true)
  const [resolveFixed, setResolveFixed] = useState(false)
  const [requestReview, setRequestReview] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const drafts = batch.drafts.filter((draft) => !draft.postedId)
  const value = (threadId: string) => {
    const draft = batch.drafts.find((entry) => entry.threadId === threadId)!
    return edits[threadId] ?? { outcome: draft.outcome, reply: draft.reply }
  }
  const sending = drafts.filter((draft) => {
    const current = value(draft.threadId)
    return current.outcome !== 'skipped' && current.reply.trim()
  })
  const waiting = batch.threads.filter((thread) => !batch.drafts.some((draft) => draft.threadId === thread.id)).length

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await store.invoke(computerId, 'forge.sendReplies', batch.id, {
        push,
        resolveFixed,
        requestReview,
        edits: Object.entries(edits).map(([threadId, edit]) => ({ threadId, ...edit })),
      })
      if (result.failed.length) setError(result.failed.map((entry) => entry.error).join('\n'))
      else {
        setNotice(say('{0} replies posted.', { 0: result.posted }))
        onDone()
      }
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const discard = () =>
    void store
      .invoke(computerId, 'forge.discardDrafts', batch.id)
      .then(onDone)
      .catch((e: unknown) => setError(message(e)))

  return (
    <Card style={{ padding: space.l, gap: space.m }}>
      <View style={{ gap: 2 }}>
        <T weight="600">{say('Review replies')}</T>
        <T size={font.caption} tone="muted">
          {waiting
            ? say('{0} drafted · the agent is still on {1}', { 0: drafts.length, 1: waiting })
            : say('{0} drafted', { 0: drafts.length })}
        </T>
      </View>
      {drafts.map((draft) => {
        const thread = batch.threads.find((entry) => entry.id === draft.threadId)
        const current = value(draft.threadId)
        const last = thread?.comments.at(-1)
        return (
          <View key={draft.threadId} style={{ gap: space.s }}>
            <Divider />
            <T size={font.caption} tone="muted" mono numberOfLines={1}>
              {thread?.path ? `${thread.path}${thread.line ? `:${thread.line}` : ''}` : say('Conversation')}
            </T>
            {last ? (
              <View style={{ borderLeftWidth: 2, borderLeftColor: c.lineStrong, paddingLeft: space.s }}>
                <T size={font.caption} tone="soft" numberOfLines={6}>
                  <T size={font.caption} tone="muted">{`${last.author ?? say('Reviewer')}: `}</T>
                  {last.body.slice(0, 600)}
                </T>
              </View>
            ) : null}
            <Segmented
              small
              value={current.outcome}
              onChange={(outcome) => !readOnly && setEdits({ ...edits, [draft.threadId]: { ...current, outcome } })}
              options={OUTCOMES.map((option) => ({ key: option.key, label: say(option.label) }))}
            />
            <TextInput
              value={current.reply}
              onChangeText={(reply) => setEdits({ ...edits, [draft.threadId]: { ...current, reply } })}
              multiline
              maxLength={8_000}
              editable={!readOnly && current.outcome !== 'skipped'}
              accessibilityLabel={say('Reply')}
              placeholderTextColor={c.placeholder}
              style={[field, { opacity: current.outcome === 'skipped' ? 0.5 : 1 }]}
            />
            {draft.outcome === 'fixed' && draft.commit ? (
              <T size={font.caption} tone="muted">
                {say('Fixed in {0}', { 0: draft.commit.slice(0, 7) })}
              </T>
            ) : null}
            {draft.error ? (
              <T size={font.caption} tone="bad">
                {draft.error}
              </T>
            ) : null}
          </View>
        )
      })}
      {readOnly ? null : (
        <>
          <Divider />
          <View>
            <ToggleRow label={say('Push first')} value={push} onChange={setPush} />
            <ToggleRow
              label={
                batch.reviewers.length
                  ? say('Ask {0} to review again', { 0: batch.reviewers.join(', ') })
                  : say('Ask reviewers to review again')
              }
              value={requestReview}
              onChange={setRequestReview}
            />
            <ToggleRow label={say('Resolve fixed threads')} value={resolveFixed} onChange={setResolveFixed} />
          </View>
        </>
      )}
      {error ? (
        <T size={font.caption} tone="bad" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : null}
      {notice ? (
        <T size={font.caption} tone="ok" accessibilityLiveRegion="polite">
          {notice}
        </T>
      ) : null}
      {readOnly ? null : (
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
          <Button
            icon={push ? Upload : Send}
            title={busy ? say('Sending…') : push ? say('Push and reply') : say('Reply')}
            disabled={busy || !sending.length}
            onPress={() => void send()}
            style={{ flex: 1 }}
          />
          <IconButton icon={Trash2} label={say('Discard')} tone="muted" size={44} disabled={busy} onPress={discard} />
        </View>
      )}
    </Card>
  )
}

function Review({
  computerId,
  batch,
  readOnly,
  onDone,
}: {
  computerId: string
  batch: ReviewDraftBatch
  readOnly: boolean
  onDone: () => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const field = useField()
  const [verdict, setVerdict] = useState<ReviewVerdict>(batch.verdict)
  const [body, setBody] = useState(batch.body)
  const [comments, setComments] = useState(batch.comments)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const empty = !batch.body && !batch.comments.length

  const post = async () => {
    setBusy(true)
    setError(null)
    try {
      await store.invoke(computerId, 'forge.sendReview', batch.id, {
        verdict,
        body,
        comments: comments.map(({ path, line, body: text }) => ({ path, line, body: text })),
      })
      onDone()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const discard = () =>
    void store
      .invoke(computerId, 'forge.discardDrafts', batch.id)
      .then(onDone)
      .catch((e: unknown) => setError(message(e)))

  return (
    <Card style={{ padding: space.l, gap: space.m }}>
      <View style={{ gap: 2 }}>
        <T weight="600">{say('Drafted review')}</T>
        {empty ? (
          <T size={font.caption} tone="muted">
            {say('The agent is reviewing…')}
          </T>
        ) : null}
      </View>
      {empty ? null : (
        <>
          <Segmented
            small
            value={verdict}
            onChange={(next) => !readOnly && setVerdict(next)}
            options={VERDICTS.map((option) => ({ key: option.key, label: say(option.label) }))}
          />
          <TextInput
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={20_000}
            editable={!readOnly}
            accessibilityLabel={say('Summary')}
            placeholderTextColor={c.placeholder}
            style={[field, { minHeight: 88 }]}
          />
          {comments.map((comment) => (
            <View key={comment.id} style={{ gap: space.s }}>
              <Divider />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                <T size={font.caption} tone="muted" mono numberOfLines={1} style={{ flex: 1 }}>
                  {`${comment.path}:${comment.line}`}
                </T>
                {readOnly ? null : (
                  <IconButton
                    icon={Trash2}
                    label={say('Remove comment')}
                    tone="muted"
                    size={32}
                    onPress={() => setComments(comments.filter((entry) => entry.id !== comment.id))}
                  />
                )}
              </View>
              <TextInput
                value={comment.body}
                onChangeText={(text) =>
                  setComments(comments.map((entry) => (entry.id === comment.id ? { ...entry, body: text } : entry)))
                }
                multiline
                maxLength={8_000}
                editable={!readOnly}
                accessibilityLabel={say('Comment')}
                placeholderTextColor={c.placeholder}
                style={field}
              />
            </View>
          ))}
        </>
      )}
      {error ? (
        <T size={font.caption} tone="bad" accessibilityLiveRegion="polite">
          {error}
        </T>
      ) : null}
      {readOnly ? null : (
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
          <Button
            icon={Send}
            title={busy ? say('Posting…') : say('Post review')}
            disabled={busy || empty || (!body.trim() && !comments.length)}
            onPress={() => void post()}
            style={{ flex: 1 }}
          />
          <IconButton icon={Trash2} label={say('Discard')} tone="muted" size={44} disabled={busy} onPress={discard} />
        </View>
      )}
    </Card>
  )
}
