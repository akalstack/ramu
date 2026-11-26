import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ThreadReply } from '../../../components/ThreadReply'
import { CommentAvatar } from '../../../components/CommentAvatar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PullRequestTimeline } from '../../../components/PullRequestTimeline'
import { PullRequestFilesList } from '../../../components/PullRequestFilesList'
import { PullRequestMarkdown } from '../../../components/PullRequestMarkdown'
import { ActivityIndicator, Alert, Linking, RefreshControl, Share, View, type ScrollViewInstance } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { diffAnchorFile, forgeRepoOf, parseForgeLink, sameForgeRepo } from '@ramu/shared/forgeLinks'
import { ReferenceContext, type ReferenceActions } from '../../../components/Markdown'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Bot,
  CircleAlert,
  CircleCheck,
  Copy,
  ExternalLink,
  Eye,
  FolderGit2,
  GitFork,
  GitMerge,
  MessageSquare,
  MessagesSquare,
  PencilLine,
  RefreshCcw,
  RotateCcw,
  Send,
  Share as ShareIcon,
  SquareArrowOutUpRight,
  Tag,
  UserPlus,
  Users,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react-native'
import {
  DEFAULT_AGENT_SETTINGS,
  type MergeMethod,
  type MergeOptions,
  type PullRequestAction,
  type PullRequestDraftBatch,
  type PullRequestFile,
  type PullRequestTimelineEvent,
  type PullRequestList,
  type PullRequestSummary,
  type PullRequestThread,
} from '@ramu/shared/types'
import {
  FORGE_NAMES,
  outsideRepository,
  pullRequestMergeOffer,
  pullRequestNextStep,
  pullRequestRef,
  pullRequestStage,
  matchesPullRequestFile,
  shownReviewThreads,
  type PullRequestNextStep,
  type ReviewThreadFilter,
} from '@ramu/shared/pullRequests'
import { READINESS_ACTION, readinessStep } from '@ramu/shared/pullRequestReadiness'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost } from '../../../runtime/viewerAccess'
import { openPullRequestThread } from '../../../runtime/pullRequestThread'
import { useSay } from '../../../i18n'
import {
  Header,
  HeaderMenu,
  Screen,
  PageScrollView as ScrollView,
  type HeaderMenuAction,
} from '../../../components/Screen'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { Button, Card, Chip, ConnectionDot, Divider, Pill, Segmented, Sheet, T, Toggle } from '../../../components/ui'
import { BottomSearch } from '../../../components/BottomSearch'
import {
  ACTION_BAR_SPACE,
  PullRequestActionBar,
  PullRequestIdentity,
  type PullRequestBarAction,
  PullRequestNote,
  PullRequestReadinessCard,
  PullRequestWorkRow,
} from '../../../components/PullRequestOverview'
import { readReviewDraft, reviewDraftKey, writeReviewDraft } from '../../../runtime/pullRequestReviewDraft'
import { FinishReviewSheet, LineCommentSheet, type PendingComment } from '../../../components/PullRequestReview'
import { ReviewDrafts } from '../../../components/ReviewDrafts'
import { PeopleSheet, PullRequestComments, ReactionRow } from '../../../components/PullRequestComments'
import { supportsPullRequest } from '@ramu/shared/pullRequestSupport'
import type { ForgeService, PullRequestWrite, ReviewVerdict } from '@ramu/shared/types'
import { pullRequestHostChoices } from '../../../runtime/pullRequestHosts'
import { pullRequestCopy } from '../../../runtime/pullRequestCopy'
import { PageLoader } from '../../../components/PageLoader'

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
}

/** The icon each next step leads with in the action bar. */
const STEP_ICON: Partial<Record<PullRequestNextStep, LucideIcon>> = {
  merge: GitMerge,
  'fix-checks': Wrench,
  'resolve-conflicts': RotateCcw,
  'update-branch': RotateCcw,
  'address-comments': MessageSquare,
  'mark-ready': CircleCheck,
  review: Bot,
}

