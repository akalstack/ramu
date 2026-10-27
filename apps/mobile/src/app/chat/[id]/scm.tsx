import { translate } from '@ramu/shared/i18n'
import { BottomSearch } from '../../../components/BottomSearch'
import { readSyncConfirmation } from '@ramu/shared/protectedBranch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Pressable, TextInput, View } from 'react-native'
import { useKeyboardInset } from '../../../components/Keyboard'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CloudDownload,
  CloudUpload,
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
import type { RepositoryBinding, GitStash, CommitDraft, GitStatus } from '@ramu/shared/types'
import { validBranchName } from '@ramu/shared/workspaceDefaults'
interface GitCommitInfo {
  oid: string
  subject: string
  author: string
  at: number
  pushed: boolean
}
type GitStashInfo = GitStash
import { draftCommit } from '../../../runtime/gitQuick'
import { commitBlock, gitGates, startingAction, type CommitAction } from '../../../runtime/gitGates'
import { revisionParams, stashTitle } from '../../../runtime/gitRevision'
import { ago, useSay } from '../../../i18n'
import { useOpenFile } from '../../../runtime/openFile'
import { Disclosure } from '../../../components/Motion'
import { Header, HeaderButton, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { Glass, floatingChrome } from '../../../components/Glass'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import {
  Button,
  Card,
  Divider,
  IconButton,
  Pill,
  Row,
  Segmented,
  Sheet,
  T,
  tap,
  type Icon,
} from '../../../components/ui'

// Mirrors the desktop Source Control panel (apps/web/src/sidebar/ScmPanel.tsx) per repository:
// branch picker + sync, commit box with a Commit & Push split button, Staged / Changes groups,
// and the Git section with Commits and Stashes. All actions run on the selected host.

const ACTIONS: { key: CommitAction; label: string; help: string }[] = [
  { key: 'commit', label: 'Commit', help: 'Save the changes to this branch.' },
  { key: 'push', label: 'Commit & Push', help: 'Commit, then push the branch.' },
  { key: 'sync', label: 'Commit & Sync', help: 'Commit, then pull and push.' },
  { key: 'amend', label: 'Commit (Amend)', help: 'Fold the changes into the last commit.' },
  { key: 'branch', label: 'Commit on new branch', help: 'Put the commit on a new branch and leave this one.' },
]

interface FileState extends ChangedFile {
  staged: boolean | 'all'
}

/** `ramu/` plus a short slug of the commit subject; a subject with nothing usable in it gets a random suffix. */
function newBranchName(subject: string) {
  const slug = subject
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/, '')
  return `ramu/${slug || `commit-${Date.now().toString(36).slice(-4)}`}`
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
  const tr = useSay()
  const router = useRouter()
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
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const actionPicked = useRef(false)
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
  const [sheet, setSheet] = useState<'repo' | 'branch' | 'newBranch' | 'action' | 'menu' | null>(null)
  const [branchName, setBranchName] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [toast, setToast] = useState<{ text: string; failed: boolean } | null>(null)
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
        .catch((e) => setToast({ text: String(e.message), failed: true }))
    return () => {
      canceled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, chat?.taskId] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, chat?.taskId])
  const readRef = useRef<() => Promise<void>>(async () => {})
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
    setGitStatus(status)
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
  readRef.current = read
  useEffect(() => {
    let alive = true
    if (binding && !binding.notGit) void read().catch((e) => alive && setToast({ text: e.message, failed: true }))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [chat?.computerId, chat?.taskId, binding?.repoId] by design; the values it reads beyond these are current as of that run
  }, [chat?.computerId, chat?.taskId, binding?.repoId])
  // Coming back from a commit or stash screen (where a stash may have been popped), and while the host's files change:
  // the agent or the desktop edits, stages or commits, as the desktop's panel follows.
  const focused = useRef(false)
  useFocusEffect(
    useCallback(() => {
      if (!chat || !binding || binding.notGit) return
      if (focused.current) void readRef.current().catch(() => {})
      focused.current = true
      let timer: ReturnType<typeof setTimeout> | undefined
      const unwatch = store.watch(chat.computerId, ['fs:changed'])
      const off = store.subscribe(chat.computerId, (channel, payload) => {
        if (channel !== 'fs:changed' || payload.cwd !== binding.cwd || running.current) return
        clearTimeout(timer)
        timer = setTimeout(() => void readRef.current().catch(() => {}), 400)
      })
      return () => {
        clearTimeout(timer)
        off()
        unwatch()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputes on [chat?.computerId, binding?.repoId, binding?.cwd] by design; the values it reads beyond these are current as of that run
    }, [chat?.computerId, binding?.repoId, binding?.cwd]),
  )
  const mine = files.filter((f) => f.repo === repo)
  const staged = mine.filter((f) => f.staged === true)
  const unstaged = mine.filter((f) => f.staged === false)
  const changes: FileState[] = unstaged
  const changeCount = mine.length
  const needle = filter.trim().toLowerCase()
  const shownStaged = needle ? staged.filter((f) => f.path.toLowerCase().includes(needle)) : staged
  const shownUnstaged = needle ? changes.filter((f) => f.path.toLowerCase().includes(needle)) : changes
  const gates = gitGates(gitStatus, commits.length)
  const loaded = gitStatus !== null
  // The computer's own default (Commit, Commit & Push or Commit & Sync) until you pick another here.
  const savedAction = store.appPreferences[chat?.computerId ?? '']?.defaultCommitAction
  useEffect(() => {
    if (gitStatus && !actionPicked.current) setAction(startingAction(savedAction, gates))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [loaded, savedAction, gates.canRemote] by design; the values it reads beyond these are current as of that run
  }, [loaded, savedAction, gates.canRemote])
  const notify = (text: string, failed = false) => {
    setToast({ text, failed })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), failed ? 8000 : 5000)
  }
  const say = (text: string) => notify(tr(text))
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
      notify(error instanceof Error ? error.message : String(error), true)
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
  const continueOperation = (method: 'git.continueOperation' | 'git.abortOperation') => {
    if (!chat || !binding) throw new Error('Select a repository first.')
    return store.invoke(chat.computerId, method, chat.taskId, binding.repoId)
  }
  const generate = async () => {
    if (gates.operation || gates.conflicts)
      throw new Error(
        tr(gates.operation ? 'Finish the rebase or merge in progress first.' : 'Resolve conflicts before committing.'),
      )
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
      const blocked = commitBlock(action, gates, changeCount, !!head)
      if (blocked) throw new Error(tr(blocked))
      if (!chat || !binding) throw new Error('Select a repository first.')
      if (!staged.length && unstaged.length)
        await call(
          'git.stage',
          unstaged.map((f) => f.path),
        )
      // Amending without a new message keeps the one the commit has; everything else drafts one.
      const reused = action === 'amend' && !message.trim() ? commits[0]?.subject : undefined
      const generated = !message.trim() && !reused ? await generate() : null
      const subject = message.trim() || reused || generated!.message
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
              newBranch: newBranchName(subject),
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
  const blocked = gates.syncOnly ? null : commitBlock(action, gates, changeCount, !!head)
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
  const openRevision = (
    revision: { oid: string; stash: boolean },
    info: { subject: string; author?: string; at?: number; ref?: string },
  ) => {
    if (!chat || !binding) return
    tap()
    router.push({
      pathname: '/chat/[id]/revision',
      params: {
        id: chat.id,
        repoId: binding.repoId,
        repoName: binding.repoName,
        ...revisionParams(revision),
        subject: info.subject,
        ...(info.author ? { author: info.author } : {}),
        ...(info.at ? { at: String(info.at) } : {}),
        ...(info.ref ? { ref: info.ref } : {}),
      },
    })
  }
  type MenuItem = { icon: Icon; label: string; onPress: () => void; danger?: boolean; off?: string }
  const confirmUndo = () =>
    Alert.alert(
      tr('Undo last commit?'),
      `${binding?.cwd}\n${commits[0]?.subject ?? ''}\n${tr('Its changes return to the working tree.')}`,
      [
        { text: tr('Cancel'), style: 'cancel' },
        { text: tr('Undo'), onPress: () => void run(() => gitAction('git.undoCommit', head ?? ''), 'Undid commit') },
      ],
    )
  const offline = gates.operation ? 'Finish the rebase or merge in progress first.' : 'This branch has no remote.'
  // Each section is one card in the sheet; an item that cannot run now says why instead of disappearing.
  const menu: { title: string; items: MenuItem[] }[] = [
    {
      title: 'Changes',
      items: [
        { icon: RefreshCcw, label: 'Refresh', onPress: () => void run(read, 'Refreshed') },
        {
          icon: Plus,
          label: 'Stage all changes',
          off: unstaged.length ? undefined : 'Nothing to stage.',
          onPress: () =>
            setStaged(
              unstaged.map((f) => f.path),
              true,
            ),
        },
        {
          icon: Minus,
          label: 'Unstage all changes',
          off: staged.length ? undefined : 'Nothing is staged.',
          onPress: () =>
            setStaged(
              staged.map((f) => f.path),
              false,
            ),
        },
        {
          icon: Trash2,
          label: 'Discard all unstaged changes…',
          danger: true,
          off: unstaged.length ? undefined : 'Nothing to discard.',
          onPress: () => discard(unstaged),
        },
        {
          icon: Undo2,
          label: 'Undo last commit…',
          off: gates.canUndo
            ? undefined
            : commits.length < 2
              ? 'There is no earlier commit to return to.'
              : gates.operation || gates.conflicts
                ? 'Resolve the repository state first.'
                : 'This commit is already on the remote.',
          onPress: confirmUndo,
        },
      ],
    },
    {
      title: 'Branch and stash',
      items: [
        { icon: GitBranchPlus, label: 'Create branch…', onPress: () => setSheet('newBranch') },
        {
          icon: Archive,
          label: 'Stash all changes',
          off: changeCount ? undefined : 'Nothing to stash.',
          onPress: () => void run(() => gitAction('git.stash', `WIP on ${branch}`), 'Stashed'),
        },
        {
          icon: Archive,
          label: 'Stash staged changes',
          off: staged.length ? undefined : 'Nothing is staged.',
          onPress: () => void run(() => gitAction('git.stash', `WIP on ${branch}`, true), 'Stashed'),
        },
        {
          icon: ArchiveRestore,
          label: 'Pop latest stash',
          off: stashes.length ? undefined : 'There are no stashes.',
          onPress: () => void run(() => gitAction('git.popStash', stashes[0]!.oid), 'Popped stash'),
        },
      ],
    },
    {
      title: 'Remote',
      items: [
        { icon: RefreshCcw, label: 'Sync changes', off: gates.canRemote ? undefined : offline, onPress: sync },
        {
          icon: ArrowDown,
          label: 'Pull (rebase)',
          off: gates.canRemote ? undefined : offline,
          onPress: () => void run(() => gitAction('git.pull'), 'Pulled'),
        },
        {
          icon: ArrowUp,
          label: 'Push',
          off: gates.canRemote ? undefined : offline,
          onPress: () => void run(() => gitAction('git.push'), 'Pushed'),
        },
        {
          icon: CloudDownload,
          label: 'Fetch',
          off: gates.canRemote ? undefined : offline,
          onPress: () => void run(() => gitAction('git.fetch'), 'Fetched'),
        },
      ],
    },
  ]
  const createBranch = () => {
    const name = branchName.trim()
    if (!validBranchName(name)) return
    setSheet(null)
    setBranchName('')
    void run(() => gitAction('git.createBranch', name), `Created ${name}`)
  }

  return (
    <Screen bg="canvas">
      <Header
        title={tr('Source Control')}
        subtitle={
          project ? `${project.name} · ${chat?.mode === 'worktree' ? 'worktree' : 'current checkout'}` : undefined
        }
        right={<HeaderButton icon={Ellipsis} label={tr('Source control actions')} onPress={() => setSheet('menu')} />}
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
              disabled={busy || !gates.canRemote}
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
                opacity: busy || !gates.canRemote ? 0.5 : 1,
              })}
            >
              {published ? <RefreshCcw size={15} color={c.soft} /> : <CloudUpload size={15} color={c.soft} />}
              <T size={font.control} weight="500" tone="soft" style={{ fontVariant: ['tabular-nums'] }}>
                {published ? `${behind}↓ ${ahead}↑` : 'Publish'}
              </T>
            </Pressable>
          </View>

          {gates.operation ? (
            <Card style={{ padding: space.l, gap: space.m, backgroundColor: c.warnWash }}>
              <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'flex-start' }}>
                <CircleAlert size={17} color={c.warn} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T weight="600">{tr(gates.operation === 'rebase' ? 'Rebase in progress' : 'Merge in progress')}</T>
                  <T size={font.control} tone="soft">
                    {gates.conflicts
                      ? tr(
                          gates.conflicts === 1
                            ? 'Resolve 1 conflicted file, stage it, then continue.'
                            : 'Resolve {count} conflicted files, stage them, then continue.',
                          { count: gates.conflicts },
                        )
                      : tr('Conflicts are resolved and staged.')}
                  </T>
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: space.s }}>
                <Button
                  title={tr('Continue')}
                  disabled={busy || gates.conflicts > 0}
                  style={{ flex: 1 }}
                  onPress={() => void run(() => continueOperation('git.continueOperation'), 'Continued')}
                />
                <Button
                  kind="secondary"
                  title={tr(gates.operation === 'rebase' ? 'Abort rebase' : 'Abort merge')}
                  disabled={busy}
                  style={{ flex: 1 }}
                  onPress={() =>
                    Alert.alert(
                      tr(gates.operation === 'rebase' ? 'Abort the rebase?' : 'Abort the merge?'),
                      tr('Your branch returns to how it was before it started.'),
                      [
                        { text: tr('Cancel'), style: 'cancel' },
                        {
                          text: tr('Abort'),
                          style: 'destructive',
                          onPress: () => void run(() => continueOperation('git.abortOperation'), 'Aborted'),
                        },
                      ],
                    )
                  }
                />
              </View>
            </Card>
          ) : null}
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
                  title={tr('Staged Changes')}
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
                title={tr('Changes')}
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
            <Card>
              {tab === 'commits' ? (
                commits.length ? (
                  commits.map((x, i) => (
                    <View key={x.oid}>
                      {i ? <Divider inset={space.l + 20} /> : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={tr('Open commit {hash}', { hash: x.oid.slice(0, 7) })}
                        onPress={() =>
                          openRevision({ oid: x.oid, stash: false }, { subject: x.subject, author: x.author, at: x.at })
                        }
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space.m,
                          paddingHorizontal: space.l,
                          paddingVertical: space.m,
                          minHeight: 56,
                          backgroundColor: pressed ? c.pressed : 'transparent',
                        })}
                      >
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
                          <T size={font.body - 1} weight="500" numberOfLines={1}>
                            {x.subject}
                          </T>
                          <T size={font.caption} tone="muted" numberOfLines={1}>
                            {x.author} · {ago(x.at)}
                            {x.pushed ? '' : ` · ${tr('not pushed')}`}
                          </T>
                        </View>
                        <T size={font.caption} mono tone="muted" numberOfLines={1} style={{ flexShrink: 0 }}>
                          {x.oid.slice(0, 7)}
                        </T>
                        <ChevronRight size={16} color={c.muted} />
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <T size={font.control} tone="muted" style={{ padding: space.l }}>
                    {tr('No commits yet.')}
                  </T>
                )
              ) : stashes.length ? (
                stashes.map((s, i) => (
                  <View key={s.oid + i}>
                    {i ? <Divider inset={space.l + 20} /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={tr('Open {ref}', { ref: s.ref })}
                      onPress={() => openRevision({ oid: s.oid, stash: true }, { subject: s.subject, ref: s.ref })}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.m,
                        paddingHorizontal: space.l,
                        paddingVertical: space.m,
                        minHeight: 56,
                        backgroundColor: pressed ? c.pressed : 'transparent',
                      })}
                    >
                      <Archive size={16} color={c.muted} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <T size={font.body - 1} weight="500" numberOfLines={1}>
                          {stashTitle(s.subject)}
                        </T>
                        <T size={font.caption} mono tone="muted" numberOfLines={1}>
                          {s.ref}
                        </T>
                      </View>
                      <ChevronRight size={16} color={c.muted} />
                    </Pressable>
                  </View>
                ))
              ) : (
                <T size={font.control} tone="muted" style={{ padding: space.l }}>
                  {tr('No saved stashes. Stash changes from the ⋯ menu to set them aside.')}
                </T>
              )}
            </Card>
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
                  placeholder={tr('Message (empty drafts one with AI)')}
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
                    label={tr('Draft a commit message from staged changes')}
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
                  disabled={busy || !!blocked}
                  accessibilityState={{ disabled: busy || !!blocked }}
                  onPress={() => {
                    tap()
                    if (!gates.syncOnly) commit()
                    else if (published) sync()
                    else void run(() => gitAction('git.push'), `Published ${branch} to origin`)
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    opacity: blocked ? 0.5 : pressed ? 0.85 : 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: space.s,
                    backgroundColor: c.primary,
                  })}
                >
                  {gates.syncOnly ? (
                    <RefreshCcw size={16} color={c.primaryInk} strokeWidth={2.2} />
                  ) : (
                    <Check size={16} color={c.primaryInk} strokeWidth={2.2} />
                  )}
                  <T weight="600" style={{ color: c.primaryInk }}>
                    {busy
                      ? tr('Working…')
                      : gates.syncOnly
                        ? published
                          ? `${tr('Sync changes')} ${behind}↓ ${ahead}↑`
                          : tr('Publish branch')
                        : tr(label)}
                  </T>
                </Pressable>
                <View style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.18)' }} />
                <Pressable
                  accessibilityLabel={tr('Commit options')}
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
              <T
                size={font.caption}
                tone={blocked && blocked !== 'No changes in this checkout.' ? 'warn' : 'muted'}
                style={{ paddingHorizontal: 2 }}
              >
                {blocked
                  ? tr(blocked)
                  : gates.syncOnly
                    ? published
                      ? tr('Everything is committed. Sync to match the remote.')
                      : tr('Everything is committed. Publish the branch to share it.')
                    : action === 'amend' && !changeCount
                      ? tr('Rewords the last commit with the message above.')
                      : staged.length
                        ? tr(staged.length === 1 ? 'Commits 1 staged file.' : 'Commits {count} staged files.', {
                            count: staged.length,
                          })
                        : tr(
                            unstaged.length === 1
                              ? 'Nothing staged: stages and commits the 1 change.'
                              : 'Nothing staged: stages and commits all {count} changes.',
                            { count: unstaged.length },
                          )}
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
            {toast.failed ? <CircleAlert size={15} color={c.bad} /> : <Check size={15} color={c.ok} />}
            <T size={font.control} weight="500" numberOfLines={3} accessibilityLiveRegion="polite" style={{ flex: 1 }}>
              {toast.text}
            </T>
          </Glass>
        </View>
      ) : null}

      <Sheet open={sheet === 'repo'} onClose={() => setSheet(null)} title={tr('Repository')}>
        <SheetGroup footer={tr('Each repository has its own branch, changes, commits and stashes.')}>
          {[...repos]
            .sort((a, b) => files.filter((f) => f.repo === b).length - files.filter((f) => f.repo === a).length)
            .map((r) => {
              const n = files.filter((f) => f.repo === r).length
              return (
                <SheetOption
                  key={r}
                  icon={FolderGit2}
                  title={r}
                  help={project?.root ? `${project.root}/${r}` : undefined}
                  selected={r === repo}
                  trailing={
                    n ? (
                      <Pill tone="warn" wash={c.warnWash}>
                        {String(n)}
                      </Pill>
                    ) : null
                  }
                  onPress={() => {
                    setRepo(r)
                    setSheet(null)
                  }}
                />
              )
            })}
        </SheetGroup>
      </Sheet>

      <Sheet open={sheet === 'branch'} onClose={() => setSheet(null)} title={tr('Switch branch')}>
        <SheetGroup title={tr('Branches')}>
          {branches.map((b) => (
            <SheetOption
              key={b}
              icon={GitBranch}
              title={b}
              selected={b === branch}
              onPress={() => {
                setSheet(null)
                if (b !== branch) void run(() => gitAction('git.checkout', b), `Switched to ${b}`)
              }}
            />
          ))}
        </SheetGroup>
        <SheetGroup>
          <SheetOption
            icon={GitBranchPlus}
            title={tr('Create branch…')}
            help={tr('Start a new branch from {branch}.', { branch })}
            onPress={() => {
              setSheet(null)
              setTimeout(() => setSheet('newBranch'), 300)
            }}
          />
        </SheetGroup>
      </Sheet>

      <Sheet
        open={sheet === 'newBranch'}
        onClose={() => {
          setSheet(null)
          setBranchName('')
        }}
        title={tr('Create branch')}
      >
        <View style={{ paddingHorizontal: space.l, gap: space.m }}>
          <T tone="muted">{tr('The new branch starts from {branch} and is checked out right away.', { branch })}</T>
          <TextInput
            value={branchName}
            onChangeText={setBranchName}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={200}
            placeholder="feature/name"
            placeholderTextColor={c.placeholder}
            accessibilityLabel={tr('Branch name')}
            returnKeyType="done"
            onSubmitEditing={createBranch}
            style={{
              color: c.text,
              backgroundColor: c.raised2,
              borderRadius: radius.m,
              paddingHorizontal: space.m,
              height: 48,
              fontSize: font.body,
            }}
          />
          {branchName.trim() && !validBranchName(branchName.trim()) ? (
            <T size={font.caption} tone="bad">
              {tr('Use letters, numbers, “/”, “-”, “_” and “.” without spaces.')}
            </T>
          ) : null}
          <Button
            title={tr('Create and switch')}
            disabled={!validBranchName(branchName.trim()) || branches.includes(branchName.trim())}
            onPress={createBranch}
          />
        </View>
      </Sheet>

      <Sheet open={sheet === 'action'} onClose={() => setSheet(null)} title={tr('Commit')}>
        <SheetGroup footer={tr('Your choice stays for this session. Commit & Push and Commit & Sync need a remote.')}>
          {ACTIONS.map((a) => {
            const off =
              a.key === 'amend'
                ? !gates.canAmend
                  ? 'There is no commit to amend yet.'
                  : null
                : (a.key === 'push' || a.key === 'sync') && !gates.canRemote
                  ? gates.operation
                    ? 'Finish the rebase or merge in progress first.'
                    : 'This branch has no remote to push to.'
                  : null
            return (
              <SheetOption
                key={a.key}
                title={tr(a.label)}
                help={off ? tr(off) : tr(a.help)}
                selected={a.key === action}
                disabled={!!off}
                onPress={() => {
                  actionPicked.current = true
                  setAction(a.key)
                  setSheet(null)
                }}
              />
            )
          })}
        </SheetGroup>
      </Sheet>

      <Sheet open={sheet === 'menu'} onClose={() => setSheet(null)} title={tr('Source control')}>
        {menu.map((group) => (
          <SheetGroup key={group.title} title={tr(group.title)}>
            {group.items.map((item) => (
              <SheetOption
                key={item.label}
                icon={item.icon}
                title={tr(item.label)}
                help={item.off ? tr(item.off) : undefined}
                danger={item.danger}
                disabled={!!item.off || busy}
                onPress={() => {
                  setSheet(null)
                  setTimeout(item.onPress, 300)
                }}
              />
            ))}
          </SheetGroup>
        ))}
      </Sheet>
      {tab === 'changes' && changeCount > 8 ? (
        // The commit box owns the bottom edge, so the filter is a search button in the navigation bar.
        <BottomSearch
          placement="header"
          value={filter}
          onChangeText={setFilter}
          placeholder={translate(store.language, 'Filter {count} files', { count: changeCount })}
        />
      ) : null}
    </Screen>
  )
}
