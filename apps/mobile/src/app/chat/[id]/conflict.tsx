import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { ArrowRight, CircleCheck, FileText, Sparkles } from 'lucide-react-native'
import type { ConflictChoice, ConflictHunk } from '@ramu/shared/conflicts'
import { DEFAULT_AGENT_SETTINGS, type ConflictFile, type GitStatus, type RepositoryBinding } from '@ramu/shared/types'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost } from '../../../runtime/viewerAccess'
import { CHOICES, CHOICE_LABEL, startConflictThread } from '../../../runtime/conflicts'
import { useOpenFile } from '../../../runtime/openFile'
import { useSay } from '../../../i18n'
import { Header, Screen, PageScrollView } from '../../../components/Screen'
import { Button, Card, Divider, T } from '../../../components/ui'

const FILE_LABEL: Record<ConflictChoice, string> = {
  current: 'Accept current in this file',
  incoming: 'Accept incoming in this file',
  both: 'Accept both in this file',
}

const REASON: Record<NonNullable<ConflictFile['reason']>, string> = {
  binary: 'This is a binary file, so it has no conflict markers. Keep one side of the whole file.',
  'too-large': 'This file is too large to show here. Keep one side of the whole file, or edit it in the editor.',
  deleted: 'One side deleted this file and the other changed it. Keep the change or the deletion.',
}

/** Lines shown above each conflict so it can be told apart from the others. */
const CONTEXT = 3

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const rawId = (id: string) => id.slice(id.indexOf(':') + 1)

/** Code that keeps its lines whole and scrolls sideways, as a diff does on the phone. */
function Lines({ lines, tone }: { lines: string[]; tone: 'current' | 'incoming' | 'base' | 'context' }) {
  const say = useSay()
  const { c } = useTheme()
  const background =
    tone === 'current' ? c.okWash : tone === 'incoming' ? c.accentWash : tone === 'base' ? c.raised2 : 'transparent'
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ backgroundColor: background }}>
      <View style={{ paddingHorizontal: space.m, paddingVertical: space.s, minWidth: '100%' }}>
        {lines.length ? (
          <T size={font.caption} mono tone={tone === 'context' ? 'muted' : 'text'} copyable={lines.join('\n')}>
            {lines.join('\n')}
          </T>
        ) : (
          <T size={font.caption} tone="muted">
            {say('(nothing)')}
          </T>
        )}
      </View>
    </ScrollView>
  )
}

function Side({ title, lines, tone }: { title: string; lines: string[]; tone: 'current' | 'incoming' | 'base' }) {
  return (
    <View>
      <T
        size={font.caption}
        weight="600"
        tone={tone === 'current' ? 'ok' : tone === 'incoming' ? 'accent' : 'muted'}
        numberOfLines={1}
        style={{ paddingHorizontal: space.m, paddingTop: space.s, paddingBottom: 2 }}
      >
        {title}
      </T>
      <Lines lines={lines} tone={tone} />
    </View>
  )
}

/**
 * A conflicted file conflict by conflict, as the desktop's conflict view shows it: what the branch has (current), what
 * is coming in, and the common ancestor when Git recorded it. Each conflict, or the whole file, keeps a side; the host
 * stages the file once none are left. A view-only device sees the conflicts and changes nothing.
 */