/** One entry of the pull request's menu: the native header menu on iOS, a sheet elsewhere. */
interface MenuEntry {
  key: string
  label: string
  icon: LucideIcon
  symbol: HeaderMenuAction['icon']
  section: 'state' | 'people' | 'link' | 'end'
  destructive?: boolean
  run: () => void
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const rawId = (id: string) => id.slice(id.indexOf(':') + 1)

/**
 * One pull request in full, as the desktop shows it: where it stands, what the agent drafted for it, its open review
 * threads, and every action from opening it in a thread to merging it. A view-only device sees it all and changes nothing.
 */
export default function PullRequestScreen() {
  const say = useSay()
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { c } = useTheme()
  // Opened from a thread (`id`), or from the Pull requests page with the host and project it was listed under.
  const params = useLocalSearchParams<{
    id?: string
    computer?: string
    project?: string
    repoId: string
    url: string
  }>()
  const { repoId, url } = params
  const chat = useChat(params.id)
  const store = useStore()
  const computerId = chat?.computerId ?? params.computer ?? ''
  // A repository in no project (`outside:owner/repo`) is listed under no project; the host reads it through the
  // service's account alone and ignores the context, which only has to be well formed.
  const taskId = chat?.taskId ?? (params.computer ? `project:${params.project ?? ''}` : '')
  const projectId = chat?.projectId ? rawId(chat.projectId) : params.project || null
  const outside = outsideRepository(repoId)
  // The person's own review: line comments waiting to go out together, kept as a draft so leaving the pull request
  // or closing the app never loses them.
  const draftKey = reviewDraftKey(computerId, url)
  const pending = readReviewDraft(store.drafts[draftKey])
  const setPending = (change: (current: PendingComment[]) => PendingComment[]) =>
    store.setDraft(draftKey, writeReviewDraft(change(readReviewDraft(store.drafts[draftKey]))))
  const computer = store.computers.find((pc) => pc.id === computerId)
  const online = store.isOnline(computerId)
  // The other hosts whose checkout lists this pull request, from what this phone kept of each host's list.
  const hostChoices = pullRequestHostChoices(
    store.computers.flatMap((pc) =>
      [false, true].map((closed) => ({
        host: pc.id,
        repositories: pullRequestCopy.read(pc.id, 'forge.allPullRequests', closed, false) ?? [],
      })),
    ),
    url,
    computerId,
    (host) => store.isOnline(host),
  )
  // Offline, the screen reads from what this phone kept, and nothing is sent until the host is back.
  const canWrite = canWriteHost(computer) && online
  // What this phone last read of this pull request, so the screen opens on it and then reads again.
  const [kept] = useState(() => {
    if (!computerId || !taskId) return null
    const read = pullRequestCopy.read
    const open = read(computerId, 'forge.pullRequests', taskId, repoId, false, false)
    const inOpen = open?.pullRequests.find((entry) => entry.url === url)
    const list = inOpen ? open : read(computerId, 'forge.pullRequests', taskId, repoId, true, false)
    const found = inOpen ?? list?.pullRequests.find((entry) => entry.url === url)
    if (!list || !found) return null
    return {
      list,
      pr: found,
      batch: read(computerId, 'forge.drafts', url) ?? null,
      threads: read(computerId, 'forge.reviewThreads', taskId, repoId, url) ?? null,
      description: read(computerId, 'forge.pullRequestDescription', taskId, repoId, url) ?? null,
      timeline: read(computerId, 'forge.pullRequestTimeline', taskId, repoId, url) ?? null,
      files: read(computerId, 'forge.pullRequestFiles', taskId, repoId, url) ?? null,
    }
  })
  const [list, setList] = useState<PullRequestList | null>(kept?.list ?? null)
  const [pr, setPr] = useState<PullRequestSummary | null>(kept?.pr ?? null)
  const [batch, setBatch] = useState<PullRequestDraftBatch | null>(kept?.batch ?? null)
  const [threads, setThreads] = useState<PullRequestThread[] | null>(kept?.threads ?? null)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(kept?.description ?? null)
  const [files, setFiles] = useState<{ files: PullRequestFile[]; more: boolean } | null>(kept?.files ?? null)
  const [tab, setTab] = useState<'overview' | 'files'>('overview')
  // A link to one of this pull request's files opens Files changed at that file.
  const [focusFile, setFocusFile] = useState<{ path: string; key: number } | null>(null)
  const scroll = useRef<ScrollViewInstance>(null)
  const offset = useRef(0)
  const [timeline, setTimeline] = useState<PullRequestTimelineEvent[] | null>(kept?.timeline ?? null)
  // Kept data shows at once; only a pull request this phone never read waits on the spinner.
  const [loaded, setLoaded] = useState(!!kept)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [people, setPeople] = useState<'reviewers' | 'labels' | 'assignees' | null>(null)
  const [revision, setRevision] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [more, setMore] = useState(false)
  const [threadFilter, setThreadFilter] = useState<ReviewThreadFilter>('open')
  const [threadOrder, setThreadOrder] = useState<'newest' | 'oldest'>('newest')
  // The line being commented on (or the pending comment being edited), and the Finish review sheet.
  const [commenting, setCommenting] = useState<{
    path: string
    line: number
    startLine?: number
    id?: string
    body?: string
  } | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [choosingHost, setChoosingHost] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const read = useCallback(
    async (force: boolean) => {
      if (!computerId || !taskId) return
      if (force) await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, false, true).catch(() => {})
      try {
        const keep = pullRequestCopy.keep
        let next = await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, false, false)
        keep(computerId, 'forge.pullRequests', next, taskId, repoId, false, false)
        let found = next.pullRequests.find((entry) => entry.url === url)
        // Merged and closed ones are only in the longer list.
        if (!found) {
          next = await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, true, force)
          keep(computerId, 'forge.pullRequests', next, taskId, repoId, true, false)
          found = next.pullRequests.find((entry) => entry.url === url)
        }
        setList(next)
        setPr(found ?? null)
        setError(null)
        const [drafts, open] = await Promise.all([
          store.invoke(computerId, 'forge.drafts', url).catch(() => null),
          found
            ? store.invoke(computerId, 'forge.reviewThreads', taskId, repoId, url).then(
                (value) => {
                  setThreadsError(null)
                  keep(computerId, 'forge.reviewThreads', value, taskId, repoId, url)
                  return value
                },
                (e: unknown) => {
                  setThreadsError(message(e))
                  return null
                },
              )
            : Promise.resolve(null),
        ])
        if (drafts) keep(computerId, 'forge.drafts', drafts, url)
        setBatch(drafts)
        // A thread read that failed keeps what was shown; its error says why.
        if (open || !found) setThreads(open)
        // The description is extra: a host that cannot read it still shows everything else.
        if (found)
          void store.invoke(computerId, 'forge.pullRequestDescription', taskId, repoId, url).then(
            (value) => {
              keep(computerId, 'forge.pullRequestDescription', value, taskId, repoId, url)
              setDescription(value)
            },
            () => setDescription(null),
          )
        if (found)
          void store.invoke(computerId, 'forge.pullRequestTimeline', taskId, repoId, url).then(
            (value) => {
              keep(computerId, 'forge.pullRequestTimeline', value, taskId, repoId, url)
              setTimeline(value)
            },
            () => setTimeline(null),
          )
        if (found)
          void store.invoke(computerId, 'forge.pullRequestFiles', taskId, repoId, url).then(
            (value) => {
              keep(computerId, 'forge.pullRequestFiles', value, taskId, repoId, url)
              setFiles(value)
            },
            () => setFiles(null),
          )
      } catch (e) {
        setError(message(e))
      } finally {
        setLoaded(true)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
    [computerId, taskId, repoId, url],
  )
  useEffect(() => {
    void read(false)
    if (!computerId) return
    // Drafts arrive while the agent works; the host announces them with the thread lists. Only the drafts are read
    // again: every workspace change re-reading the pull request would spend the service's rate limit.
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (channel !== 'workspace:changed') return
      clearTimeout(timer)
      timer = setTimeout(
        () =>
          void store.invoke(computerId, 'forge.drafts', url).then(
            (drafts) => {
              pullRequestCopy.keep(computerId, 'forge.drafts', drafts, url)
              setBatch(drafts)
            },
            () => {},
          ),
        400,
      )
    })
    return () => {
      clearTimeout(timer)
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- subscribes once per host and pull request
  }, [read, computerId])

  const pullToRefresh = async () => {
    setRefreshing(true)
    await read(true)
    setRefreshing(false)
  }

  /** Whether the work went through, so a sheet that started it stays open on its error instead of losing its input. */
  const run = async (label: string, work: () => Promise<unknown>) => {
    if (!canWrite) return false
    setBusy(label)
    setError(null)
    try {
      await work()
      await read(true)
      setRevision((value) => value + 1)
      return true
    } catch (e) {
      setError(message(e))
      return false
    } finally {
      setBusy(null)
    }
  }
  const act = (action: PullRequestAction) =>
    run(action.kind, () => store.invoke(computerId, 'forge.pullRequestAction', taskId, repoId, url, action))
  /** The person's own actions go through the call an agent's card posts with. */
  const write = (label: string, change: PullRequestWrite) =>
    run(label, () => store.invoke(computerId, 'forge.pullRequestWrite', taskId, repoId, url, change))

  /** The service updates the branch when it can; otherwise the thread's checkout merges the base in and pushes. */
  const updateBranch = () =>
    run('update-branch', async () => {
      setNotice(null)
      const result = await store.invoke(computerId, 'forge.updateBranch', taskId, repoId, url)
      if (result.conflicts && result.taskId) {
        setNotice(
          say(
            '{0} files have conflicts. Choose a side for each in Source Control → Merge changes, then continue the merge.',
            { 0: result.conflicts },
          ),
        )
        // The merge stopped in that thread's checkout: its Source Control lists the files to choose a side for.
        await store.refresh(computerId).catch(() => {})
        router.push({
          pathname: '/chat/[id]/scm',
          params: { id: store.resolveChat(computerId, result.taskId) },
        })
      } else if (result.pushed) setNotice(say('The base branch was merged in and pushed.'))
    })

  const openTask = (hostTaskId: string) =>
    router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, hostTaskId) } })

  const openThread = (purpose: 'work' | 'review') =>
    run(purpose, async () => {
      if (!projectId) throw new Error(say('This checkout is not part of a project.'))
      const started = await openPullRequestThread(store.invoke, {
        computerId,
        taskId,
        projectId,
        repoId,
        url,
        purpose,
        // A new thread starts on the host's default model step, as New thread does.
        settings: store.defaults[computerId] ?? DEFAULT_AGENT_SETTINGS,
        say,
      })
      await store.refresh(computerId).catch(() => {})
      openTask(started)
    })

  /** Hands the open review threads to the thread working on this pull request, as one round. */
  const sendThreadsToAgent = (threadTaskId: string, kind: 'checks' | 'reviews' = 'reviews') =>
    run(kind, async () => {
      const sessionId = await store.invoke(computerId, 'forge.sendFeedback', threadTaskId, repoId, kind)
      if (!sessionId) {
        const prompt = await store.invoke(computerId, 'forge.pullRequestFeedback', threadTaskId, repoId, kind)
        const session = (await store.invoke(computerId, 'agent.list', threadTaskId)).findLast(
          (entry) => !entry.parentId,
        )
        if (!session) throw new Error(say('Open the thread and start its agent first.'))
        await store.invoke(computerId, 'agent.submit', session.id, prompt, 'queue', [], [])
      }
      openTask(threadTaskId)
    })

  const confirmClose = (number: number) =>
    Alert.alert(
      say('Close pull request #{0}?', { 0: number }),
      say('It can be reopened later. Its branch and threads stay.'),
      [
        { text: say('Cancel'), style: 'cancel' },
        { text: say('Close pull request'), style: 'destructive', onPress: () => void act({ kind: 'close' }) },
      ],
    )

  const linked = list?.threads?.[url] ?? []
  // A list without a service is GitHub's.
  const service = list?.service ?? 'github'
  const thread = linked.at(-1)
  const draftsReady =
    batch?.kind === 'review'
      ? !!batch.body || !!batch.comments.length
      : !!batch?.drafts.some((draft) => draft.outcome !== 'skipped' && !draft.postedId)
  const stage = pr ? pullRequestStage(pr, { draftsReady }) : null
  const open = pr?.state === 'open'
  const mine = pr?.group === 'mine'
  const openThreads = (threads ?? []).filter((entry) => !entry.resolved)
  // One search in the navigation bar narrows whichever tab is showing: review threads, or the changed files.
  const [search, setSearch] = useState('')
  const shownThreads = shownReviewThreads(threads ?? [], threadFilter, threadOrder, search)
  const shownFiles = files ? files.files.filter((file) => matchesPullRequestFile(file, search)) : []
  const step = pr && stage ? readinessStep(pullRequestNextStep(pr, stage, mine), !!outside) : 'none'
  const mergeOffer = pr ? pullRequestMergeOffer(pr, supportsPullRequest(service, 'auto-merge')) : 'none'
  const mergeTitle = mergeOffer === 'when-ready' ? say('Merge when ready…') : say('Merge…')
  // Reviewing happens on the Files changed tab, on an open pull request whose service takes line comments.
  const canReview = !!pr && open && canWrite && supportsPullRequest(service, 'line-comment')

  const submitReview = async (verdict: ReviewVerdict, body: string) => {
    if (!canWrite) return
    setBusy('submit-review')
    setReviewError(null)
    try {
      await store.invoke(computerId, 'forge.submitReview', taskId, repoId, url, {
        verdict,
        body,
        comments: pending.map(({ path, line, startLine, body: text }) => ({
          path,
          line,
          ...(startLine ? { startLine } : {}),
          body: text,
        })),
      })
      setPending(() => [])
      setFinishing(false)
      await read(true)
      setRevision((value) => value + 1)
    } catch (e) {
      // The sheet stays open on its error, keeping the summary and line comments.
      setReviewError(message(e))
    } finally {
      setBusy(null)
    }
  }

  /** A repository in no project is cloned on the host and added as one; the folder screen picks where it goes. */
  const cloneAsProject = () => {
    if (!outside) return
    store.select(computerId)
    // The pull request's own service host, so a clone address the host's account cannot find still points there.
    const forge = forgeRepoOf(url)?.host
    router.push({ pathname: '/folders', params: { clone: outside, ...(forge ? { forge } : {}) } })
  }
  /** The Overview's one action, as on the desktop: fixes go to the thread on it, or a new one catches up first. */
  const takeStep = () => {
    if (step === 'merge') setMerging(true)
    else if (step === 'resolve-conflicts' || step === 'update-branch') void updateBranch()
    else if (step === 'mark-ready') void act({ kind: 'ready' })
    else if (step === 'review') void openThread('review')
    else if (step === 'fix-checks' || step === 'address-comments')
      void (thread
        ? sendThreadsToAgent(thread.taskId, step === 'fix-checks' ? 'checks' : 'reviews')
        : openThread('work'))
  }

  // Links in the description, comments and threads open what they point at here when the app has it: this pull
  // request's files, another pull request it lists, or a file or folder in this repository's checkout.
  const openLink = (href: string) => {
    const browser = () => void Linking.openURL(href).catch(() => {})
    const link = pr ? parseForgeLink(href, { url: pr.url, ref: pr.headBranch }) : null
    const own = pr ? forgeRepoOf(pr.url) : null
    if (!pr || !link || !own) return browser()
    const sameRepo = sameForgeRepo(link.repo, own.repo)
    if (link.kind === 'pull' && sameRepo && link.number === pr.number) {
      setTab('files')
      const target =
        link.anchor && files
          ? diffAnchorFile(
              link.anchor,
              files.files.map((file) => file.path),
            )
          : null
      if (target) setFocusFile({ path: target.path, key: Date.now() })
      return
    }
    if (link.kind === 'pull') {
      for (const closed of [false, true])
        for (const listed of pullRequestCopy.read(computerId, 'forge.allPullRequests', closed, false) ?? []) {
          const found = listed.pullRequests.find((entry) => {
            const theirs = forgeRepoOf(entry.url)
            return entry.number === link.number && !!theirs && sameForgeRepo(theirs.repo, link.repo)
          })
          if (found)
            return router.push({
              pathname: '/pull-request',
              params: { computer: computerId, project: listed.projectId, repoId: listed.repoId, url: found.url },
            })
        }
      if (sameRepo)
        return router.push({
          pathname: '/pull-request',
          params: {
            computer: computerId,
            project: projectId ?? '',
            repoId,
            url: pr.url.replace(/\d+(?=\/?$)/, String(link.number)),
          },
        })
      return browser()
    }
    // A repository in no project has no checkout on the host to read files from.
    if ((link.kind === 'file' || link.kind === 'folder') && sameRepo && !outside && taskId) {
      if (link.kind === 'file')
        return router.push({
          pathname: '/file',
          params: {
            computer: computerId,
            ctx: taskId,
            repoId,
            path: link.path,
            ...(link.line ? { line: String(link.line) } : {}),
          },
        })
      return router.push({
        pathname: '/explorer',
        params: { computer: computerId, ctx: taskId, repoId, path: link.path, revealId: String(Date.now()) },
      })
    }
    browser()
  }
  const linkRef = useRef(openLink)
  linkRef.current = openLink
  const references = useMemo<ReferenceActions>(
    () => ({ openUrl: (url) => linkRef.current(url), openFile: (href) => linkRef.current(href) }),
    [],
  )

  // The bar's one prominent action: finishing the review being written, the next step, cloning a repository no project
  // holds, then merging or reopening.
  const stepAction = READINESS_ACTION[step]
  const primary: PullRequestBarAction | null = !pr
    ? null
    : tab === 'files' && canReview
      ? {
          key: 'finish-review',
          icon: Send,
          title: pending.length ? say('Finish review · {0}', { 0: pending.length }) : say('Finish review'),
          onPress: () => {
            setReviewError(null)
            setFinishing(true)
          },
        }
      : open && canWrite && stepAction
        ? { key: step, icon: STEP_ICON[step], title: say(stepAction), onPress: takeStep }
        : open && canWrite && outside
          ? { key: 'clone', icon: FolderGit2, title: say('Clone as project'), onPress: cloneAsProject }
          : open && canWrite && mergeOffer !== 'none'
            ? { key: 'merge', icon: GitMerge, title: mergeTitle, onPress: () => setMerging(true) }
            : pr.state === 'closed' && canWrite
              ? { key: 'reopen', icon: RotateCcw, title: say('Reopen'), onPress: () => void act({ kind: 'reopen' }) }
              : null
  // Everything the bar's button is not, so nothing the desktop offers is out of reach; links work offline too.
  const stateEntries: (MenuEntry | null)[] =
    pr && open && canWrite
      ? [
          primary?.key !== 'merge' && mergeOffer !== 'none'
            ? {
                key: 'merge',
                label: mergeTitle,
                icon: GitMerge,
                symbol: 'arrow.triangle.merge',
                section: 'state',
                run: () => setMerging(true),
              }
            : null,
          primary?.key !== 'mark-ready' && pr.draft
            ? {
                key: 'ready',
                label: say('Ready for review'),
                icon: CircleCheck,
                symbol: 'checkmark.circle',
                section: 'state',
                run: () => void act({ kind: 'ready' }),
              }
            : null,
          primary?.key !== 'update-branch' &&
          primary?.key !== 'resolve-conflicts' &&
          (pr.mergeable === 'behind' || (pr.mergeable === 'conflicts' && !outside))
            ? {
                key: 'update',
                label: pr.mergeable === 'conflicts' ? say('Resolve conflicts') : say('Update branch'),
                icon: RotateCcw,
                symbol: 'arrow.triangle.2.circlepath',
                section: 'state',
                run: () => void updateBranch(),
              }
            : null,
          !pr.draft && supportsPullRequest(service, 'draft')
            ? {
                key: 'draft',
                label: say('Back to draft'),
                icon: PencilLine,
                symbol: 'pencil',
                section: 'state',
                run: () => void act({ kind: 'draft' }),
              }
            : null,
          ...(['reviewers', 'labels', 'assignees'] as const)
            .filter((kind) => supportsPullRequest(service, kind))
            .map((kind): MenuEntry => ({
              key: kind,
              label: say(kind === 'reviewers' ? 'Reviewers…' : kind === 'labels' ? 'Labels…' : 'Assignees…'),
              icon: kind === 'reviewers' ? Users : kind === 'labels' ? Tag : UserPlus,
              symbol: kind === 'reviewers' ? 'person.2' : kind === 'labels' ? 'tag' : 'person.badge.plus',
              section: 'people',
              run: () => {
                setError(null)
                setPeople(kind)
              },
            })),
        ]
      : []
  const menuEntries: (MenuEntry | null)[] = !pr
    ? []
    : [
        ...stateEntries,
        {
          key: 'service',
          label: say('Open on {0}', { 0: FORGE_NAMES[service] }),
          icon: ExternalLink,
          symbol: 'safari',
          section: 'link',
          run: () => void Linking.openURL(pr.url).catch(() => {}),
        },
        {
          key: 'copy',
          label: say('Copy link'),
          icon: Copy,
          symbol: 'link',
          section: 'link',
          run: () => void Clipboard.setStringAsync(pr.url),
        },
        {
          key: 'share',
          label: say('Share'),
          icon: ShareIcon,
          symbol: 'square.and.arrow.up',
          section: 'link',
          run: () => void Share.share({ url: pr.url, message: `${pr.title}\n${pr.url}` }).catch(() => {}),
        },
        open && canWrite
          ? {
              key: 'close',
              label: say('Close pull request'),
              icon: X,
              symbol: 'xmark.circle',
              section: 'end',
              destructive: true,
              run: () => confirmClose(pr.number),
            }
          : null,
      ]
  const menu = menuEntries.filter((entry) => entry !== null)
  const sections = (['state', 'people', 'link', 'end'] as const)
    .map((section) => menu.filter((entry) => entry.section === section))
    .filter((entries) => entries.length)

  return (
    <Screen bg="canvas">
      {/* Compact, as the services' phones lead: the number, then the repository and whether the host is in reach. */}
      <Header
        title={pr ? pullRequestRef(service, pr.number) : say('Pull request')}
        search
        subtitle={[outside ?? forgeRepoOf(url)?.repo, online ? null : say('Offline')].filter(Boolean).join(' · ')}
        right={
          pr ? (
            <HeaderMenu
              label={say('Pull request actions')}
              onPress={() => setMore(true)}
              actions={menu.map((entry) => ({
                label: entry.label,
                icon: entry.symbol,
                section: entry.section,
                destructive: entry.destructive,
                onPress: entry.run,
              }))}
            />
          ) : null
        }
      />
      <ReferenceContext.Provider value={references}>
        <ScrollView
          ref={scroll}
          onScroll={(event) => {
            offset.current = event.nativeEvent.contentOffset.y
          }}
          scrollEventThrottle={32}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            padding: space.l,
            paddingTop: space.s,
            gap: space.l,
            // The floating action bar sits over the page; the last content scrolls clear of it.
            paddingBottom: space.xl + ACTION_BAR_SPACE + insets.bottom,
          }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={c.muted} />
          }
        >
          {!loaded ? <PageLoader style={{ marginVertical: space.xl }} /> : null}
          {loaded && !pr ? (
            <View style={{ gap: space.m }}>
              <T tone={error ? 'bad' : 'muted'}>{error ?? say('This pull request was not found with this account.')}</T>
              <Button kind="secondary" title={say('Try again')} onPress={() => void pullToRefresh()} />
            </View>
          ) : null}
          {pr && stage ? (
            <>
              <PullRequestIdentity pr={pr} service={service} stage={stage} />
              {store.computers.length > 1 ? (
                // Which host it is read from and worked on; with its repository on several, it moves to another one.
                <View style={{ flexDirection: 'row' }}>
                  <Chip
                    small
                    status={computer?.status}
                    label={say('On {0}', { 0: computer?.name ?? computerId })}
                    accessibilityLabel={say('Host for this pull request')}
                    accessibilityHint={say('Its thread and checkout are on this host')}
                    chevron={hostChoices.length > 1}
                    onPress={() => hostChoices.length > 1 && setChoosingHost(true)}
                  />
                </View>
              ) : null}
              {!online ? (
                <PullRequestNote>{say('Showing what this phone last read of this pull request.')}</PullRequestNote>
              ) : null}
              {outside && open ? (
                <PullRequestNote icon={FolderGit2}>
                  {say(
                    '{0} is in no project on this host. Review, comment and merge here; clone it as a project to work on it in a thread or have an agent review it.',
                    { 0: outside },
                  )}
                </PullRequestNote>
              ) : null}
              {pr.fork && !mine && open && !outside ? (
                <PullRequestNote icon={GitFork}>
                  {say(
                    'This pull request comes from a fork. An agent can review it here, but only its author can push to it.',
                  )}
                </PullRequestNote>
              ) : null}
              {notice ? (
                <T size={font.control} tone="soft" accessibilityLiveRegion="polite">
                  {notice}
                </T>
              ) : null}
              {error ? (
                <View
                  accessibilityLiveRegion="polite"
                  style={{
                    flexDirection: 'row',
                    gap: space.s,
                    padding: space.m,
                    borderRadius: radius.m,
                    backgroundColor: c.badWash,
                  }}
                >
                  <CircleAlert size={16} color={c.bad} style={{ marginTop: 2 }} />
                  <T size={font.control} tone="bad" style={{ flex: 1 }}>
                    {error}
                  </T>
                </View>
              ) : null}

              <Segmented
                value={tab}
                onChange={setTab}
                options={[
                  { key: 'overview', label: say('Overview') },
                  { key: 'files', label: say('Files changed'), count: files?.files.length ?? 0 },
                ]}
              />

              {tab === 'overview' ? (
                <>
                  <PullRequestReadinessCard
                    pr={pr}
                    openThreads={openThreads.length}
                    step={step}
                    onRow={(key) =>
                      // Failing checks open on the service, where each check's log is.
                      key === 'checks' && pr.checks && pr.checks !== 'success'
                        ? () => void Linking.openURL(service === 'github' ? `${pr.url}/checks` : pr.url).catch(() => {})
                        : key === 'merge' && pr.mergeable === 'conflicts'
                          ? () => setTab('files')
                          : undefined
                    }
                    rowAction={(key) =>
                      key === 'checks' &&
                      pr.checks === 'failure' &&
                      canWrite &&
                      supportsPullRequest(service, 'rerun-checks') ? (
                        <Chip
                          small
                          fill
                          icon={RefreshCcw}
                          label={busy === 'rerun' ? say('Working…') : say('Re-run')}
                          onPress={() => void write('rerun', { kind: 'rerun-checks' })}
                        />
                      ) : null
                    }
                  />
                  {(() => {
                    // Ways to work on it, each a row: its thread, a new one, an agent's review, a clone.
                    const rows = [
                      thread
                        ? {
                            key: 'thread',
                            icon: SquareArrowOutUpRight,
                            title: say('Open thread'),
                            help: thread.title,
                            onPress: () => openTask(thread.taskId),
                          }
                        : open && canWrite && !outside
                          ? {
                              key: 'work',
                              icon: MessagesSquare,
                              title: busy === 'work' ? say('Starting…') : say('Open in thread'),
                              disabled: !!busy || (pr.fork && !mine),
                              onPress: () => void openThread('work'),
                            }
                          : null,
                      open && !mine && !thread && !outside && canWrite
                        ? {
                            key: 'review',
                            icon: Bot,
                            title: busy === 'review' ? say('Starting…') : say('Review with agent'),
                            help: say('Checks it out in a worktree and drafts a review for you to edit and post.'),
                            disabled: !!busy,
                            onPress: () => void openThread('review'),
                          }
                        : null,
                      open && thread && mine && openThreads.length && canWrite
                        ? {
                            key: 'reviews',
                            icon: MessageSquare,
                            title: busy === 'reviews' ? say('Starting…') : say('Address review comments'),
                            disabled: !!busy,
                            onPress: () => void sendThreadsToAgent(thread.taskId),
                          }
                        : null,
                      outside && canWrite && primary?.key !== 'clone'
                        ? {
                            key: 'clone',
                            icon: FolderGit2,
                            title: say('Clone {0} as a project', { 0: outside }),
                            onPress: cloneAsProject,
                          }
                        : null,
                    ].filter((row) => row !== null)
                    return rows.length ? (
                      <Card>
                        {rows.map((row, index) => (
                          <View key={row.key}>
                            {index ? <Divider inset={space.l + 29} /> : null}
                            <PullRequestWorkRow
                              icon={row.icon}
                              title={row.title}
                              help={'help' in row ? row.help : undefined}
                              disabled={'disabled' in row ? row.disabled : undefined}
                              onPress={row.onPress}
                            />
                          </View>
                        ))}
                      </Card>
                    ) : null
                  })()}
                  {open && pr.mergeable === 'conflicts' && canWrite && !outside ? (
                    <T size={font.caption} tone="muted">
                      {say(
                        'Merges the base branch in the thread working on it, so you can resolve the conflicts there',
                      )}
                    </T>
                  ) : null}
                  {batch ? (
                    <ReviewDrafts
                      key={`${batch.id}:${batch.kind === 'review' ? `${batch.body.length}:${batch.comments.length}` : batch.drafts.map((draft) => `${draft.threadId}${draft.reply.length}${draft.postedId ?? ''}`).join()}`}
                      computerId={computerId}
                      batch={batch}
                      readOnly={!canWrite}
                      onDone={() => void read(true)}
                    />
                  ) : null}

                  {description?.trim() ? (
                    <View style={{ gap: space.s }}>
                      <T size={font.control} weight="600" tone="muted">
                        {say('Description')}
                      </T>
                      <PullRequestMarkdown text={description} density="reply" />
                    </View>
                  ) : null}

                  {timeline?.length ? <PullRequestTimeline timeline={timeline} /> : null}

                  <PullRequestComments
                    computerId={computerId}
                    taskId={taskId}
                    repoId={repoId}
                    url={url}
                    service={service}
                    canWrite={canWrite}
                    open={open}
                    revision={revision}
                  />

                  <View style={{ gap: space.s }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                      <T size={font.control} weight="600" tone="muted" style={{ flex: 1 }}>
                        {say('Review threads')}
                        {openThreads.length ? (
                          <T
                            size={font.control}
                            tone="placeholder"
                          >{` ${say('{0} unresolved', { 0: openThreads.length })}`}</T>
                        ) : null}
                      </T>
                      {/* An order, as GitHub's Overview page gives its comments. */}
                      <Chip
                        small
                        label={threadOrder === 'newest' ? say('Newest first') : say('Oldest first')}
                        onPress={() => setThreadOrder((value) => (value === 'newest' ? 'oldest' : 'newest'))}
                      />
                    </View>
                    <Segmented<ReviewThreadFilter>
                      value={threadFilter}
                      onChange={setThreadFilter}
                      options={[
                        { key: 'open', label: say('Unresolved') },
                        { key: 'resolved', label: say('Resolved') },
                        { key: 'all', label: say('All') },
                      ]}
                    />
                    {threadsError ? (
                      <T size={font.caption} tone="bad">
                        {threadsError}
                      </T>
                    ) : threads === null ? (
                      <ActivityIndicator color={c.muted} style={{ paddingVertical: space.m }} />
                    ) : !shownThreads.length ? (
                      <T tone="muted">
                        {search.trim()
                          ? say('No review thread matches “{0}”.', { 0: search.trim() })
                          : threadFilter === 'open'
                            ? say('No open review threads.')
                            : say('No review threads here.')}
                      </T>
                    ) : (
                      shownThreads.map((entry) => (
                        <Card key={entry.id} style={{ padding: space.m, gap: space.m }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                            <T size={font.caption} tone="muted" mono numberOfLines={1} style={{ flex: 1 }}>
                              {entry.path
                                ? `${entry.path}${entry.line ? `:${entry.line}` : ''}`
                                : say('Review comment')}
                            </T>
                            {entry.outdated ? <Pill>{say('Outdated')}</Pill> : null}
                            {entry.resolved ? <Pill>{say('Resolved')}</Pill> : null}
                          </View>
                          {entry.comments.map((comment, index) => (
                            // Replies hang from a line under the first comment, as one conversation.
                            <View
                              key={comment.id}
                              style={
                                index
                                  ? {
                                      gap: space.xs,
                                      marginLeft: 12,
                                      paddingLeft: space.m,
                                      borderLeftWidth: 1,
                                      borderLeftColor: c.line,
                                    }
                                  : { gap: space.xs }
                              }
                            >
                              <View
                                style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}
                              >
                                <CommentAvatar
                                  computerId={computerId}
                                  name={comment.author}
                                  url={comment.avatarUrl}
                                  bot={comment.bot}
                                  size={index ? 20 : 24}
                                />
                                <T size={font.control} weight="600">
                                  {comment.author ?? say('Someone')}
                                </T>
                                {comment.bot ? <Pill>{say('bot')}</Pill> : null}
                                {!comment.trusted ? (
                                  <T size={font.caption} tone="warn">
                                    {say('From outside the project')}
                                  </T>
                                ) : null}
                                {comment.createdAt ? (
                                  <T size={font.caption} tone="muted">
                                    {new Date(comment.createdAt).toLocaleDateString(undefined, {
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </T>
                                ) : null}
                              </View>
                              <PullRequestMarkdown text={comment.body} />
                              {canWrite ? (
                                <ReactionRow
                                  service={service}
                                  disabled={!!busy}
                                  onReact={(reaction) =>
                                    void write('react', {
                                      kind: 'react',
                                      commentId: comment.id,
                                      reaction,
                                      remove: false,
                                    })
                                  }
                                />
                              ) : null}
                            </View>
                          ))}
                          {canWrite && open ? (
                            <ThreadReply
                              resolved={entry.resolved}
                              resolvable={entry.resolvable}
                              disabled={!!busy}
                              onReply={(body) => write('reply', { kind: 'reply', threadId: entry.id, body })}
                              onStatus={(resolve) =>
                                write('thread', {
                                  kind: 'thread-status',
                                  threadId: entry.id,
                                  status: resolve ? 'resolved' : 'active',
                                })
                              }
                            />
                          ) : null}
                        </Card>
                      ))
                    )}
                  </View>
                </>
              ) : files?.files.length ? (
                <View style={{ gap: space.s }}>
                  {canReview ? (
                    <T size={font.caption} tone="muted">
                      {say('Tap a line to comment on it. Comments wait until you finish your review.')}
                    </T>
                  ) : null}
                  {search.trim() ? (
                    <T size={font.caption} tone="muted">
                      {shownFiles.length
                        ? say('{0} of {1} files', { 0: shownFiles.length, 1: files.files.length })
                        : say('No changed file or line matches “{0}”.', { 0: search.trim() })}
                    </T>
                  ) : null}
                  {shownFiles.length ? (
                    <PullRequestFilesList
                      key={search.trim() ? 'search' : 'all'}
                      files={shownFiles}
                      more={files.more}
                      threads={threads ?? []}
                      pending={pending}
                      onComment={
                        canReview ? (path, line, startLine) => setCommenting({ path, line, startLine }) : undefined
                      }
                      onEditPending={canReview ? (comment) => setCommenting(comment) : undefined}
                      focus={focusFile}
                      onReveal={(y) => scroll.current?.scrollTo({ y: Math.max(0, offset.current + y - 140) })}
                    />
                  ) : null}
                </View>
              ) : (
                <T tone="muted">{files ? say('No changed files to show.') : say('Loading files…')}</T>
              )}
            </>
          ) : null}
        </ScrollView>
      </ReferenceContext.Provider>
      {pr ? (
        <PullRequestActionBar
          busy={!!busy}
          primary={primary}
          shortcut={
            thread ? { icon: MessagesSquare, label: say('Open thread'), onPress: () => openTask(thread.taskId) } : null
          }
          note={
            !online
              ? { text: say('Offline · reconnect to act on it') }
              : !canWrite
                ? { icon: Eye, text: say('View only') }
                : null
          }
        />
      ) : null}
      {commenting ? (
        <LineCommentSheet
          path={commenting.path}
          line={commenting.line}
          startLine={commenting.startLine}
          initial={commenting.body}
          onClose={() => setCommenting(null)}
          onAdd={(body) => {
            const { id, path, line, startLine } = commenting
            setPending((current) =>
              id
                ? current.map((comment) => (comment.id === id ? { ...comment, body } : comment))
                : [
                    ...current,
                    { id: `${path}:${line}:${Date.now()}`, path, line, ...(startLine ? { startLine } : {}), body },
                  ],
            )
          }}
          onRemove={
            commenting.id
              ? () => setPending((current) => current.filter((comment) => comment.id !== commenting.id))
              : undefined
          }
        />
      ) : null}
      {finishing && pr ? (
        <FinishReviewSheet
          service={service}
          own={mine}
          pending={pending}
          busy={busy === 'submit-review'}
          error={reviewError}
          onRemove={(id) => setPending((current) => current.filter((comment) => comment.id !== id))}
          onSubmit={(verdict, body) => void submitReview(verdict, body)}
          onClose={() => setFinishing(false)}
        />
      ) : null}
      {choosingHost ? (
        <Sheet open onClose={() => setChoosingHost(false)} title={say('Host for this pull request')}>
          <SheetGroup footer={say('Its thread and checkout are on this host')}>
            {hostChoices.map((choice) => {
              const pc = store.computers.find((entry) => entry.id === choice.host)
              return (
                <SheetOption
                  key={choice.host}
                  title={say('On {0}', { 0: pc?.name ?? choice.host })}
                  trailing={pc ? <ConnectionDot status={pc.status} /> : undefined}
                  selected={choice.host === computerId}
                  onPress={() => {
                    setChoosingHost(false)
                    if (choice.host === computerId) return
                    router.replace({
                      pathname: '/pull-request',
                      params: { computer: choice.host, project: choice.projectId, repoId: choice.repoId, url },
                    })
                  }}
                />
              )
            })}
          </SheetGroup>
        </Sheet>
      ) : null}
      {merging && pr ? (
        <MergeSheet
          computerId={computerId}
          taskId={taskId}
          repoId={repoId}
          url={url}
          service={service}
          whenReady={mergeOffer === 'when-ready'}
          threadTaskId={thread?.taskId ?? null}
          onClose={(merged) => {
            setMerging(false)
            if (merged) void read(true)
          }}
        />
      ) : null}
      {pr ? (
        <Sheet open={more} onClose={() => setMore(false)} title={say('Pull request actions')}>
          {sections.map((entries) => (
            <SheetGroup key={entries[0]!.section}>
              {entries.map((entry) => (
                <SheetOption
                  key={entry.key}
                  icon={entry.icon}
                  title={entry.label}
                  danger={entry.destructive}
                  onPress={() => {
                    setMore(false)
                    // iOS presents the next sheet or alert only once this one has gone.
                    setTimeout(entry.run, 300)
                  }}
                />
              ))}
            </SheetGroup>
          ))}
        </Sheet>
      ) : null}
      {people && pr ? (
        <PeopleSheet
          kind={people}
          current={people === 'reviewers' ? pr.requestedReviewers : people === 'labels' ? (pr.labels ?? []) : []}
          busy={busy === people}
          error={error}
          onClose={() => setPeople(null)}
          onSave={(add, remove) =>
            void write(
              people,
              people === 'reviewers'
                ? { kind: 'reviewers', add, remove }
                : { kind: 'update', update: { [people]: { add, remove } } },
            ).then((done) => done && setPeople(null))
          }
        />
      ) : null}
      <BottomSearch
        placement="header"
        value={search}
        onChangeText={setSearch}
        placeholder={tab === 'files' ? say('Search files and changes') : say('Search comments, people or files')}
      />
    </Screen>
  )
}

/** Merge with a method the repository allows, after saying what blocks it; then tidy up the thread. */
function MergeSheet({
  computerId,
  taskId,
  repoId,
  url,
  service,
  whenReady,
  threadTaskId,
  onClose,
}: {
  computerId: string
  taskId: string
  repoId: string
  url: string
  service: ForgeService
  /** The service will not take a merge yet, so the sheet opens on leaving it to merge on its own. */
  whenReady: boolean
  threadTaskId: string | null
  onClose: (merged: boolean) => void
}) {
  const say = useSay()
  const store = useStore()
  const { c } = useTheme()
  const [options, setOptions] = useState<MergeOptions | null>(null)
  const [method, setMethod] = useState<MergeMethod | null>(null)
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [markDone, setMarkDone] = useState(true)
  const [whenChecksPass, setWhenChecksPass] = useState(whenReady)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    store
      .invoke(computerId, 'forge.mergeOptions', taskId, repoId, url)
      .then(setOptions, (e: unknown) => setError(message(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads once per pull request
  }, [computerId, taskId, repoId, url])
  const methods = options?.methods ?? []
  const chosen = method && methods.includes(method) ? method : (methods[0] ?? null)
  const blockers = options?.blockers ?? []

  const merge = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    try {
      await store.invoke(computerId, 'forge.pullRequestAction', taskId, repoId, url, {
        kind: whenChecksPass ? 'auto-merge' : 'merge',
        method: chosen,
        deleteBranch: deleteBranch && !!options?.canDeleteBranch,
      })
      // An automatic merge happens later, so its thread stays open until it does.
      if (markDone && threadTaskId && !whenChecksPass)
        await store.invoke(computerId, 'tasks.done', threadTaskId, true).catch(() => {})
      onClose(true)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={() => !busy && onClose(false)} title={say('Merge pull request')}>
      {!options && !error ? <PageLoader style={{ marginVertical: space.l }} /> : null}
      {blockers.length ? (
        <View
          style={{
            marginHorizontal: space.l,
            padding: space.m,
            gap: space.xs,
            borderRadius: radius.m,
            backgroundColor: c.warnWash,
          }}
        >
          {blockers.map((blocker) => (
            <View key={blocker} style={{ flexDirection: 'row', gap: space.s }}>
              <CircleAlert size={15} color={c.warn} style={{ marginTop: 2 }} />
              <T size={font.control} tone="warn" style={{ flex: 1 }}>
                {say(blocker)}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      {methods.length ? (
        <SheetGroup title={say('Merge method')}>
          {methods.map((value) => (
            <SheetOption
              key={value}
              title={say(METHOD_LABEL[value])}
              selected={value === chosen}
              onPress={() => setMethod(value)}
            />
          ))}
        </SheetGroup>
      ) : null}
      {options?.canDeleteBranch || threadTaskId || supportsPullRequest(service, 'auto-merge') ? (
        <SheetGroup>
          {supportsPullRequest(service, 'auto-merge') ? (
            <SheetOption
              title={say('Merge automatically once required checks pass')}
              trailing={
                <Toggle
                  value={whenChecksPass}
                  onValueChange={setWhenChecksPass}
                  accessibilityLabel={say('Merge automatically once required checks pass')}
                />
              }
            />
          ) : null}
          {options?.canDeleteBranch ? (
            <SheetOption
              title={say('Delete the branch on the hosting service')}
              trailing={
                <Toggle
                  value={deleteBranch}
                  onValueChange={setDeleteBranch}
                  accessibilityLabel={say('Delete the branch on the hosting service')}
                />
              }
            />
          ) : null}
          {threadTaskId && !whenChecksPass ? (
            <SheetOption
              title={say('Mark its thread done')}
              trailing={
                <Toggle value={markDone} onValueChange={setMarkDone} accessibilityLabel={say('Mark its thread done')} />
              }
            />
          ) : null}
        </SheetGroup>
      ) : null}
      <View style={{ paddingHorizontal: space.l, paddingBottom: space.l, gap: space.s }}>
        {error ? (
          <T size={font.control} tone="bad" accessibilityLiveRegion="polite">
            {error}
          </T>
        ) : null}
        <Button
          icon={GitMerge}
          title={busy ? say('Merging…') : whenChecksPass ? say('Merge when checks pass') : say('Merge')}
          disabled={busy || !chosen || (!!blockers.length && !whenChecksPass)}
          onPress={() => void merge()}
        />
      </View>
    </Sheet>
  )
}
