import { BottomSearch } from '../../../components/BottomSearch'
import { readSyncConfirmation } from '@ramu/shared/protectedBranch'
import { useEffect, useRef, useState } from 'react'
import { Alert, Platform, Pressable, TextInput, View } from 'react-native'
import { useKeyboardInset } from '../../../components/Keyboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams } from 'expo-router'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  CloudDownload,
  CloudUpload,
  Copy,
  FolderGit2,
  Ellipsis,
  GitBranch,
  GitBranchPlus,
  Minus,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react-native'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import type { ChangedFile } from '../../../runtime/types'
import type { RepositoryBinding, GitStash, CommitDraft } from '@ramu/shared/types'
interface GitCommitInfo {
  oid: string
  subject: string
  author: string
  at: number
  pushed: boolean
}
type GitStashInfo = GitStash
import { draftCommit } from '../../../runtime/gitQuick'
import { ago } from '../../../i18n'
import * as Clipboard from 'expo-clipboard'
import { useOpenFile } from '../../../runtime/openFile'
import { Disclosure } from '../../../components/Motion'
import { Header, HeaderButton, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { Glass, floatingChrome } from '../../../components/Glass'
import { Card, Divider, IconButton, Pill, Row, Segmented, Sheet, T, tap, type Icon } from '../../../components/ui'

// Mirrors the desktop Source Control panel (apps/web/src/sidebar/ScmPanel.tsx) per repository:
// branch picker + sync, commit box with a Commit & Push split button, Staged / Changes groups,
// and the Git section with Commits and Stashes. All actions run on the selected host.

type CommitAction = 'commit' | 'push' | 'sync' | 'amend' | 'branch'
const ACTIONS: { key: CommitAction; label: string }[] = [
  { key: 'commit', label: 'Commit' },
  { key: 'push', label: 'Commit & Push' },
  { key: 'sync', label: 'Commit & Sync' },
  { key: 'amend', label: 'Commit (Amend)' },
  { key: 'branch', label: 'Commit on new branch' },
]

interface FileState extends ChangedFile {
  staged: boolean | 'all'
}

function StatusLetter({ status }: { status: ChangedFile['status'] }) {
  const { c } = useTheme()
  const map = {
    modified: ['M', 'warn', c.warnWash],
    added: ['A', 'ok', c.okWash],
    deleted: ['D', 'bad', c.badWash],
  } as const
  const [letter, tone, wash] = map[status]
  return (
    <Pill tone={tone} wash={wash}>
      {letter}
    </Pill>
  )
}

function FileRow({
  file,
  onOpen,
  onStage,
  onDiscard,
}: {
  file: FileState
  onOpen: () => void
  onStage?: () => void
  onDiscard?: () => void
}) {
  const dir = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/') + 1) : ''
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.s,
        paddingLeft: space.m,
        paddingRight: 4,
        minHeight: 46,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${file.staged === 'all' ? 'all' : file.staged ? 'staged' : 'unstaged'} changes in ${file.path}`}
        onPress={() => {
          tap()
          onOpen()
        }}
        style={{ flex: 1, justifyContent: 'center', alignSelf: 'stretch' }}
      >
        <T size={font.body - 1} weight="500" numberOfLines={1}>
          {file.path.slice(dir.length)}
        </T>
        <T size={font.caption} tone="muted" numberOfLines={1}>
          {dir}
        </T>
      </Pressable>
      {onDiscard ? (
        <IconButton
          icon={Undo2}
          label={file.staged === 'all' ? 'Discard unstaged changes' : 'Discard changes'}
          size={34}
          tone="muted"
          onPress={onDiscard}
        />
      ) : null}
      {onStage ? (
        <IconButton
          icon={file.staged ? Minus : Plus}
          label={file.staged ? 'Unstage changes' : 'Stage changes'}
          size={34}
          tone="soft"
          onPress={onStage}
        />
      ) : null}
      <View style={{ width: 28, alignItems: 'center' }}>
        <StatusLetter status={file.status} />
      </View>
    </View>
  )
}

function Group({
  title,
  count,
  open = true,
  onToggle,
  action,
  children,
}: {
  title: string
  count: number
  open?: boolean
  onToggle?: () => void
  action?: { icon: Icon; label: string; onPress: () => void }
  children: React.ReactNode
}) {
  const { c } = useTheme()
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2, minHeight: 32 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          onPress={() => {
            tap()
            onToggle?.()
          }}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'stretch' }}
        >
          <Disclosure open={open} size={14} color={c.muted} />
          <T size={font.control} weight="600" tone="muted">
            {title}{' '}
            <T size={font.control} tone="placeholder">
              {count}
            </T>
          </T>
        </Pressable>
        {action ? (
          <IconButton icon={action.icon} label={action.label} size={30} tone="muted" onPress={action.onPress} />
        ) : null}
      </View>
      {count && open ? <Card>{children}</Card> : null}
    </View>
  )
}

export default function SourceControl() {
  const { c } = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardInset()
  const { id } = useLocalSearchParams<{ id: string }>()
  const chat = useChat(id)
  const store = useStore()
  const project = store.projects.find((p) => p.id === chat?.projectId)
  const [bindings, setBindings] = useState<RepositoryBinding[]>([])
  const repos = bindings.filter((b) => !b.folderOnly).map((b) => b.repoName)
  const [repo, setRepo] = useState('')
  const binding = bindings.find((b) => b.repoName === repo)
  const [files, setFiles] = useState<FileState[]>([])
  const [branch, setBranch] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [ahead, setAhead] = useState(0)
  const [behind, setBehind] = useState(0)
  const [published, setPublished] = useState(false)
  const [hasConflicts, setHasConflicts] = useState(false)
  const [head, setHead] = useState<string | null>(null)
  const openFile = useOpenFile(chat)
  const [commits, setCommits] = useState<GitCommitInfo[]>([])
  const [stashes, setStashes] = useState<GitStashInfo[]>([])
  const [message, setMessage] = useState('')
  const [draft, setDraft] = useState<CommitDraft | null>(null)
  const [action, setAction] = useState<CommitAction>('commit')
  const [tab, setTab] = useState<'changes' | 'commits' | 'stashes'>('changes')
  const [filter, setFilter] = useState('')
  const [folded, setFolded] = useState<{ staged?: boolean; changes?: boolean }>({})
  const [sheet, setSheet] = useState<'repo' | 'branch' | 'action' | 'menu' | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current)
    },
    [],
  )
  useEffect(() => {
    let canceled = false
    if (chat?.taskId)
      store
        .invoke(chat.computerId, 'tasks.bindings', chat.taskId)
        .then((list) => {
          if (!canceled) {
            setBindings(list)
            setRepo(list.find((b) => !b.folderOnly)?.repoName ?? '')
          }
        })
        .catch((e) => setToast(String(e.message)))
    return () => {
      canceled = true
    }
  }, [chat?.computerId, chat?.taskId])
  const read = async () => {
    if (!chat || !binding) return
    const args = [chat.taskId, binding.repoId] as const
    const [status, history, branchList, stashList] = await Promise.all([
      store.invoke(chat.computerId, 'git.status', ...args),
      store.invoke(chat.computerId, 'git.history', ...args),
      store.invoke(chat.computerId, 'git.branches', ...args),
      store.invoke(chat.computerId, 'git.stashes', ...args),
    ])
    setBranch(status.branch ?? '(detached)')
    setHasConflicts(status.entries.some((entry) => entry.staged === 'unmerged' || entry.unstaged === 'unmerged'))
    setHead(status.oid)
    setAhead(status.ahead)
    setBehind(status.behind)
    setPublished(Boolean(status.upstream))
    setBranches(branchList.map((b) => b.name))
    setCommits(
      history.map((h) => ({ oid: h.oid, subject: h.subject, author: h.author, at: h.timestamp, pushed: !h.outgoing })),
    )
    setStashes(stashList)
    setFiles(
      status.entries.flatMap((e) =>
        [true, false].flatMap((staged) => {
          const state = staged ? e.staged : e.unstaged
          return state
            ? [
                {
                  path: e.path,
                  repo,
                  staged,
                  status:
                    state === 'added' || state === 'untracked'
                      ? ('added' as const)
                      : state === 'deleted'
                        ? ('deleted' as const)
                        : ('modified' as const),
                  additions: 0,
                  deletions: 0,
                  lines: [],
                },
              ]
            : []
        }),
      ),
    )
  }
  useEffect(() => {
    let alive = true
    if (binding && !binding.notGit) void read().catch((e) => alive && setToast(e.message))
    return () => {
      alive = false
    }
  }, [chat?.computerId, chat?.taskId, binding?.repoId])
  const mine = files.filter((f) => f.repo === repo)
  const staged = mine.filter((f) => f.staged === true)
  const unstaged = mine.filter((f) => f.staged === false)
  const changes: FileState[] = unstaged
  const changeCount = mine.length
  const needle = filter.trim().toLowerCase()
  const shownStaged = needle ? staged.filter((f) => f.path.toLowerCase().includes(needle)) : staged
  const shownUnstaged = needle ? changes.filter((f) => f.path.toLowerCase().includes(needle)) : changes
  const say = (text: string) => {
    setToast(text)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 5000)
  }
  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (running.current) return
    running.current = true
    setBusy(true)
    try {
      await fn()
      await read()
      say(done)
    } catch (error) {
      await read().catch(() => {})
      say(error instanceof Error ? error.message : String(error))
    } finally {
      running.current = false
      setBusy(false)
    }
  }
  const call = (method: 'git.stage' | 'git.unstage' | 'git.discard', paths: string[]) => {
    if (!chat || !binding) throw new Error('Select a repository first.')
    return store.invoke(chat.computerId, method, chat.taskId, binding.repoId, paths)
  }
  const setStaged = (paths: string[], value: boolean) =>
    void run(() => call(value ? 'git.stage' : 'git.unstage', paths), value ? 'Staged changes' : 'Unstaged changes')
  const discard = (targets: FileState[]) =>
    void run(async () => {
      if (!chat || !binding || !targets.length) return
      const paths = targets.map((f) => f.path)
      const preview = await store.invoke(chat.computerId, 'git.discardPreview', chat.taskId, binding.repoId, paths)
      Alert.alert(
        'Discard changes?',
        `${store.computers.find((c) => c.id === chat.computerId)?.name} · ${binding.cwd}\n\n${preview.files.map((f) => `${f.path}${f.untracked ? ' (permanently delete)' : ' (restore)'}`).join('\n')}`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard',
            style: 'destructive',
            onPress: () =>
              void run(
                () =>
                  store.invoke(chat.computerId, 'git.discard', chat.taskId, binding.repoId, paths, preview.fingerprint),
                'Discarded changes',
              ),
          },
        ],
      )
    }, 'Review discard preview')
  const syncRepo = async () => {
    if (!chat || !binding) throw new Error('Select a repository first.')
    try {
      await store.invoke(chat.computerId, 'git.sync', chat.taskId, binding.repoId)
    } catch (error) {
      const approval = readSyncConfirmation(error)
      if (!approval) throw error
      const approved = await new Promise<boolean>((resolve) =>
        Alert.alert(
          'Push to a protected branch?',
          `${binding.repoName} · ${approval.branch} → ${approval.targetBranch}`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Sync anyway', onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        ),
      )
      if (!approved) throw new Error('Sync cancelled. Nothing was pushed.', { cause: error })
      await store.invoke(chat.computerId, 'git.sync', chat.taskId, binding.repoId, approval)
    }
  }
  const sync = () => void run(syncRepo, 'Synced changes')
  const generate = async () => {
    if (hasConflicts) throw new Error('Resolve conflicts before committing.')
    if (!chat || !binding) throw new Error('Select a repository first.')
    const result = await draftCommit(
      store.invoke,
      chat,
      binding.repoId,
      !staged.length ? unstaged.map((f) => f.path) : undefined,
    )
    setDraft(result)
    setMessage(result.message)
    return result
  }
  const commit = () =>
    void run(async () => {
      if (hasConflicts) throw new Error('Resolve conflicts before committing.')
      if (!chat || !binding) throw new Error('Select a repository first.')
      if (!staged.length && unstaged.length)
        await call(
          'git.stage',
          unstaged.map((f) => f.path),
        )
      const generated = !message.trim() ? await generate() : null
      const subject = message.trim() || generated!.message
      await store.invoke(
        chat.computerId,
        'git.commit',
        chat.taskId,
        binding.repoId,
        subject,
        generated?.fingerprint ?? (draft?.message === subject ? draft.fingerprint : undefined),
        action === 'amend' ? (head ?? undefined) : undefined,
        action === 'branch'
          ? {
              expectedBranch: branch === '(detached)' ? null : branch,
              newBranch: `ramu/${subject
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .slice(0, 24)}`,
            }
          : undefined,
      )
      setMessage('')
      setDraft(null)
      if (action === 'push' || action === 'sync')
        if (action === 'push') await store.invoke(chat.computerId, 'git.push', chat.taskId, binding.repoId)
        else await syncRepo()
    }, 'Commit completed')
  const label = ACTIONS.find((a) => a.key === action)!.label
  const gitAction = (
    method:
      | 'git.fetch'
      | 'git.push'
      | 'git.pull'
      | 'git.popStash'
      | 'git.applyStash'
      | 'git.dropStash'
      | 'git.createBranch'
      | 'git.checkout'
      | 'git.stash'
      | 'git.undoCommit',
    argument?: string,
    stagedOnly?: boolean,
  ) => {
    if (!chat || !binding) throw new Error('Select a repository first.')
    const pc = chat.computerId,
      task = chat.taskId,
      repoId = binding.repoId
    if (method === 'git.stash') return store.invoke(pc, method, task, repoId, argument ?? '', stagedOnly)
    if (
      method === 'git.popStash' ||
      method === 'git.applyStash' ||
      method === 'git.dropStash' ||
      method === 'git.createBranch' ||
      method === 'git.checkout' ||
      method === 'git.undoCommit'
    )
      return store.invoke(pc, method, task, repoId, argument!)
    return store.invoke(pc, method, task, repoId)
  }
  const menu: ({ icon: Icon; label: string; onPress: () => void; danger?: boolean } | 'sep')[] = [
    { icon: RefreshCcw, label: 'Refresh', onPress: () => void run(read, 'Refreshed') },
    {
      icon: Plus,
      label: 'Stage all changes',
      onPress: () =>
        setStaged(
          unstaged.map((f) => f.path),
          true,
        ),
    },
    {
      icon: Minus,
      label: 'Unstage all changes',
      onPress: () =>
        setStaged(
          staged.map((f) => f.path),
          false,
        ),
    },
    { icon: Trash2, label: 'Discard all unstaged changes…', danger: true, onPress: () => discard(unstaged) },
    {
      icon: Undo2,
      label: 'Undo last commit…',
      onPress: () =>
        Alert.alert(
          'Undo last commit?',
          `${binding?.cwd}\n${commits[0]?.subject ?? ''}\nIts changes return to the working tree.`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Undo', onPress: () => void run(() => gitAction('git.undoCommit', head ?? ''), 'Undid commit') },
          ],
        ),
    },
    'sep',
    { icon: GitBranchPlus, label: 'Create branch…', onPress: () => setSheet('branch') },
    {
      icon: Archive,
      label: 'Stash all changes',
      onPress: () => void run(() => gitAction('git.stash', `WIP on ${branch}`), 'Stashed'),
    },
    {
      icon: Archive,
      label: 'Stash staged changes',
      onPress: () => void run(() => gitAction('git.stash', `WIP on ${branch}`, true), 'Stashed'),
    },
    {
      icon: ArchiveRestore,
      label: 'Pop latest stash',
      onPress: () => stashes[0] && void run(() => gitAction('git.popStash', stashes[0]!.oid), 'Popped stash'),
    },
    'sep',
    { icon: RefreshCcw, label: 'Sync changes', onPress: sync },
    { icon: ArrowDown, label: 'Pull (rebase)', onPress: () => void run(() => gitAction('git.pull'), 'Pulled') },
    { icon: ArrowUp, label: 'Push', onPress: () => void run(() => gitAction('git.push'), 'Pushed') },
    { icon: CloudDownload, label: 'Fetch', onPress: () => void run(() => gitAction('git.fetch'), 'Fetched') },
  ]

  return (
    <Screen bg="canvas">
      <Header
        title="Source Control"
        subtitle={
          project ? `${project.name} · ${chat?.mode === 'worktree' ? 'worktree' : 'current checkout'}` : undefined
        }
        right={<HeaderButton icon={Ellipsis} label="Source control actions" onPress={() => setSheet('menu')} />}
      />
      {/* The commit box rides the keyboard like the thread composer: padding measured from the screen's bottom edge. */}
      <View style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: space.xl }}
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets={false}
          keyboardDismissMode="on-drag"
        >
          {!binding ? (
            <T tone="muted">No repository is attached to this thread.</T>
          ) : binding.notGit ? (
            <Row
              onPress={() =>
                void run(
                  () => store.invoke(chat!.computerId, 'git.init', chat!.taskId, binding.repoId),
                  'Initialized repository',
                )
              }
            >
              <T>Initialize Git in {binding.cwd}</T>
            </Row>
          ) : null}
          {/* One picker instead of tabs: a workspace project can hold any number of repositories. */}
          {repos.length > 1 ? (
            <Pressable
              onPress={() => {
                tap()
                setSheet('repo')
              }}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                height: 44,
                paddingHorizontal: space.m,
                borderRadius: radius.m,
                backgroundColor: pressed ? c.raised : c.raised2,
              })}
            >
              <FolderGit2 size={15} color={c.soft} />
              <T weight="600" numberOfLines={1} style={{ flexShrink: 1 }}>
                {repo}
              </T>
              <T size={font.caption} tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                {changeCount ? `${changeCount} change${changeCount === 1 ? '' : 's'}` : 'no changes'} · {repos.length}{' '}
                repositories
              </T>
              <ChevronDown size={15} color={c.muted} />
            </Pressable>
          ) : null}

          {/* Branch picker and sync, like the desktop's Git controls. */}
          <View style={{ flexDirection: 'row', gap: space.s }}>
            <Pressable
              onPress={() => {
                tap()
                setSheet('branch')
              }}
              style={({ pressed }) => ({
                flex: 1,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.s,
                height: 44,
                paddingHorizontal: space.m,
                borderRadius: radius.m,
                backgroundColor: pressed ? c.raised : c.raised2,
              })}
            >
              <GitBranch size={15} color={c.soft} />
              <T weight="500" numberOfLines={1} style={{ flex: 1 }}>
                {branch}
              </T>
              <ChevronDown size={15} color={c.muted} />
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => {
                tap()
                if (published) sync()
                else void run(() => gitAction('git.push'), `Published ${branch} to origin`)
              }}
              accessibilityLabel={published ? 'Sync changes' : 'Publish branch'}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 44,
                paddingHorizontal: space.m,
                borderRadius: radius.m,
                backgroundColor: pressed ? c.raised : c.raised2,
                opacity: busy ? 0.6 : 1,
              })}
            >
              {published ? <RefreshCcw size={15} color={c.soft} /> : <CloudUpload size={15} color={c.soft} />}
              <T size={font.control} weight="500" tone="soft" style={{ fontVariant: ['tabular-nums'] }}>
                {published ? `${behind}↓ ${ahead}↑` : 'Publish'}
              </T>
            </Pressable>
          </View>

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { key: 'changes', label: 'Changes', count: changeCount },
              { key: 'commits', label: 'Commits', count: commits.length },
              { key: 'stashes', label: 'Stashes', count: stashes.length },
            ]}
          />
          {tab === 'changes' ? (
            <>
              {
                <Group
                  title="Staged Changes"
                  count={shownStaged.length}
                  open={!folded.staged}
                  onToggle={() => setFolded((f) => ({ ...f, staged: !f.staged }))}
                  action={
                    staged.length
                      ? {
                          icon: Minus,
                          label: 'Unstage all changes',
                          onPress: () =>
                            setStaged(
                              staged.map((f) => f.path),
                              false,
                            ),
                        }
                      : undefined
                  }
                >
                  {shownStaged.map((f, i) => (
                    <View key={f.path}>
                      {i ? <Divider inset={space.m} /> : null}
                      <FileRow
                        file={f}
                        onOpen={() => openFile.open(binding!.repoId, f.path, { mode: 'staged' })}
                        onStage={() => setStaged([f.path], false)}
                      />
                    </View>
                  ))}
                </Group>
              }

              <Group
                title="Changes"
                count={shownUnstaged.length}
                open={!folded.changes}
                onToggle={() => setFolded((f) => ({ ...f, changes: !f.changes }))}
                action={
                  unstaged.length
                    ? {
                        icon: Plus,
                        label: 'Stage all changes',
                        onPress: () =>
                          setStaged(
                            unstaged.map((f) => f.path),
                            true,
                          ),
                      }
                    : undefined
                }
              >
                {shownUnstaged.map((f, i) => (
                  <View key={f.path}>
                    {i ? <Divider inset={space.m} /> : null}
                    <FileRow
                      file={f}
                      onOpen={() => openFile.open(binding!.repoId, f.path, { mode: 'changes' })}
                      onStage={() => setStaged([f.path], true)}
                      onDiscard={unstaged.some((entry) => entry.path === f.path) ? () => discard([f]) : undefined}
                    />
                  </View>
                ))}
              </Group>
              {needle && !shownStaged.length && !shownUnstaged.length ? (
                <T tone="muted">No changed file matches.</T>
              ) : null}
              {!changeCount ? <T tone="muted">No changes in this checkout.</T> : null}
            </>
          ) : null}
          {tab !== 'changes' ? (
            <View style={{ gap: space.s }}>
              <Card>
                {tab === 'commits' ? (
                  commits.map((x, i) => (
                    <View key={x.oid}>
                      {i ? <Divider inset={space.m} /> : null}
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.m, padding: space.m }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            borderWidth: 1.5,
                            borderColor: x.pushed ? c.muted : c.accent,
                            backgroundColor: x.pushed ? 'transparent' : c.accent,
                          }}
                        />
                        <View style={{ flex: 1, gap: 2 }}>
                          <T size={font.body - 1} numberOfLines={1}>
                            {x.subject}
                          </T>
                          <T size={font.caption} tone="muted">
                            {x.author} · {ago(x.at)} {x.pushed ? '' : '· not pushed'}
                          </T>
                        </View>
                        <T size={font.caption} mono tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
                          {x.oid.slice(0, 7)}
                        </T>
                        <IconButton
                          icon={Copy}
                          label="Copy commit message"
                          size={32}
                          tone="muted"
                          onPress={() => {
                            void Clipboard.setStringAsync(x.subject)
                            setToast('Copied commit message')
                          }}
                        />
                      </View>
                    </View>
                  ))
                ) : stashes.length ? (
                  stashes.map((s, i) => (
                    <View key={s.ref + i}>
                      {i ? <Divider inset={space.m} /> : null}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.s,
                          paddingLeft: space.m,
                          paddingRight: 4,
                          minHeight: 50,
                        }}
                      >
                        <View style={{ flex: 1 }}>
                          <T size={font.body - 1} numberOfLines={1}>
                            {s.subject}
                          </T>
                          <T size={font.caption} mono tone="muted">
                            {s.ref}
                          </T>
                        </View>
                        <IconButton
                          icon={Copy}
                          label={`Apply ${s.ref}`}
                          size={34}
                          tone="soft"
                          onPress={() =>
                            void run(() => gitAction('git.applyStash', s.oid), `Applied ${s.ref} (kept the stash)`)
                          }
                        />
                        <IconButton
                          icon={ArchiveRestore}
                          label={`Pop ${s.ref}`}
                          size={34}
                          tone="soft"
                          onPress={() => void run(() => gitAction('git.popStash', s.oid), `Popped ${s.ref}`)}
                        />
                        <IconButton
                          icon={Trash2}
                          label="Delete stash"
                          size={34}
                          tone="muted"
                          onPress={() =>
                            Alert.alert('Delete stash?', s.subject, [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Delete',
                                style: 'destructive',
                                onPress: () => void run(() => gitAction('git.dropStash', s.oid), 'Deleted stash'),
                              },
                            ])
                          }
                        />
                      </View>
                    </View>
                  ))
                ) : (
                  <T size={font.control} tone="muted" style={{ padding: space.m }}>
                    No saved stashes.
                  </T>
                )}
              </Card>
            </View>
          ) : null}
        </ScrollView>
        {tab === 'changes' && binding && !binding.notGit ? (
          <View
            style={{
              backgroundColor: c.canvas,
              borderTopWidth: 0.5,
              borderTopColor: c.lineStrong,
              paddingHorizontal: space.l,
              paddingTop: space.s,
              paddingBottom: keyboard ? keyboard + space.s : Math.max(insets.bottom, space.s),
            }}
          >
            <View style={{ gap: space.s }}>
              <View style={{ backgroundColor: c.raised2, borderRadius: radius.m }}>
                <TextInput
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  placeholder="Message (empty drafts one with AI)"
                  placeholderTextColor={c.placeholder}
                  style={{
                    color: c.text,
                    fontSize: font.body,
                    minHeight: 48,
                    maxHeight: 140,
                    padding: space.m,
                    paddingRight: 44,
                  }}
                />
                <View style={{ position: 'absolute', right: 4, top: 4 }}>
                  <IconButton
                    icon={Sparkles}
                    label="Draft a commit message from staged changes"
                    size={34}
                    tone="accent"
                    onPress={() => void run(generate, 'Drafted commit message')}
                  />
                </View>
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  height: 44,
                  borderRadius: radius.m,
                  overflow: 'hidden',
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    tap()
                    commit()
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space.s,
                    backgroundColor: c.primary,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Check size={16} color={c.primaryInk} strokeWidth={2.2} />
                  <T weight="600" style={{ color: c.primaryInk }}>
                    {busy ? 'Working…' : label}
                  </T>
                </Pressable>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
                <Pressable
                  accessibilityLabel="Commit options"
                  onPress={() => {
                    tap()
                    setSheet('action')
                  }}
                  style={({ pressed }) => ({
                    width: 46,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: c.primary,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <ChevronDown size={17} color={c.primaryInk} />
                </Pressable>
              </View>
              <T size={font.caption} tone="muted" style={{ paddingHorizontal: 2 }}>
                {staged.length
                  ? `Commits ${staged.length} staged file${staged.length === 1 ? '' : 's'}.`
                  : unstaged.length
                    ? `Nothing staged: stages and commits all ${unstaged.length} change${unstaged.length === 1 ? '' : 's'}.`
                    : 'No changes in this checkout.'}
              </T>
            </View>
          </View>
        ) : null}
      </View>

      {toast ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: space.l, right: space.l, bottom: Math.max(insets.bottom, space.m) }}
        >
          <Glass
            radius={radius.full}
            style={{
              paddingHorizontal: space.l,
              paddingVertical: space.m,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              backgroundColor: floatingChrome ? undefined : c.raised,
            }}
          >
            <Check size={15} color={c.ok} />
            <T size={font.control} weight="500" numberOfLines={2} style={{ flex: 1 }}>
              {toast}
            </T>
          </Glass>
        </View>
      ) : null}

      <Sheet open={sheet === 'repo'} onClose={() => setSheet(null)} title="Repository">
        {[...repos]
          .sort((a, b) => files.filter((f) => f.repo === b).length - files.filter((f) => f.repo === a).length)
          .map((r) => {
            const n = files.filter((f) => f.repo === r).length
            return (
              <Row
                key={r}
                onPress={() => {
                  setRepo(r)
                  setSheet(null)
                }}
              >
                <FolderGit2 size={17} color={c.soft} />
                <View style={{ flex: 1 }}>
                  <T weight={r === repo ? '600' : '400'} numberOfLines={1}>
                    {r}
                  </T>
                  <T size={font.caption} tone="muted" numberOfLines={1}>
                    {project?.root ? `${project.root}/${r}` : r}
                  </T>
                </View>
                {n ? (
                  <Pill tone="warn" wash={c.warnWash}>
                    {String(n)}
                  </Pill>
                ) : null}
                {r === repo ? <Check size={16} color={c.accent} /> : <View style={{ width: 16 }} />}
              </Row>
            )
          })}
      </Sheet>

      <Sheet open={sheet === 'branch'} onClose={() => setSheet(null)} title="Switch branch">
        {branches.map((b) => (
          <Row
            key={b}
            onPress={() => {
              setSheet(null)
              if (b !== branch) void run(() => gitAction('git.checkout', b), `Switched to ${b}`)
            }}
          >
            <GitBranch size={16} color={c.soft} />
            <T style={{ flex: 1 }} weight={b === branch ? '600' : '400'} numberOfLines={1}>
              {b}
            </T>
            {b === branch ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
        <Row
          onPress={() => {
            setSheet(null)
            const create = (name?: string) =>
              name?.trim() && void run(() => gitAction('git.createBranch', name.trim()), `Created ${name.trim()}`)
            if (Platform.OS === 'ios') Alert.prompt('Create branch', `From ${branch}`, create, 'plain-text', 'ramu/')
            else create(`ramu/branch-${Date.now().toString(36).slice(-4)}`)
          }}
        >
          <GitBranchPlus size={16} color={c.accent} />
          <T tone="accent" weight="500">
            Create branch…
          </T>
        </Row>
      </Sheet>

      <Sheet open={sheet === 'action'} onClose={() => setSheet(null)} title="Commit">
        {ACTIONS.map((a) => (
          <Row
            key={a.key}
            onPress={() => {
              setAction(a.key)
              setSheet(null)
            }}
          >
            <T style={{ flex: 1 }} weight={a.key === action ? '600' : '400'}>
              {a.label}
            </T>
            {a.key === action ? <Check size={16} color={c.accent} /> : null}
          </Row>
        ))}
      </Sheet>

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title="Source control">
        {menu.map((m, i) =>
          m === 'sep' ? (
            <Divider key={i} inset={space.l} />
          ) : (
            <Row
              key={m.label}
              onPress={() => {
                setSheet(null)
                setTimeout(m.onPress, 300)
              }}
            >
              <m.icon size={17} color={m.danger ? c.bad : c.soft} />
              <T tone={m.danger ? 'bad' : 'text'}>{m.label}</T>
            </Row>
          ),
        )}
      </Sheet>
      {tab === 'changes' && changeCount > 8 ? (
        <BottomSearch value={filter} onChangeText={setFilter} placeholder={`Filter ${changeCount} files`} />
      ) : null}
    </Screen>
  )
}