export default function ConflictScreen() {
  const say = useSay()
  const router = useRouter()
  const { c } = useTheme()
  const { id, repoId, path } = useLocalSearchParams<{ id: string; repoId: string; path: string }>()
  const chat = useChat(id)
  const store = useStore()
  const canWrite = canWriteHost(store.computers.find((pc) => pc.id === chat?.computerId))
  const openFile = useOpenFile(chat)
  const [file, setFile] = useState<ConflictFile | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [binding, setBinding] = useState<RepositoryBinding | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const computerId = chat?.computerId ?? ''
  const taskId = chat?.taskId ?? ''

  const read = useCallback(async () => {
    if (!computerId || !taskId) return
    const [next, nextStatus] = await Promise.all([
      store.invoke(computerId, 'git.conflictFile', taskId, repoId, path).then(
        (value) => {
          setFileError(null)
          return value
        },
        (e: unknown) => {
          setFileError(message(e))
          return null
        },
      ),
      store.invoke(computerId, 'git.status', taskId, repoId).catch(() => null),
    ])
    setFile(next)
    if (nextStatus) setStatus(nextStatus)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
  }, [computerId, taskId, repoId, path])
  const readRef = useRef(read)
  readRef.current = read

  useEffect(() => {
    if (!computerId || !taskId) return
    store
      .invoke(computerId, 'tasks.bindings', taskId)
      .then((list) => setBinding(list.find((entry) => entry.repoId === repoId) ?? null))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads once per checkout
  }, [computerId, taskId, repoId])

  // An agent or the desktop may resolve the file meanwhile; follow the host's file changes as Source Control does.
  useFocusEffect(
    useCallback(() => {
      void readRef.current()
      if (!computerId || !binding) return
      let timer: ReturnType<typeof setTimeout> | undefined
      const unwatch = store.watch(computerId, ['fs:changed'])
      const off = store.subscribe(computerId, (channel, payload) => {
        if (channel !== 'fs:changed' || payload.cwd !== binding.cwd) return
        clearTimeout(timer)
        timer = setTimeout(() => void readRef.current(), 400)
      })
      return () => {
        clearTimeout(timer)
        off()
        unwatch()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- re-subscribes per host and checkout
    }, [computerId, binding?.cwd, path]),
  )

  const pullToRefresh = async () => {
    setRefreshing(true)
    await read()
    setRefreshing(false)
  }

  const run = async (work: () => Promise<unknown>) => {
    if (!canWrite || busy) return
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(false)
      await read()
    }
  }
  const choose = (choice: ConflictChoice, hunk?: number) =>
    run(() =>
      store.invoke(computerId, 'git.resolveConflict', taskId, repoId, path, choice, hunk, file?.hash ?? undefined),
    )
  const withAi = () =>
    run(async () => {
      if (!chat?.projectId) throw new Error(say('This checkout is not part of a project.'))
      const started = await startConflictThread(store.invoke, {
        computerId,
        projectId: rawId(chat.projectId),
        workspaceId: chat.mode === 'worktree' ? chat.workspaceId : null,
        repoName: binding?.repoName ?? '',
        cwd: binding?.cwd ?? '',
        kind: status?.operation ?? 'merge',
        paths: [path],
        whole: false,
        settings: chat.settings?.model ? chat.settings : (store.defaults[computerId] ?? DEFAULT_AGENT_SETTINGS),
        say,
      })
      await store.refresh(computerId).catch(() => {})
      router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, started) } })
    })

  const others = (status?.entries ?? []).filter(
    (entry) => (entry.staged === 'unmerged' || entry.unstaged === 'unmerged') && entry.path !== path,
  )
  const openNext = () => {
    const next = others[0]
    if (next) router.replace({ pathname: '/chat/[id]/conflict', params: { id, repoId, path: next.path } })
  }
  // A file that is no longer conflicted was resolved here, by an agent or by hand.
  const resolved = !!fileError && /no conflict to resolve/i.test(fileError)
  const contextOf = (hunk: ConflictHunk) => {
    const all = file?.text?.split(/\r?\n/) ?? []
    return all.slice(Math.max(0, hunk.line - CONTEXT), hunk.line).filter((line) => !/^[<=>|]{7}/.test(line))
  }
  const sides = CHOICES.filter((choice) => (file?.hunks.length ?? 0) > 0 || choice !== 'both')
  const name = path.slice(path.lastIndexOf('/') + 1)

  return (
    <Screen bg="canvas">
      <Header title={name} subtitle={path.includes('/') ? path : undefined} />
      <PageScrollView
        fullWidth
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: space.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={c.muted} />
        }
      >
        {!file && !fileError ? <T tone="muted">{say('Loading…')}</T> : null}
        {fileError && !resolved ? (
          <View style={{ gap: space.m }}>
            <T tone="bad">{fileError}</T>
            <Button kind="secondary" title={say('Try again')} onPress={() => void pullToRefresh()} />
          </View>
        ) : null}

        {resolved ? (
          <Card style={{ padding: space.l, gap: space.m }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
              <CircleCheck size={16} color={c.ok} />
              <T weight="600" tone="ok" accessibilityLiveRegion="polite">
                {say('Resolved and staged.')}
              </T>
            </View>
            {others.length ? (
              <Button icon={ArrowRight} title={say('Next conflicted file')} onPress={openNext} />
            ) : (
              <T size={font.control} tone="muted">
                {status?.operation
                  ? say('Every conflict is resolved. Continue the {0} in Source Control.', { 0: status.operation })
                  : say('Every conflict is resolved. Commit the result in Source Control.')}
              </T>
            )}
          </Card>
        ) : null}

        {file ? (
          <View style={{ gap: space.s }}>
            <T size={font.control} tone="soft">
              {file.hunks.length
                ? say('{0} conflicts left. Changes Git merged cleanly are kept.', { 0: file.hunks.length })
                : file.reason
                  ? say(REASON[file.reason])
                  : say('No conflict markers are left. Mark it resolved in Source Control when it looks right.')}
            </T>
            {canWrite ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                {sides.map((choice) => (
                  <Button
                    key={choice}
                    kind={choice === 'current' ? 'primary' : 'secondary'}
                    title={say((file.hunks.length ? FILE_LABEL : CHOICE_LABEL)[choice])}
                    disabled={busy}
                    onPress={() => void choose(choice)}
                    style={{ flexGrow: 1 }}
                  />
                ))}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
              {canWrite ? (
                <Button
                  kind="ghost"
                  icon={Sparkles}
                  title={say('Resolve this file with AI')}
                  disabled={busy}
                  onPress={() => void withAi()}
                />
              ) : null}
              {file.text !== null ? (
                <Button
                  kind="ghost"
                  icon={FileText}
                  title={say('Open file')}
                  onPress={() => openFile.open(repoId, path)}
                />
              ) : null}
            </View>
            {error ? (
              <T size={font.control} tone="bad" accessibilityLiveRegion="polite">
                {error}
              </T>
            ) : null}
          </View>
        ) : null}

        {file?.hunks.map((hunk) => {
          const context = contextOf(hunk)
          return (
            <Card key={`${hunk.index}:${hunk.line}`} style={{ overflow: 'hidden', borderRadius: radius.m }}>
              <View style={{ paddingHorizontal: space.m, paddingTop: space.m, gap: space.s }}>
                <T size={font.caption} tone="muted">
                  {say('Conflict {0} · line {1}', { 0: hunk.index + 1, 1: hunk.line + 1 })}
                </T>
                {canWrite ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, paddingBottom: space.s }}>
                    {CHOICES.map((choice) => (
                      <Button
                        key={choice}
                        kind="secondary"
                        title={say(CHOICE_LABEL[choice])}
                        accessibilityLabel={`${say(CHOICE_LABEL[choice])}, ${say('Conflict {0} · line {1}', { 0: hunk.index + 1, 1: hunk.line + 1 })}`}
                        disabled={busy}
                        onPress={() => void choose(choice, hunk.index)}
                        style={{ flexGrow: 1 }}
                      />
                    ))}
                  </View>
                ) : null}
              </View>
              {context.length ? (
                <>
                  <Divider />
                  <Lines lines={context} tone="context" />
                </>
              ) : null}
              <Divider />
              <Side
                title={hunk.currentLabel ? say('Current · {0}', { 0: hunk.currentLabel }) : say('Current')}
                lines={hunk.current}
                tone="current"
              />
              {hunk.base ? (
                <>
                  <Divider />
                  <Side title={say('Common ancestor')} lines={hunk.base} tone="base" />
                </>
              ) : null}
              <Divider />
              <Side
                title={hunk.incomingLabel ? say('Incoming · {0}', { 0: hunk.incomingLabel }) : say('Incoming')}
                lines={hunk.incoming}
                tone="incoming"
              />
            </Card>
          )
        })}
      </PageScrollView>
    </Screen>
  )
}
