import { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, View } from 'react-native'
import { useLocalSearchParams } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Copy, FileQuestion } from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { changedFile } from '../../../runtime/diff'
import type { ChangedFile } from '../../../runtime/types'
import { Header, HeaderButton, PageFlatList, Screen } from '../../../components/Screen'
import { DiffLines } from '../../../components/DiffLines'
import { CodeTokens, grammarFor, highlightLines } from '../../../components/Code'
import { Markdown } from '../../../components/Markdown'
import { Segmented, T, tap } from '../../../components/ui'

type Mode = 'file' | 'changes' | 'staged'
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i
const OTHER_MEDIA = /\.(pdf|mp3|wav|ogg|m4a|flac|mp4|mov|webm)$/i
const MODES = [
  { key: 'file', label: 'File' },
  { key: 'changes', label: 'Changes' },
  { key: 'staged', label: 'Staged' },
] as const
const MARKDOWN = /\.(md|markdown|mdx)$/i

/**
 * One screen for every way the desktop opens a file: the file itself, its unstaged changes, or its staged changes.
 * Text is virtualized by line, images pinch to zoom, and a link with a line number lands on that line.
 */
export default function FileScreen() {
  const {
    id,
    repoId,
    path,
    line,
    mode: initial,
  } = useLocalSearchParams<{ id: string; repoId: string; path: string; line?: string; mode?: Mode }>()
  const chat = useChat(id)
  const store = useStore()
  const { c } = useTheme()
  const [mode, setMode] = useState<Mode>(initial ?? 'file')
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'text'; lines: string[]; raw: string }
    | { kind: 'image'; uri: string }
    | { kind: 'unsupported'; note: string }
    | { kind: 'diff'; file: ChangedFile | null }
  >({ kind: 'loading' })
  const [repoName, setRepoName] = useState('')
  const [preview, setPreview] = useState(true)
  const list = useRef<import('react-native').FlatList<string>>(null)
  const target = line ? Number(line) : undefined
  const name = path?.split('/').at(-1) ?? ''
  const dir = path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
  const computerId = chat?.computerId,
    taskId = chat?.taskId

  useEffect(() => {
    if (!computerId || !taskId) return
    let alive = true
    void store
      .invoke(computerId, 'tasks.bindings', taskId)
      .then((bindings) => {
        if (alive) setRepoName(bindings.find((b) => b.repoId === repoId)?.repoName ?? '')
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [computerId, taskId, repoId])

  useEffect(() => {
    if (!computerId || !taskId || !repoId || !path) return
    let alive = true
    setState({ kind: 'loading' })
    const run = async () => {
      if (mode !== 'file') {
        const diff = await store.invoke(computerId, 'git.diff', taskId, repoId, path, mode === 'staged')
        return {
          kind: 'diff' as const,
          file: diff.original === diff.modified ? null : changedFile(path, repoName, diff.original, diff.modified),
        }
      }
      if (IMAGE.test(path))
        return {
          kind: 'image' as const,
          uri: (await store.invoke(computerId, 'files.media', taskId, repoId, path)).url,
        }
      if (OTHER_MEDIA.test(path))
        return { kind: 'unsupported' as const, note: 'This kind of file can only be previewed on the computer.' }
      const { content } = await store.invoke(computerId, 'files.read', taskId, repoId, path)
      return { kind: 'text' as const, raw: content, lines: content.split('\n') }
    }
    run().then(
      (next) => {
        if (alive) setState(next)
      },
      (error) => {
        if (alive) setState({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      alive = false
    }
  }, [
    computerId,
    taskId,
    repoId,
    path,
    mode,
    repoName,
    store.computers.find((x) => x.id === computerId)?.status === 'online',
  ])

  const rows = useMemo(() => (state.kind === 'text' ? state.lines : []), [state])
  // Coloured like the chat's code blocks; very large files stay plain (see highlightLines).
  const colored = useMemo(
    () => (state.kind === 'text' ? highlightLines(state.raw, grammarFor(state.raw, path)) : null),
    [state, path],
  )
  useEffect(() => {
    if (state.kind !== 'text' || !target || mode !== 'file' || (MARKDOWN.test(path ?? '') && preview)) return
    const timer = setTimeout(
      () =>
        list.current?.scrollToIndex({
          index: Math.min(rows.length - 1, Math.max(0, target - 1)),
          viewPosition: 0.3,
          animated: false,
        }),
      60,
    )
    return () => clearTimeout(timer)
  }, [state.kind, target, mode])

  if (!chat || !repoId || !path)
    return (
      <Screen>
        <Header title="File not found" />
      </Screen>
    )
  const markdown = MARKDOWN.test(path) && mode === 'file'
  const head = (
    <View style={{ gap: space.m, paddingBottom: space.m }}>
      <T size={font.caption} mono tone="muted" numberOfLines={2}>
        {[repoName, dir].filter(Boolean).join('/') || path}
      </T>
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        <Segmented value={mode} onChange={setMode} options={MODES} style={{ flex: 1 }} />
        {markdown && state.kind === 'text' ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              tap()
              setPreview((p) => !p)
            }}
            style={{
              height: 40,
              paddingHorizontal: space.m,
              borderRadius: radius.m,
              justifyContent: 'center',
              backgroundColor: c.raised2,
            }}
          >
            <T size={font.control} weight="500" tone="text">
              {preview ? 'Source' : 'Preview'}
            </T>
          </Pressable>
        ) : null}
      </View>
    </View>
  )

  return (
    <Screen bg="canvas">
      <Header
        title={name}
        right={
          <HeaderButton
            icon={Copy}
            label="Copy path"
            systemIcon="doc.on.doc"
            onPress={() => void Clipboard.setStringAsync(path)}
          />
        }
      />
      {state.kind === 'text' && !(markdown && preview) ? (
        <PageFlatList
          ref={list}
          data={rows}
          keyExtractor={(_, index) => String(index)}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 2 }}
          ListHeaderComponent={head}
          initialNumToRender={60}
          windowSize={11}
          onScrollToIndexFailed={(info) =>
            setTimeout(
              () => list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false }),
              80,
            )
          }
          renderItem={({ item, index }) => (
            <View
              style={{ flexDirection: 'row', backgroundColor: target === index + 1 ? c.accentWash : 'transparent' }}
            >
              <T
                size={11}
                mono
                tone="placeholder"
                style={{ width: 38, paddingRight: space.s, textAlign: 'right', lineHeight: 18 }}
              >
                {index + 1}
              </T>
              <T size={12} mono tone="soft" copyable={item} style={{ flex: 1, lineHeight: 18 }}>
                {item === '' ? ' ' : colored?.[index] ? <CodeTokens tokens={colored[index]!} /> : item}
              </T>
            </View>
          )}
        />
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 2, flexGrow: 1 }}
        >
          {head}
          {state.kind === 'loading' ? <ActivityIndicator style={{ marginTop: space.xl }} color={c.accent} /> : null}
          {state.kind === 'error' ? <T tone="bad">{state.message}</T> : null}
          {state.kind === 'unsupported' ? (
            <View style={{ alignItems: 'center', gap: space.m, paddingTop: space.xl }}>
              <FileQuestion size={28} color={c.placeholder} />
              <T tone="muted" style={{ textAlign: 'center' }}>
                {state.note}
              </T>
            </View>
          ) : null}
          {state.kind === 'image' ? (
            <ScrollView
              maximumZoomScale={5}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              style={{ borderRadius: radius.m, backgroundColor: c.code }}
              contentContainerStyle={{ alignItems: 'center', justifyContent: 'center' }}
            >
              <Image
                source={{ uri: state.uri }}
                resizeMode="contain"
                accessibilityLabel={name}
                style={{ width: '100%', aspectRatio: 1, minHeight: 240 }}
              />
            </ScrollView>
          ) : null}
          {state.kind === 'text' && markdown && preview ? <Markdown text={state.raw} /> : null}
          {state.kind === 'diff' ? (
            state.file ? (
              <DiffLines file={state.file} />
            ) : (
              <T tone="muted">
                {mode === 'staged' ? 'Nothing is staged for this file.' : 'No unstaged changes in this file.'}
              </T>
            )
          ) : null}
        </ScrollView>
      )}
    </Screen>
  )
}
