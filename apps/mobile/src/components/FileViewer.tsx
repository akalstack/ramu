import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { SvgXml } from 'react-native-svg'
import { Check, Copy, FileQuestion, FolderSearch, Pencil, X } from 'lucide-react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import { useT, useSay } from '../i18n'
import { useWorkspaces } from '../runtime/useWorkspaces'
import { ExplorerDraftError, type NewComposerOrigin } from '../runtime/composerDrafts'
import type { RepositoryBinding } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../theme'
import { useStore } from '../runtime/store'
import { changedFile } from '../runtime/diff'
import type { ChangedFile } from '../runtime/types'
import { Header, HeaderButton, PageFlatList, Screen } from '../components/Screen'
import { DiffLines } from '../components/DiffLines'
import { CodeTokens, grammarFor, highlightLines } from '../components/Code'
import { Markdown } from '../components/Markdown'
import { diffMethod, type Revision } from '../runtime/gitRevision'
import { Button, Segmented, T, tap } from '../components/ui'

type Mode = 'file' | 'changes' | 'staged' | 'revision'
const IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp|ico)$/i
const OTHER_MEDIA = /\.(pdf|mp3|wav|ogg|m4a|flac|mp4|mov|webm)$/i
const MARKDOWN = /\.(md|markdown|mdx)$/i
// SVG opens as an image, like Markdown opens rendered; Source shows the code.
const SVG = /\.svg$/i

/**
 * One screen for every way the desktop opens a file: the file itself, its unstaged changes, or its staged changes.
 * Text is virtualized by line, images pinch to zoom, and a link with a line number lands on that line.
 */
const CodeLine = memo(function CodeLine({
  line,
  number,
  tokens,
  highlighted,
  wash,
}: {
  line: string
  number: number
  tokens?: Parameters<typeof CodeTokens>[0]['tokens']
  highlighted: boolean
  wash: string
}) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: highlighted ? wash : 'transparent' }}>
      <T
        size={11}
        mono
        tone="placeholder"
        style={{ width: 38, paddingRight: space.s, textAlign: 'right', lineHeight: 18 }}
      >
        {number}
      </T>
      <T size={12} mono tone="soft" copyable={line} style={{ flex: 1, lineHeight: 18 }}>
        {line === '' ? ' ' : tokens ? <CodeTokens tokens={tokens} /> : line}
      </T>
    </View>
  )
})

/** Bigger files are read-only on the phone, where one text field would be slow to scroll and type in. */
const MAX_EDIT_CHARS = 200_000
/** Above this the text being edited stays plain, so typing stays quick. */
const MAX_HIGHLIGHT_EDIT = 30_000

