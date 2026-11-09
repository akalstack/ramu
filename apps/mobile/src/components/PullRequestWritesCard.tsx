import { useCallback, useEffect, useRef, useState } from 'react'
import { Linking, Pressable, TextInput, View } from 'react-native'
import { GitPullRequest, Undo2 } from 'lucide-react-native'
import type { PullRequestWriteCard, PullRequestWriteItem } from '@ramu/shared/types'
import { FORGE_NAMES } from '@ramu/shared/pullRequests'
import {
  editableWrite,
  pullRequestWriteBody,
  pullRequestWriteDetail,
  pullRequestWriteTitle,
} from '@ramu/shared/pullRequestWriteText'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { Markdown } from './Markdown'
import { Button, Card, Divider, T } from './ui'

const STATE_LABEL = {
  waiting: 'Waiting for you',
  posted: 'Posted',
  failed: 'Failed',
  dismissed: 'Dismissed',
  undone: 'Undone',
} as const

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The pull request writes an agent asked for in one turn, to post, edit, dismiss or undo from the phone. */
export function PullRequestWritesCard({ computerId, cardId }: { computerId: string; cardId: string }) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [card, setCard] = useState<PullRequestWriteCard | null | undefined>(undefined)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = useCallback(
    () =>
      store
        .invoke(computerId, 'forge.writeCard', cardId)
        .then(setCard)
        .catch(() => setCard(null)),
    [store, computerId, cardId],
  )
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    void read()
    // The card changes as writes post, on this phone or elsewhere; the host announces it with the thread lists.
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (channel !== 'workspace:changed') return
      clearTimeout(timer)
      timer = setTimeout(() => void readRef.current(), 400)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [read, store, computerId])

  if (card === undefined) return null
  if (card === null)
    return (
      <T size={font.caption} tone="muted" style={{ marginVertical: space.s }}>
        {say('This pull request card is gone.')}
      </T>
    )

  const run = async (work: () => Promise<PullRequestWriteCard>) => {
    setBusy(true)
    setError(null)
    try {
      setCard(await work())
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
    }
  }
  const post = (ids: string[]) =>
    run(async () => {
      const next = await store.invoke(
        computerId,
        'forge.postWrites',
        card.id,
        ids,
        Object.entries(edits)
          .filter(([itemId]) => ids.includes(itemId))
          .map(([itemId, body]) => ({ itemId, body })),
      )
      setEdits({})
      setEditing(null)
      return next
    })
  const waiting = card.items.filter((item) => item.state === 'waiting' || item.state === 'failed')

  return (
    <Card style={{ marginVertical: space.s, padding: space.m, gap: space.s }}>
      <Pressable
        accessibilityRole="link"
        onPress={() => void Linking.openURL(card.url)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
      >
        <GitPullRequest size={16} color={c.text} />
        <T weight="600" numberOfLines={1} style={{ flex: 1 }}>
          #{card.number} {card.title}
        </T>
      </Pressable>
      <T size={font.caption} tone="muted">
        {card.account
          ? say('Posts on {0} as {1}', { '0': FORGE_NAMES[card.service], '1': card.account })
          : say('Posts on {0}', { '0': FORGE_NAMES[card.service] })}
      </T>
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
          onDismiss={() => void run(() => store.invoke(computerId, 'forge.dismissWrites', card.id, [item.id]))}
          onUndo={() => void run(() => store.invoke(computerId, 'forge.undoWrite', card.id, item.id))}
        />
      ))}
      {error ? (
        <T size={font.caption} tone="bad" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
      {waiting.length > 1 ? (
        <>
          <Divider />
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Button
              title={say('Dismiss all')}
              kind="ghost"
              disabled={busy}
              onPress={() => void run(() => store.invoke(computerId, 'forge.dismissWrites', card.id))}
            />
            <Button
              title={say('Post all')}
              disabled={busy}
              style={{ flex: 1 }}
              onPress={() => void post(waiting.map((item) => item.id))}
            />
          </View>
        </>
      ) : null}
    </Card>
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
  const say = useSay()
  const { c } = useTheme()
  const title = pullRequestWriteTitle(item.write)
  const body = text ?? pullRequestWriteBody(item.write)
  const detail = pullRequestWriteDetail(item.write)
  const open = item.state === 'waiting' || item.state === 'failed'
  const lineComments = item.write.kind === 'review' ? item.write.comments : []
  return (
    <View style={{ gap: space.s }}>
      <Divider />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, flexWrap: 'wrap' }}>
        <T weight="600">{say(title.text, title.values)}</T>
        {detail ? (
          <T size={font.caption} tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {detail}
          </T>
        ) : null}
        <T
          size={font.caption}
          tone={item.state === 'failed' ? 'bad' : item.state === 'posted' ? 'ok' : 'muted'}
          style={{ marginLeft: 'auto' }}
        >
          {item.state === 'waiting' && item.decision ? say('Needs your decision') : say(STATE_LABEL[item.state])}
        </T>
      </View>
      {editing && open && body !== null ? (
        <TextInput
          value={body}
          onChangeText={onText}
          multiline
          accessibilityLabel={say('Text to post')}
          style={{
            color: c.text,
            backgroundColor: c.fill,
            borderRadius: radius.s,
            paddingHorizontal: space.m,
            paddingVertical: space.s,
            fontSize: font.control,
            minHeight: 96,
            textAlignVertical: 'top',
          }}
        />
      ) : body ? (
        <Markdown text={body} />
      ) : null}
      {lineComments.map((comment) => (
        <View key={comment.id} style={{ borderLeftWidth: 2, borderLeftColor: c.line, paddingLeft: space.s }}>
          <T size={font.caption} tone="muted">
            {comment.path}:{comment.line}
          </T>
          <Markdown text={pullRequestWriteBody({ kind: 'line-comment', comment }) ?? ''} />
        </View>
      ))}
      {item.error ? (
        <T size={font.caption} tone="bad" accessibilityRole="alert">
          {item.error}
        </T>
      ) : null}
      {open ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button title={say('Dismiss')} kind="ghost" disabled={busy} onPress={onDismiss} />
          {editableWrite(item) && !editing ? (
            <Button title={say('Edit')} kind="secondary" disabled={busy} onPress={onEdit} />
          ) : null}
          <Button
            title={item.state === 'failed' ? say('Try again') : say('Post')}
            disabled={busy}
            style={{ flex: 1 }}
            onPress={onPost}
          />
        </View>
      ) : item.state === 'posted' && item.undoable ? (
        <Button title={say('Undo')} icon={Undo2} kind="secondary" disabled={busy} onPress={onUndo} />
      ) : null}
    </View>
  )
}
