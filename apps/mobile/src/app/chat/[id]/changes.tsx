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
import { useOpenFile } from '../../../runtime/openFile'
import { DiffLines } from '../../../components/DiffLines'

function FileDiff({ file, open, onToggle, onOpenFile, comments = [], onLine, onRemove }: { file: ChangedFile; open: boolean; onToggle: () => void; onOpenFile?: () => void; comments?: ReviewComment[]; onLine?: (line: import('../../../runtime/types').DiffLine) => void; onRemove?: (id: string) => void }) {
  const { c } = useTheme()
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
  const name = file.path.slice(dir.length)
  const badge = { modified: ['M', 'warn', c.warnWash], added: ['A', 'ok', c.okWash], deleted: ['D', 'bad', c.badWash] } as const
  const [letter, tone, wash] = badge[file.status]
  return (
    <Card>
      <Pressable
        onPress={() => {
          tap()
          onToggle()
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: space.s, padding: space.m, backgroundColor: pressed ? c.pressed : 'transparent' })}
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
          {onOpenFile ? <Pressable accessibilityRole="button" onPress={() => { tap(); onOpenFile() }} style={{ paddingHorizontal: space.m, paddingVertical: space.s }}><T size={font.caption} weight="600" tone="accent">Open file</T></Pressable> : null}
          <DiffLines file={file} onLine={onLine} marked={new Set(comments.filter(x => x.scope !== 'file').map(x => `${x.side}:${x.line}`))} />
          {comments.map(x => (
            <View key={x.id} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s, padding: space.m, borderTopWidth: 0.5, borderTopColor: c.line }}>
              <MessageSquarePlus size={14} color={x.state === 'draft' ? c.warn : c.muted} style={{ marginTop: 2 }} />
              <View style={{ flex: 1, gap: 2 }}>
                <T size={font.caption} tone="muted">{x.scope === 'file' ? 'File' : `Line ${x.line}`} · {x.state === 'sent' ? 'sent' : x.state === 'resolved' ? 'resolved' : 'draft'}</T>
                <T size={font.control}>{x.text}</T>
              </View>
              {x.state === 'draft' && onRemove ? <Pressable accessibilityLabel="Remove comment" hitSlop={8} onPress={() => onRemove(x.id)}><X size={15} color={c.muted} /></Pressable> : null}
            </View>
          ))}
        </>
      ) : null}
    </Card>
  )
}

