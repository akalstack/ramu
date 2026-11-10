import { useCallback, useEffect, useState } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { Pencil, SmilePlus, Trash2 } from 'lucide-react-native'
import type { ForgeService, PullRequestConversationComment, PullRequestWrite } from '@ramu/shared/types'
import { PULL_REQUEST_REACTIONS, supportsPullRequest } from '@ramu/shared/pullRequestSupport'
import { REACTION_EMOJI } from '@ramu/shared/pullRequestWriteText'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { PullRequestMarkdown } from './PullRequestMarkdown'
import { pullRequestCopy } from '../runtime/pullRequestCopy'
import { Button, Card, IconButton, Sheet, T } from './ui'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The longest comment the host accepts, so a field never holds more than can be sent. */
const COMMENT_MAX = 20_000

/** A comment's text field, as the new comment and an edit share it. */
export function CommentField(props: {
  value: string
  onChangeText: (text: string) => void
  label: string
  placeholder?: string
}) {
  const { c } = useTheme()
  return (
    <TextInput
      value={props.value}
      onChangeText={props.onChangeText}
      multiline
      maxLength={COMMENT_MAX}
      placeholder={props.placeholder}
      placeholderTextColor={c.placeholder}
      accessibilityLabel={props.label}
      style={{
        color: c.text,
        backgroundColor: c.fill,
        borderRadius: radius.s,
        paddingHorizontal: space.m,
        paddingVertical: space.s,
        fontSize: font.control,
        minHeight: 72,
        maxHeight: 240,
        textAlignVertical: 'top',
      }}
    />
  )
}

