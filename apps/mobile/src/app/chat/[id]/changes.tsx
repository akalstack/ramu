import { translate } from '@ramu/shared/i18n'
import { useEffect, useState } from 'react'
import { Alert, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import { ChevronDown, ChevronRight, MessageSquarePlus, Undo2, X } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { type ChangedFile } from '../../../runtime/types'
import type { ChangeReview, ReviewComment } from '@ramu/shared/types'
import { changedFile } from '../../../runtime/diff'
import { GlassButton, Header, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { BottomFade, floatingChrome } from '../../../components/Glass'
import { Button, Card, Divider, Pill, Sheet, T, tap } from '../../../components/ui'
import { SheetGroup, SheetOption, useSheetInputStyle } from '../../../components/SheetOptions'
import { useOpenFile } from '../../../runtime/openFile'
import { DiffLines } from '../../../components/DiffLines'
import { useSay } from '../../../i18n'

function FileDiff({
  file,
  open,
  onToggle,
  onOpenFile,
  comments = [],
  onLine,
  onRemove,
}: {
  file: ChangedFile
  open: boolean
  onToggle: () => void
  onOpenFile?: () => void
  comments?: ReviewComment[]
  onLine?: (line: import('../../../runtime/types').DiffLine) => void
  onRemove?: (id: string) => void
}) {
  const say = useSay()
  const { c } = useTheme()
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
  const name = file.path.slice(dir.length)
  const badge = {
    modified: ['M', 'warn', c.warnWash],
    added: ['A', 'ok', c.okWash],
    deleted: ['D', 'bad', c.badWash],
  } as const
  const [letter, tone, wash] = badge[file.status]
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          tap()
          onToggle()
        }}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.s,
          padding: space.m,
          backgroundColor: pressed ? c.pressed : 'transparent',
        })}
      >
        {open ? <ChevronDown size={15} color={c.muted} /> : <ChevronRight size={15} color={c.muted} />}
        <Pill tone={tone} wash={wash}>
          {letter}
        </Pill>
        <View style={{ flex: 1 }}>
          <T size={font.body - 1} weight="500" numberOfLines={1}>
            {name}
          </T>
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {file.repo} · {dir}
          </T>
        </View>
        <T size={font.caption + 1} mono tone="ok">
          +{file.additions}
        </T>
        <T size={font.caption + 1} mono tone="bad">
          −{file.deletions}
        </T>
      </Pressable>
      {open ? (
        <>
          <Divider />
          {onOpenFile ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                tap()
                onOpenFile()
              }}
              style={{ paddingHorizontal: space.m, paddingVertical: space.s }}
            >
              <T size={font.caption} weight="600" tone="accent">
                Open file
              </T>
            </Pressable>
          ) : null}
          <DiffLines
            file={file}
            onLine={onLine}
            marked={new Set(comments.filter((x) => x.scope !== 'file').map((x) => `${x.side}:${x.line}`))}
          />
          {comments.map((x) => (
            <View
              key={x.id}
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                gap: space.s,
                padding: space.m,
                borderTopWidth: 0.5,
                borderTopColor: c.line,
              }}
            >
              <MessageSquarePlus size={14} color={x.state === 'draft' ? c.warn : c.muted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <T size={font.caption} tone="muted">
                  {x.scope === 'file' ? 'File' : `Line ${x.line}`} ·{' '}
                  {x.state === 'sent' ? 'sent' : x.state === 'resolved' ? 'resolved' : 'draft'}
                </T>
                <T size={font.control}>{x.text}</T>
              </View>
              {x.state === 'draft' && onRemove ? (
                <Pressable accessibilityLabel={say('Remove comment')} hitSlop={8} onPress={() => onRemove(x.id)}>
                  <X size={15} color={c.muted} />
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
    </Card>
  )
}

export default function Changes() {
  const say = useSay()
  const commentStyle = useSheetInputStyle(true)
  const { c } = useTheme()
  // A transcript Changes card names its review, and a file row in it the file to open first.
  const {
    id,
    review: initialReview,
    file: initialFile,
  } = useLocalSearchParams<{ id: string; review?: string; file?: string }>()
  const chat = useChat(id)
  const insets = useSafeAreaInsets()
  const store = useStore()
  const openFile = useOpenFile(chat)
  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [reviews, setReviews] = useState<ChangeReview[]>([])
  const [reviewId, setReviewId] = useState(initialReview ?? '')
  const [pickingRun, setPickingRun] = useState(false)
  const runLabel = (index: number) => {
    const run = reviews[index]
    if (!run) return ''
    const when = new Date(run.createdAt).toLocaleString(store.language === 'id' ? 'id-ID' : undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    })
    return `${translate(store.language, 'Run {0}', { 0: String(reviews.length - index) })} · ${when} · ${translate(store.language, run.state)}`
  }
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [commenting, setCommenting] = useState<{
    file: ChangedFile
    line: import('../../../runtime/types').DiffLine
  } | null>(null)
  const [draft, setDraft] = useState('')
  const load = async () => {
    if (!chat?.sessionId) return
    const list = await store.invoke(chat.computerId, 'reviews.list', chat.sessionId)
    setReviews(list)
    if (!reviewId && list[0]) setReviewId(list[0].id)
  }
  const review = reviews.find((r) => r.id === reviewId)
  const drafts = review?.comments.filter((x) => x.author === 'human' && x.state === 'draft') ?? []
  useEffect(() => {
    void load().catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, chat?.sessionId] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, chat?.sessionId])
  // `reviews.list` leaves file contents out to stay light (as desktop does); the opened review's diffs come from
  // `reviews.get`, re-read whenever the list changes after an action.
  const [detail, setDetail] = useState<ChangeReview | null>(null)
  useEffect(() => {
    if (!reviewId || !chat) return
    let alive = true
    store
      .invoke(chat.computerId, 'reviews.get', reviewId)
      .then((full) => alive && setDetail(full))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [reviewId, chat?.computerId, reviews] by design; the values it reads beyond these are current as of that run
  }, [reviewId, chat?.computerId, reviews])
  useEffect(() => {
    if (detail?.id === reviewId)
      setChanges(
        detail.files.map((f) => ({
          ...changedFile(f.path, f.repoName, f.oldContent, f.newContent),
          repoId: f.repoId,
          fileId: f.id,
          status: f.status,
        })),
      )
  }, [detail, reviewId])
  const action = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
      await load()
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const undo = () =>
    void action(async () => {
      if (!chat || !review) throw new Error('Choose a recorded run first.')
      const preview = await store.invoke(chat.computerId, 'reviews.undoPreview', review.id)
      const ready = preview.files.filter((f) => f.status === 'ready')
      if (!ready.length)
        throw new Error(preview.files.map((f) => `${f.path}: ${f.reason}`).join('\n') || 'There is nothing to undo.')
      Alert.alert(
        'Undo this run?',
        `${store.computers.find((c) => c.id === chat.computerId)?.name}\n${ready.map((f) => `${f.repoName}/${f.path}${f.remove ? ' (delete)' : ''}`).join('\n')}\n\n${preview.files.filter((f) => f.status === 'conflict').length} conflicting files will be skipped.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Undo',
            style: 'destructive',
            onPress: () =>
              void action(() =>
                store.invoke(
                  chat.computerId,
                  'reviews.undoApply',
                  preview.token,
                  ready.map((f) => f.fileId),
                ),
              ),
          },
        ],
      )
    })
  const sendReview = () =>
    void action(async () => {
      if (!chat || !review || !note.trim()) throw new Error('Write a review comment first.')
      const file = review.files[0]
      if (!file) throw new Error('This run has no recorded files.')
      const updated = await store.invoke(chat.computerId, 'reviews.comment', review.id, {
        fileId: file.id,
        side: 'new',
        line: 1,
        endLine: 1,
        text: note.trim(),
        scope: 'file',
      })
      const comment = updated.comments.findLast((c) => c.text === note.trim())
      if (!comment) throw new Error('Could not find the saved comment.')
      await store.invoke(chat.computerId, 'reviews.sendComments', review.id, [comment.id])
      setNote('')
    })
  const saveComment = () =>
    void action(async () => {
      if (!chat || !review || !commenting || !draft.trim()) return
      const { file, line } = commenting
      const side = line.type === 'del' ? ('old' as const) : ('new' as const)
      const n = (side === 'old' ? line.old : line.new) ?? 1
      await store.invoke(chat.computerId, 'reviews.comment', review.id, {
        fileId: file.fileId!,
        side,
        line: n,
        endLine: n,
        text: draft.trim(),
        scope: 'line',
      })
      setCommenting(null)
      setDraft('')
    })
  const sendDrafts = () =>
    void action(async () => {
      if (!chat || !review || !drafts.length) throw new Error('Tap a diff line to add a comment first.')
      await store.invoke(
        chat.computerId,
        'reviews.sendComments',
        review.id,
        drafts.map((x) => x.id),
        note.trim() || undefined,
      )
      setNote('')
    })
  const add = changes.reduce((n, f) => n + f.additions, 0)
  const del = changes.reduce((n, f) => n + f.deletions, 0)
  return (
    <Screen bg="canvas">
      <Header
        title={translate(store.language, 'Changes')}
        subtitle={
          chat
            ? [chat.branch, translate(store.language, '{count} files', { count: changes.length })]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, gap: space.s, paddingBottom: insets.bottom + 90 }}
      >
        {error ? <T tone="bad">{error}</T> : null}
        {!reviews.length ? <T tone="muted">No recorded changes for this thread yet.</T> : null}
        {/* Which run's changes are shown: one row that opens the list, newest first. */}
        {reviews.length ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={say('Choose a run')}
            onPress={() => setPickingRun(true)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              minHeight: 44,
              paddingHorizontal: space.m,
              borderRadius: radius.m,
              backgroundColor: pressed ? c.pressed : c.fill,
            })}
          >
            <T style={{ flex: 1 }} numberOfLines={1}>
              {runLabel(
                Math.max(
                  0,
                  reviews.findIndex((r) => r.id === reviewId),
                ),
              )}
            </T>
            <ChevronDown size={16} color={c.muted} />
          </Pressable>
        ) : null}
        <Sheet open={pickingRun} onClose={() => setPickingRun(false)} title={say('Runs')}>
          <SheetGroup>
            {reviews.map((r, index) => (
              <SheetOption
                key={r.id}
                title={runLabel(index)}
                selected={r.id === reviewId}
                onPress={() => {
                  setReviewId(r.id)
                  setPickingRun(false)
                }}
              />
            ))}
          </SheetGroup>
        </Sheet>
        <TextInput
          value={note}
          onChangeText={setNote}
          multiline
          placeholder={say('Review comment for the agent…')}
          placeholderTextColor={c.muted}
          style={{ padding: space.m, color: c.text, backgroundColor: c.fill, borderRadius: radius.m }}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, paddingBottom: space.s }}>
          <T size={font.control} tone="muted" style={{ flex: 1 }}>
            {changes.length} files changed
          </T>
          <T size={font.control} mono tone="ok">
            +{add}
          </T>
          <T size={font.control} mono tone="bad">
            −{del}
          </T>
        </View>
        {changes.map((f) => (
          <FileDiff
            key={f.path}
            file={f}
            comments={review?.comments.filter((x) => x.fileId === f.fileId && x.author === 'human') ?? []}
            onRemove={(id) =>
              void action(() => store.invoke(chat!.computerId, 'reviews.removeComment', review!.id, id))
            }
            onLine={(line) => {
              setCommenting({ file: f, line })
              setDraft('')
            }}
            onOpenFile={f.repoId && f.status !== 'deleted' ? () => openFile.open(f.repoId!, f.path) : undefined}
            open={open[f.path] ?? (!!initialFile && f.fileId === initialFile)}
            onToggle={() => setOpen((o) => ({ ...o, [f.path]: !o[f.path] }))}
          />
        ))}
      </ScrollView>
      <BottomFade height={insets.bottom + 96} color={c.canvas} />
      <View
        style={[
          {
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: 'row',
            gap: 10,
            paddingHorizontal: space.l,
            paddingBottom: Math.max(insets.bottom, space.m),
          },
          !floatingChrome && { backgroundColor: c.canvas, paddingTop: space.m },
        ]}
      >
        <GlassButton
          icon={Undo2}
          title={say('Undo run')}
          disabled={busy || !review}
          onPress={undo}
          style={{ flex: 1 }}
        />
        <GlassButton
          icon={MessageSquarePlus}
          title={drafts.length ? `Send ${drafts.length} comment${drafts.length === 1 ? '' : 's'}` : 'Send review'}
          disabled={busy || !review || (!note.trim() && !drafts.length)}
          onPress={drafts.length ? sendDrafts : sendReview}
          primary
          style={{ flex: 1 }}
        />
      </View>
      <Sheet
        open={Boolean(commenting)}
        onClose={() => setCommenting(null)}
        title={
          commenting
            ? `${commenting.file.path.split('/').at(-1)} · line ${commenting.line.new ?? commenting.line.old}`
            : 'Comment'
        }
      >
        <View style={{ padding: space.l, gap: space.m }}>
          {commenting ? (
            <T size={font.caption} mono tone="muted" numberOfLines={2}>
              {commenting.line.text}
            </T>
          ) : null}
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            multiline
            placeholder={say('Comment for the agent…')}
            placeholderTextColor={c.muted}
            style={commentStyle}
          />
          <Button title={say('Add comment')} disabled={!draft.trim() || busy} onPress={saveComment} />
        </View>
      </Sheet>
    </Screen>
  )
}