export default function Changes() {
  const { c } = useTheme()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const insets = useSafeAreaInsets()
  const store = useStore()
  const openFile = useOpenFile(chat)
  const [changes, setChanges] = useState<ChangedFile[]>([])
  const [reviews, setReviews] = useState<ChangeReview[]>([])
  const [reviewId, setReviewId] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [commenting, setCommenting] = useState<{ file: ChangedFile; line: import('../../../runtime/types').DiffLine } | null>(null)
  const [draft, setDraft] = useState('')
  const load = async () => {
    if (!chat?.sessionId) return
    const list = await store.invoke(chat.computerId, 'reviews.list', chat.sessionId)
    setReviews(list)
    if (!reviewId && list[0]) setReviewId(list[0].id)
  }
  const review = reviews.find(r => r.id === reviewId)
  const drafts = review?.comments.filter(x => x.author === 'human' && x.state === 'draft') ?? []
  useEffect(() => { void load().catch(e => setError(e.message)) }, [chat?.computerId, chat?.sessionId])
  useEffect(() => {
    if (review) setChanges(review.files.map(f => ({ ...changedFile(f.path, f.repoName, f.oldContent, f.newContent), repoId: f.repoId, fileId: f.id, status: f.status })))
  }, [review])
  const action = async (fn: () => Promise<unknown>) => { setBusy(true); try { await fn(); await load(); setError('') } catch(e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) } }
  const undo = () => void action(async () => {
    if (!chat || !review) throw new Error('Choose a recorded run first.')
    const preview = await store.invoke(chat.computerId, 'reviews.undoPreview', review.id)
    const ready = preview.files.filter(f => f.status === 'ready')
    if (!ready.length) throw new Error(preview.files.map(f => `${f.path}: ${f.reason}`).join('\n') || 'There is nothing to undo.')
    Alert.alert('Undo this run?', `${store.computers.find(c => c.id === chat.computerId)?.name}\n${ready.map(f => `${f.repoName}/${f.path}${f.remove ? ' (delete)' : ''}`).join('\n')}\n\n${preview.files.filter(f => f.status === 'conflict').length} conflicting files will be skipped.`, [{ text: 'Cancel', style: 'cancel' }, { text: 'Undo', style: 'destructive', onPress: () => void action(() => store.invoke(chat.computerId, 'reviews.undoApply', preview.token, ready.map(f => f.fileId))) }])
  })
  const sendReview = () => void action(async () => {
    if (!chat || !review || !note.trim()) throw new Error('Write a review comment first.')
    const file = review.files[0]
    if (!file) throw new Error('This run has no recorded files.')
    const updated = await store.invoke(chat.computerId, 'reviews.comment', review.id, { fileId: file.id, side: 'new', line: 1, endLine: 1, text: note.trim(), scope: 'file' })
    const comment = updated.comments.findLast(c => c.text === note.trim())
    if (!comment) throw new Error('Could not find the saved comment.')
    await store.invoke(chat.computerId, 'reviews.sendComments', review.id, [comment.id])
    setNote('')
  })
  const saveComment = () => void action(async () => {
    if (!chat || !review || !commenting || !draft.trim()) return
    const { file, line } = commenting
    const side = line.type === 'del' ? 'old' as const : 'new' as const
    const n = (side === 'old' ? line.old : line.new) ?? 1
    await store.invoke(chat.computerId, 'reviews.comment', review.id, { fileId: file.fileId!, side, line: n, endLine: n, text: draft.trim(), scope: 'line' })
    setCommenting(null); setDraft('')
  })
  const sendDrafts = () => void action(async () => {
    if (!chat || !review || !drafts.length) throw new Error('Tap a diff line to add a comment first.')
    await store.invoke(chat.computerId, 'reviews.sendComments', review.id, drafts.map(x => x.id), note.trim() || undefined)
    setNote('')
  })
  const add = changes.reduce((n, f) => n + f.additions, 0)
  const del = changes.reduce((n, f) => n + f.deletions, 0)
  return (
    <Screen bg="canvas">
      <Header title="Changes" subtitle={chat ? `${chat.branch} · ${changes.length} files` : undefined} />
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.s, paddingBottom: insets.bottom + 90 }}>
        {error ? <T tone="bad">{error}</T> : null}
        {!reviews.length ? <T tone="muted">No recorded changes for this chat yet.</T> : null}
        {reviews.map((r, index) => <Pressable key={r.id} onPress={() => setReviewId(r.id)}><T tone={r.id === reviewId ? 'accent' : 'muted'}>Run {reviews.length - index} · {new Date(r.createdAt).toLocaleString()} · {r.state}</T></Pressable>)}
        <TextInput value={note} onChangeText={setNote} multiline placeholder="Review comment for the agent…" placeholderTextColor={c.muted} style={{ padding: space.m, color: c.text, backgroundColor: c.fill, borderRadius: radius.m }} />
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
          <FileDiff key={f.path} file={f} comments={review?.comments.filter(x => x.fileId === f.fileId && x.author === 'human') ?? []} onRemove={id => void action(() => store.invoke(chat!.computerId, 'reviews.removeComment', review!.id, id))} onLine={line => { setCommenting({ file: f, line }); setDraft('') }} onOpenFile={f.repoId && f.status !== 'deleted' ? () => openFile.open(f.repoId!, f.path) : undefined} open={!!open[f.path]} onToggle={() => setOpen((o) => ({ ...o, [f.path]: !o[f.path] }))} />
        ))}
      </ScrollView>
      <BottomFade height={insets.bottom + 96} color={c.canvas} />
      <View style={[{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: space.l, paddingBottom: Math.max(insets.bottom, space.m) }, !floatingChrome && { backgroundColor: c.canvas, paddingTop: space.m }]}>
        <GlassButton icon={Undo2} title="Undo run" disabled={busy || !review} onPress={undo} style={{ flex: 1 }} />
        <GlassButton icon={MessageSquarePlus} title={drafts.length ? `Send ${drafts.length} comment${drafts.length === 1 ? '' : 's'}` : 'Send review'} disabled={busy || !review || (!note.trim() && !drafts.length)} onPress={drafts.length ? sendDrafts : sendReview} primary style={{ flex: 1 }} />
      </View>
      <Sheet open={Boolean(commenting)} onClose={() => setCommenting(null)} title={commenting ? `${commenting.file.path.split('/').at(-1)} · line ${commenting.line.new ?? commenting.line.old}` : 'Comment'}>
        <View style={{ padding: space.l, gap: space.m }}>
          {commenting ? <T size={font.caption} mono tone="muted" numberOfLines={2}>{commenting.line.text}</T> : null}
          <TextInput autoFocus value={draft} onChangeText={setDraft} multiline placeholder="Comment for the agent…" placeholderTextColor={c.muted} style={{ minHeight: 80, padding: space.m, color: c.text, backgroundColor: c.fill, borderRadius: radius.m }} />
          <Button title="Add comment" disabled={!draft.trim() || busy} onPress={saveComment} />
        </View>
      </Sheet>
    </Screen>
  )
}