/** The person's own action on a pull request, through the same call an agent's card posts with. */
export function usePullRequestWrite(computerId: string, taskId: string, repoId: string, url: string) {
  const store = useStore()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const write = async (change: PullRequestWrite) => {
    setBusy(true)
    setError(null)
    try {
      await store.invoke(computerId, 'forge.pullRequestWrite', taskId, repoId, url, change)
      return true
    } catch (e) {
      setError(message(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { write, busy, error }
}

/**
 * A comment's reaction picker, as the desktop's "Add a reaction": one button that opens the reactions the service
 * offers; a service with a single reaction (Azure DevOps's like) shows just that one.
 */
export function ReactionRow({
  service,
  disabled,
  onReact,
}: {
  service: ForgeService
  disabled: boolean
  onReact: (reaction: (typeof PULL_REQUEST_REACTIONS)[ForgeService][number]) => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const [open, setOpen] = useState(false)
  if (!supportsPullRequest(service, 'reactions')) return null
  const reactions = PULL_REQUEST_REACTIONS[service]
  if (!reactions.length) return null
  const chip = (reaction: (typeof reactions)[number]) => (
    <Pressable
      key={reaction}
      accessibilityRole="button"
      accessibilityLabel={say('React {0}', { '0': REACTION_EMOJI[reaction] })}
      disabled={disabled}
      onPress={() => {
        setOpen(false)
        onReact(reaction)
      }}
      style={({ pressed }) => ({
        minWidth: 36,
        minHeight: 32,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.full,
        backgroundColor: pressed ? c.pressed : c.fill,
        opacity: disabled ? 0.45 : 1,
      })}
    >
      <T size={font.control}>{REACTION_EMOJI[reaction]}</T>
    </Pressable>
  )
  if (reactions.length === 1) return <View style={{ flexDirection: 'row' }}>{chip(reactions[0]!)}</View>
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.xs }}>
      <IconButton
        icon={SmilePlus}
        label={say('Add a reaction')}
        tone={open ? 'accent' : 'muted'}
        size={32}
        disabled={disabled}
        onPress={() => setOpen((value) => !value)}
      />
      {open ? reactions.map(chip) : null}
    </View>
  )
}

/** Comments on the pull request itself, the person's own deletable, with a box to add one. */
export function PullRequestComments({
  computerId,
  taskId,
  repoId,
  url,
  service,
  canWrite,
  open,
  revision,
}: {
  computerId: string
  taskId: string
  repoId: string
  url: string
  service: ForgeService
  canWrite: boolean
  open: boolean
  /** Changes when the screen reads the pull request again, so the comments follow. */
  revision: number
}) {
  const say = useSay()
  const store = useStore()
  // What this phone last read, shown while the comments are read again.
  const [comments, setComments] = useState<PullRequestConversationComment[] | null>(
    () => pullRequestCopy.read(computerId, 'forge.pullRequestConversation', taskId, repoId, url) ?? null,
  )
  const [readError, setReadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null)
  const { write, busy, error } = usePullRequestWrite(computerId, taskId, repoId, url)
  const read = useCallback(
    () =>
      store.invoke(computerId, 'forge.pullRequestConversation', taskId, repoId, url).then(
        (list) => {
          pullRequestCopy.keep(computerId, 'forge.pullRequestConversation', list, taskId, repoId, url)
          setComments(list)
          setReadError(null)
        },
        (e: unknown) => setReadError(message(e)),
      ),
    [store, computerId, taskId, repoId, url],
  )
  useEffect(() => {
    void read()
  }, [read, revision])
  const act = (change: PullRequestWrite) => write(change).then((done) => (done ? read().then(() => true) : false))

  return (
    <View style={{ gap: space.s }}>
      <T size={font.control} weight="600" tone="muted">
        {say('Comments')}
      </T>
      {readError ? (
        <T size={font.caption} tone="bad">
          {readError}
        </T>
      ) : comments === null ? (
        <T tone="muted">{say('Loading…')}</T>
      ) : null}
      {comments?.map((comment) => (
        <Card key={comment.id} style={{ padding: space.m, gap: space.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
            <T size={font.control} weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
              {comment.author ?? say('Someone')}
            </T>
            {comment.bot ? (
              <T size={font.caption} tone="muted">
                {say('bot')}
              </T>
            ) : null}
            <View style={{ flex: 1 }} />
            {canWrite && comment.own && supportsPullRequest(service, 'edit-comment') ? (
              <IconButton
                icon={Pencil}
                label={say('Edit comment')}
                tone="muted"
                size={36}
                disabled={busy}
                onPress={() => setEditing({ id: comment.id, body: comment.body })}
              />
            ) : null}
            {canWrite && comment.own && supportsPullRequest(service, 'delete-comment') ? (
              <IconButton
                icon={Trash2}
                label={say('Delete comment')}
                tone="muted"
                size={36}
                disabled={busy}
                onPress={() => void act({ kind: 'delete-comment', commentId: comment.id })}
              />
            ) : null}
          </View>
          {editing?.id === comment.id ? (
            <View style={{ gap: space.s }}>
              <CommentField
                value={editing.body}
                onChangeText={(body) => setEditing({ id: comment.id, body })}
                label={say('Edit comment')}
              />
              <View style={{ flexDirection: 'row', gap: space.s }}>
                <Button
                  kind="secondary"
                  title={say('Cancel')}
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() => setEditing(null)}
                />
                <Button
                  title={say('Save')}
                  disabled={busy || !editing.body.trim()}
                  style={{ flex: 1 }}
                  onPress={() =>
                    void act({ kind: 'edit-comment', commentId: comment.id, body: editing.body }).then(
                      (done) => done && setEditing(null),
                    )
                  }
                />
              </View>
            </View>
          ) : (
            <PullRequestMarkdown text={comment.body} />
          )}
          {canWrite ? (
            <ReactionRow
              service={service}
              disabled={busy}
              onReact={(reaction) => void act({ kind: 'react', commentId: comment.id, reaction, remove: false })}
            />
          ) : null}
        </Card>
      ))}
      {canWrite && open ? (
        <View style={{ gap: space.s }}>
          <CommentField
            value={draft}
            onChangeText={setDraft}
            label={say('Comment on this pull request')}
            placeholder={say('Comment on this pull request. Markdown works.')}
          />
          <Button
            title={say('Comment')}
            disabled={busy || !draft.trim()}
            onPress={() => void act({ kind: 'comment', body: draft }).then((done) => done && setDraft(''))}
          />
        </View>
      ) : null}
      {error ? (
        <T size={font.caption} tone="bad" accessibilityRole="alert">
          {error}
        </T>
      ) : null}
    </View>
  )
}

const PEOPLE_TITLE = { reviewers: 'Reviewers', labels: 'Labels', assignees: 'Assignees' } as const

/** Reviewers, labels or assignees as one comma-separated list; saving sends only what changed. */
export function PeopleSheet({
  kind,
  current,
  busy,
  error,
  onSave,
  onClose,
}: {
  kind: 'reviewers' | 'labels' | 'assignees'
  current: string[]
  busy: boolean
  error: string | null
  onSave: (add: string[], remove: string[]) => void
  onClose: () => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const [value, setValue] = useState(current.join(', '))
  const next = [
    ...new Set(
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ]
  const add = next.filter((entry) => !current.includes(entry))
  const remove = current.filter((entry) => !next.includes(entry))
  return (
    <Sheet open onClose={() => !busy && onClose()} title={say(PEOPLE_TITLE[kind])}>
      <View style={{ paddingHorizontal: space.l, gap: space.s }}>
        <TextInput
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={say(kind === 'labels' ? 'Labels, separated by commas' : 'Logins, separated by commas')}
          placeholderTextColor={c.placeholder}
          accessibilityLabel={say(PEOPLE_TITLE[kind])}
          style={{
            color: c.text,
            backgroundColor: c.fill,
            borderRadius: radius.s,
            paddingHorizontal: space.m,
            minHeight: 44,
            fontSize: font.control,
          }}
        />
        {error ? (
          <T size={font.control} tone="bad">
            {error}
          </T>
        ) : null}
        <Button
          title={say('Save')}
          disabled={busy || (!add.length && !remove.length)}
          onPress={() => onSave(add, remove)}
        />
      </View>
    </Sheet>
  )
}