export function FileViewer({
  computerId,
  contextId: taskId,
  repoId,
  path,
  line,
  initial,
  revision,
  composer,
}: {
  computerId?: string
  contextId?: string
  repoId: string
  path: string
  line?: string
  initial?: Exclude<Mode, 'revision'> | 'all'
  /** A file as one commit or stash changed it: opened from its row in Source Control, read-only. */
  revision?: Revision
  composer?: NewComposerOrigin
}) {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const t = useT()
  const identity = JSON.stringify([computerId, taskId, repoId, path, revision])
  const online = !!computerId && store.isOnline(computerId)
  const catalog = useWorkspaces(computerId ?? '', !!taskId?.startsWith('worktree:'))
  const [referenceError, setReferenceError] = useState('')
  const [reviewDraft, setReviewDraft] = useState(false)
  const [adding, setAdding] = useState(false)
  const addition = useRef(false)
  const activeIdentity = useRef(identity)
  activeIdentity.current = identity
  const { c } = useTheme()
  const [mode, setMode] = useState<Mode>(revision ? 'revision' : initial === 'all' ? 'changes' : (initial ?? 'file'))
  const readIdentity = JSON.stringify([identity, mode])
  const activeRead = useRef(readIdentity)
  activeRead.current = readIdentity
  useFocusEffect(
    useCallback(() => {
      activeRead.current = readIdentity
      addition.current = false
      setAdding(false)
      return () => {
        activeRead.current = ''
      }
    }, [readIdentity]),
  )
  type FileState =
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'text'; lines: string[]; raw: string; hash?: string }
    | { kind: 'image'; uri: string }
    | { kind: 'unsupported'; note: string }
    | { kind: 'diff'; file: ChangedFile | null }
  const [file, setFile] = useState<{ owner: string; value: FileState }>({
    owner: readIdentity,
    value: { kind: 'loading' },
  })
  const [loading] = useState<FileState>({ kind: 'loading' })
  const state: FileState = file.owner === readIdentity ? file.value : loading
  const [scope, setScope] = useState<{
    owner: string
    bindings: RepositoryBinding[]
    loading: boolean
    error?: string
  }>({
    owner: identity,
    bindings: [],
    loading: online,
  })
  const binding = scope.owner === identity ? scope.bindings.find((b) => b.repoId === repoId) : undefined
  const repoName = binding?.repoName ?? ''
  const gitAvailable = !!binding && !binding.folderOnly && !binding.notGit
  const target = line && Number.isSafeInteger(Number(line)) && Number(line) > 0 ? Number(line) : undefined
  const [preview, setPreview] = useState(target === undefined)
  const [svgBroken, setSvgBroken] = useState(false)
  useEffect(() => setSvgBroken(false), [state])
  // The text being edited, or null while only viewing.
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  // The text being edited is coloured like the viewer, re-highlighted as it changes. The coloured spans must spell out
  // exactly the field's text or the cursor would jump, so anything that does not round-trip (or a long file, where
  // highlighting every keystroke would lag) is edited plain.
  const editingTokens = useMemo(() => {
    if (draft === null || draft.length > MAX_HIGHLIGHT_EDIT) return null
    const lines = highlightLines(draft, grammarFor(draft, path))
    if (!lines) return null
    const rebuilt = lines.map((tokens) => tokens.map((token) => token.text).join('')).join('\n')
    return rebuilt === draft ? lines : null
  }, [draft, path])
  useEffect(() => {
    if (target !== undefined) setPreview(false)
  }, [identity, target])
  const list = useRef<import('react-native').FlatList<string>>(null)
  const name = path?.split('/').at(-1) ?? ''
  const dir = path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

  useEffect(() => {
    let alive = true
    setScope({ owner: identity, bindings: [], loading: online })
    setReferenceError('')
    setReviewDraft(false)
    addition.current = false
    setAdding(false)
    if (computerId && taskId && online)
      void store.invoke(computerId, 'files.explorerBindings', taskId).then(
        (bindings) => {
          if (alive) setScope({ owner: identity, bindings, loading: false })
        },
        (error) => {
          if (alive)
            setScope({
              owner: identity,
              bindings: [],
              loading: false,
              error: error instanceof Error ? error.message : String(error),
            })
        },
      )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [identity, online] by design; the values it reads beyond these are current as of that run
  }, [identity, online])

  useEffect(() => {
    if (!computerId || !taskId || !repoId || !path || !online || !binding || binding.setupState !== 'ready') return
    let alive = true
    setFile({ owner: readIdentity, value: { kind: 'loading' } })
    const run = async () => {
      if (mode !== 'file') {
        if (!gitAvailable) return { kind: 'unsupported' as const, note: t.fileNoGit }
        const diff =
          mode === 'revision' && revision
            ? await store.invoke(computerId, diffMethod(revision), taskId, repoId, revision.oid, path)
            : await store.invoke(
                computerId,
                'git.diff',
                taskId,
                repoId,
                path,
                mode === 'changes' ? 'all' : mode === 'staged',
              )
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
        return { kind: 'unsupported' as const, note: 'This kind of file can only be previewed on the host.' }
      const { content, hash } = await store.invoke(computerId, 'files.read', taskId, repoId, path)
      return { kind: 'text' as const, raw: content, lines: content.split('\n'), hash }
    }
    run().then(
      (next) => {
        if (alive) setFile({ owner: readIdentity, value: next })
      },
      (error) => {
        if (alive)
          setFile({
            owner: readIdentity,
            value: {
              kind: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
          })
      },
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [readIdentity, online, binding] by design; the values it reads beyond these are current as of that run
  }, [readIdentity, online, binding])

  const rows = useMemo(() => (state.kind === 'text' ? state.lines : []), [state])
  // Coloured like the chat's code blocks; very large files stay plain (see highlightLines).
  const colored = useMemo(
    () => (state.kind === 'text' ? highlightLines(state.raw, grammarFor(state.raw, path)) : null),
    [state, path],
  )
  useEffect(() => {
    if (
      state.kind !== 'text' ||
      !target ||
      mode !== 'file' ||
      ((MARKDOWN.test(path ?? '') || SVG.test(path ?? '')) && preview)
    )
      return
    const timer = setTimeout(
      () =>
        activeRead.current === readIdentity &&
        list.current?.scrollToIndex({
          index: Math.min(rows.length - 1, Math.max(0, target - 1)),
          viewPosition: 0.3,
          animated: false,
        }),
      60,
    )
    return () => clearTimeout(timer)
  }, [state.kind, target, mode, preview, rows.length, path, readIdentity])

  if (!computerId || !taskId || !store.computers.some((host) => host.id === computerId) || !repoId || !path)
    return (
      <Screen>
        <Header title={say('File not found')} />
      </Screen>
    )
  const thread = store.chats.find((chat) => chat.computerId === computerId && chat.taskId === taskId)
  const worktree =
    taskId.startsWith('worktree:') && catalog.host === computerId
      ? catalog.rows.find((workspace) => workspace.id === taskId.slice('worktree:'.length))
      : undefined
  const sourceProject =
    thread?.projectId ??
    (taskId.startsWith('project:')
      ? `${computerId}:${taskId.slice('project:'.length)}`
      : worktree
        ? `${computerId}:${worktree.projectId}`
        : undefined)
  const knownProject =
    sourceProject === 'no-project' ||
    store.projects.some((project) => project.computerId === computerId && project.id === sourceProject)
  const canAdd =
    !revision &&
    online &&
    binding?.setupState === 'ready' &&
    knownProject &&
    ['text', 'image', 'diff'].includes(state.kind)
  const addFile = async () => {
    if (!canAdd || addition.current || activeRead.current !== readIdentity) return
    addition.current = true
    setAdding(true)
    try {
      const destination = await store.addExplorerFile({
        computerId,
        contextId: taskId,
        repoId,
        path,
        ...(mode !== 'file' ? { diff: mode === 'changes' ? 'all' : mode === 'staged' } : {}),
        ...(state.kind === 'image' ? { asReference: true } : {}),
        composer,
        catalog: { host: catalog.host, rows: catalog.rows },
      })
      if (activeRead.current !== readIdentity) return
      if (destination.kind === 'chat') router.dismissTo({ pathname: '/chat/[id]', params: { id: destination.chatId } })
      else
        (composer ? router.dismissTo : router.push)({
          pathname: '/new',
          params: {
            computer: computerId,
            project: destination.projectId,
            ...(destination.draftContext ? { draftContext: destination.draftContext } : {}),
          },
        })
    } catch (error) {
      addition.current = false
      setAdding(false)
      setReviewDraft(error instanceof ExplorerDraftError && error.code === 'scope' && !thread && !composer)
      setReferenceError(
        error instanceof ExplorerDraftError && error.code === 'full'
          ? t.fileDraftFull
          : error instanceof ExplorerDraftError && error.code === 'scope'
            ? t.fileDraftScopeChanged
            : t.fileDraftFailed,
      )
    }
  }
  const reveal = () => {
    if (activeIdentity.current !== identity) return
    router.dismissTo({
      pathname: '/explorer',
      params: {
        computer: computerId,
        ctx: taskId,
        repoId,
        path,
        revealId: String(Date.now()),
        ...(composer
          ? {
              composerProject: composer.projectId,
              ...(composer.draftContext ? { draftContext: composer.draftContext } : {}),
            }
          : {}),
      },
    })
  }
  const markdown = MARKDOWN.test(path) && mode === 'file'
  const svg = SVG.test(path) && mode === 'file'
  const rendered = (markdown || (svg && !svgBroken)) && preview
  // Editing on the phone: the whole file in one text field, saved only if nobody changed it on the host meanwhile.
  const viewOnly = store.computers.find((host) => host.id === computerId)?.access === 'viewer'
  const editable =
    state.kind === 'text' &&
    mode === 'file' &&
    !revision &&
    online &&
    !viewOnly &&
    !!taskId &&
    !!state.hash &&
    state.raw.length <= MAX_EDIT_CHARS
  const save = async (base: string | null) => {
    if (draft === null || !computerId || !taskId || state.kind !== 'text') return
    setSaving(true)
    try {
      const result = await store.invoke(computerId, 'files.write', taskId, repoId, path, draft, base)
      if (!result.ok) {
        Alert.alert(say('Changed on the host'), say('This file changed on the host since you opened it.'), [
          { text: say('Cancel'), style: 'cancel' },
          {
            text: say('Reload'),
            onPress: () =>
              void store.invoke(computerId, 'files.read', taskId, repoId, path).then(({ content, hash }) => {
                setDraft(null)
                setFile({
                  owner: readIdentity,
                  value: { kind: 'text', raw: content, lines: content.split('\n'), hash },
                })
              }),
          },
          { text: say('Overwrite'), style: 'destructive', onPress: () => void save(result.diskHash) },
        ])
        return
      }
      setFile({ owner: readIdentity, value: { kind: 'text', raw: draft, lines: draft.split('\n'), hash: result.hash } })
      setDraft(null)
    } catch (error) {
      Alert.alert(say('Could not save'), error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  const stopEditing = () => {
    if (draft === null || state.kind !== 'text' || draft === state.raw) return setDraft(null)
    Alert.alert(say('Discard changes?'), undefined, [
      { text: say('Keep editing'), style: 'cancel' },
      { text: say('Discard'), style: 'destructive', onPress: () => setDraft(null) },
    ])
  }
  const head = (
    <View style={{ gap: space.m, paddingBottom: space.m }}>
      <T size={font.caption} mono tone="muted" numberOfLines={2}>
        {[repoName, dir].filter(Boolean).join('/') || path}
      </T>
      {revision ? null : (
        <Button
          title={
            state.kind === 'image' ? t.addImageReference : thread || composer ? t.addToMessage : t.newThreadWithFile
          }
          disabled={!canAdd || adding}
          onPress={addFile}
        />
      )}
      {!online ? <T tone="muted">{t.explorerOffline}</T> : null}
      {scope.owner === identity && scope.error ? <T tone="bad">{scope.error}</T> : null}
      {taskId.startsWith('worktree:') && catalog.loading ? <T tone="muted">{t.loadingWorkspaces}</T> : null}
      {taskId.startsWith('worktree:') && catalog.error ? <T tone="muted">{t.workspacesLoadFailed}</T> : null}
      {binding?.setupState === 'ready' && !knownProject && !catalog.loading && !catalog.error ? (
        <T tone="muted">{t.fileScopeUnavailable}</T>
      ) : null}
      {binding && binding.setupState !== 'ready' ? (
        <T tone="muted">{binding.setupError ?? t.workspaceUnavailable}</T>
      ) : null}
      {scope.owner === identity && !scope.loading && !binding && !scope.error && online ? (
        <T tone="muted">{t.fileScopeUnavailable}</T>
      ) : null}
      {referenceError ? (
        <T tone="bad" accessibilityLiveRegion="polite">
          {referenceError}
        </T>
      ) : null}
      {reviewDraft && sourceProject ? (
        <Button
          kind="ghost"
          title={t.openDraft}
          onPress={() =>
            router.push({
              pathname: '/new',
              params: { computer: computerId, project: sourceProject, draftContext: taskId },
            })
          }
        />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
        {revision ? null : (
          <Segmented<Mode>
            value={mode}
            onChange={setMode}
            options={
              (gitAvailable
                ? [
                    { key: 'file', label: t.fileLabel },
                    { key: 'changes', label: t.changes },
                    { key: 'staged', label: t.stagedChanges },
                  ]
                : [{ key: 'file', label: t.fileLabel }]) as { key: Mode; label: string }[]
            }
            style={{ flex: 1 }}
          />
        )}
        {(markdown || svg) && state.kind === 'text' ? (
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
        subtitle={
          <T size={font.caption} tone="muted" numberOfLines={1}>
            {store.computers.find((host) => host.id === computerId)?.name} · {repoName}
            {revision ? ` · ${revision.stash ? 'stash' : revision.oid.slice(0, 7)}` : ''}
          </T>
        }
        right={
          draft !== null ? (
            <>
              <HeaderButton icon={X} label={say('Cancel')} systemIcon="xmark" onPress={stopEditing} />
              <HeaderButton
                icon={Check}
                label={saving ? say('Saving…') : say('Save')}
                systemIcon="checkmark"
                onPress={() => state.kind === 'text' && !saving && void save(state.hash ?? null)}
              />
            </>
          ) : (
            <>
              {editable && state.kind === 'text' ? (
                <HeaderButton
                  icon={Pencil}
                  label={say('Edit')}
                  systemIcon="pencil"
                  onPress={() => setDraft(state.raw)}
                />
              ) : null}
              {revision ? null : (
                <HeaderButton icon={FolderSearch} label={t.showInExplorer} systemIcon="folder" onPress={reveal} />
              )}
              <HeaderButton
                icon={Copy}
                label={t.copyPath}
                systemIcon="doc.on.doc"
                onPress={() => void Clipboard.setStringAsync(path)}
              />
            </>
          )
        }
      />
      {draft !== null ? (
        <TextInput
          accessibilityLabel={say('Edit {0}', { 0: name })}
          onChangeText={setDraft}
          editable={!saving}
          multiline
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          textAlignVertical="top"
          style={{
            flex: 1,
            padding: space.l,
            color: c.text,
            backgroundColor: c.canvas,
            fontFamily: font.mono,
            fontSize: font.control,
            lineHeight: 20,
          }}
        >
          {editingTokens
            ? editingTokens.map((tokens, index) => (
                <Fragment key={index}>
                  {index ? '\n' : null}
                  <CodeTokens tokens={tokens} />
                </Fragment>
              ))
            : draft}
        </TextInput>
      ) : null}
      {draft !== null ? null : state.kind === 'text' && !rendered ? (
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
              () =>
                activeRead.current === readIdentity &&
                list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false }),
              80,
            )
          }
          renderItem={({ item, index }) => (
            <CodeLine
              line={item}
              number={index + 1}
              tokens={colored?.[index]}
              highlighted={target === index + 1}
              wash={c.accentWash}
            />
          )}
        />
      ) : (
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, paddingBottom: space.xl * 2, flexGrow: 1 }}
        >
          {head}
          {online &&
          (scope.loading ||
            (state.kind === 'loading' && scope.owner === identity && binding?.setupState === 'ready')) ? (
            <ActivityIndicator style={{ marginTop: space.xl }} color={c.accent} />
          ) : null}
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
          {state.kind === 'text' && svg && !svgBroken && preview ? (
            <ScrollView
              maximumZoomScale={5}
              minimumZoomScale={1}
              bouncesZoom
              centerContent
              style={{ borderRadius: radius.m, backgroundColor: c.code }}
              contentContainerStyle={{ alignItems: 'center', justifyContent: 'center', padding: space.m }}
            >
              <SvgXml
                xml={state.raw}
                width="100%"
                height={320}
                accessibilityLabel={name}
                onError={() => setSvgBroken(true)}
              />
            </ScrollView>
          ) : null}
          {state.kind === 'diff' ? (
            state.file ? (
              <DiffLines file={state.file} />
            ) : (
              <T tone="muted">{mode === 'staged' ? t.fileNothingStaged : t.fileNoChanges}</T>
            )
          ) : null}
        </ScrollView>
      )}
    </Screen>
  )
}
