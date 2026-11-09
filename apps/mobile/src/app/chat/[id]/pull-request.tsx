import { useCallback, useEffect, useState } from 'react'
import { PullRequestFilesList } from '../../../components/PullRequestFilesList'
import { Disclosure } from '../../../components/Motion'
import { PullRequestMarkdown } from '../../../components/PullRequestMarkdown'
import { ActivityIndicator, Alert, Linking, Pressable, RefreshControl, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Bot,
  CircleAlert,
  Ellipsis,
  ExternalLink,
  GitMerge,
  MessageSquare,
  MessagesSquare,
  RotateCcw,
  SquareArrowOutUpRight,
  X,
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
  pullRequestNextStep,
  pullRequestRef,
  pullRequestStage,
  shownReviewThreads,
  type PullRequestNextStep,
  type ReviewThreadFilter,
} from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost } from '../../../runtime/viewerAccess'
import { openPullRequestThread } from '../../../runtime/pullRequestThread'
import { ago, useSay } from '../../../i18n'
import { Header, HeaderButton, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { Button, Card, Chip, Divider, Segmented, Sheet, T, Toggle } from '../../../components/ui'
import { ChecksLine, PullRequestGlyph, StageText } from '../../../components/PullRequestParts'
import { ReviewDrafts } from '../../../components/ReviewDrafts'
import { PeopleSheet, PullRequestComments, ReactionRow } from '../../../components/PullRequestComments'
import { supportsPullRequest } from '@ramu/shared/pullRequestSupport'
import type { ForgeService, PullRequestWrite } from '@ramu/shared/types'
import { pullRequestCopy } from '../../../runtime/pullRequestCopy'

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
}

/** What each timeline event says after its actor, the same English copy keys as the desktop. */
const TIMELINE_SAID: Record<PullRequestTimelineEvent['kind'], string> = {
  commit: 'committed',
  review: 'reviewed',
  comment: 'commented',
  'review-requested': 'asked for a review from {0}',
  'force-pushed': 'force-pushed the branch',
  ready: 'marked it ready for review',
  merged: 'merged it',
  closed: 'closed it',
  reopened: 'reopened it',
}
const TIMELINE_VERDICT: Record<NonNullable<PullRequestTimelineEvent['verdict']>, string> = {
  approved: 'approved',
  'changes-requested': 'requested changes',
  commented: 'reviewed',
  dismissed: 'had a review dismissed',
}

/** The Overview's action for each next step, the same English copy keys as the desktop; waiting steps only say why. */
const NEXT_ACTION: Partial<Record<PullRequestNextStep, string>> = {
  merge: 'Merge…',
  'fix-checks': 'Fix failing checks',
  'resolve-conflicts': 'Resolve conflicts',
  'update-branch': 'Update branch',
  'address-comments': 'Address review comments',
  'mark-ready': 'Ready for review',
  review: 'Review with agent',
}
const NEXT_WAITING: Partial<Record<PullRequestNextStep, string>> = {
  'send-replies': 'Replies are drafted below, waiting for you to check and send them.',
  'wait-checks': 'Waiting for checks to finish.',
  'wait-review': 'Waiting for a review.',
  'wait-agent': 'An agent is working on the feedback.',
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))
const rawId = (id: string) => id.slice(id.indexOf(':') + 1)

/**
 * One pull request in full, as the desktop shows it: where it stands, what the agent drafted for it, its open review
 * threads, and every action from opening it in a thread to merging it. A view-only device sees it all and changes nothing.
 */
export default function PullRequestScreen() {
  const say = useSay()
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
  const taskId = chat?.taskId ?? (params.project ? `project:${params.project}` : '')
  const projectId = chat?.projectId ? rawId(chat.projectId) : (params.project ?? null)
  const computer = store.computers.find((pc) => pc.id === computerId)
  const canWrite = canWriteHost(computer)
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
  const [timeline, setTimeline] = useState<PullRequestTimelineEvent[] | null>(kept?.timeline ?? null)
  const [timelineOpen, setTimelineOpen] = useState(false)
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
  const shownThreads = shownReviewThreads(threads ?? [], threadFilter, threadOrder)
  const step = pr && stage ? pullRequestNextStep(pr, stage, mine) : 'none'
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

  return (
    <Screen bg="canvas">
      <Header
        title={pr ? pullRequestRef(service, pr.number) : say('Pull request')}
        subtitle={pr?.title}
        right={
          pr ? (
            <HeaderButton
              icon={ExternalLink}
              label={say('Open on {0}', { 0: FORGE_NAMES[service] })}
              systemIcon="safari"
              onPress={() => void Linking.openURL(pr.url).catch(() => {})}
            />
          ) : null
        }
      />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: space.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={c.muted} />
        }
      >
        {!loaded ? <ActivityIndicator color={c.muted} style={{ paddingVertical: space.xl }} /> : null}
        {loaded && !pr ? (
          <View style={{ gap: space.m }}>
            <T tone={error ? 'bad' : 'muted'}>{error ?? say('This pull request was not found with this account.')}</T>
            <Button kind="secondary" title={say('Try again')} onPress={() => void pullToRefresh()} />
          </View>
        ) : null}
        {pr && stage ? (
          <>
            <View style={{ gap: space.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.s }}>
                <View style={{ paddingTop: 4 }}>
                  <PullRequestGlyph pr={pr} stage={stage} size={18} />
                </View>
                <T size={font.heading} weight="600" style={{ flex: 1 }}>
                  {pr.title}
                </T>
              </View>
              <View
                style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.m, rowGap: 4 }}
              >
                <StageText stage={stage} />
                {pr.author ? (
                  <T size={font.caption} tone="muted">
                    {pr.author}
                  </T>
                ) : null}
                <ChecksLine checks={pr.checks} />
                {pr.reviewDecision === 'approved' ? (
                  <T size={font.caption} tone="ok">
                    {say('Approved')}
                  </T>
                ) : pr.reviewDecision === 'changes-requested' ? (
                  <T size={font.caption} tone="warn">
                    {say('Changes requested')}
                  </T>
                ) : null}
                {pr.fork ? (
                  <T size={font.caption} tone="muted">
                    {say('From a fork')}
                  </T>
                ) : null}
              </View>
              <T size={font.caption} tone="muted" mono numberOfLines={2}>
                {`${pr.headBranch} → ${pr.baseBranch}`}
              </T>
              {pr.requestedReviewers.length ? (
                <T size={font.caption} tone="muted">
                  {say('Review requested from {0}', { 0: pr.requestedReviewers.join(', ') })}
                </T>
              ) : null}
            </View>

            <View style={{ gap: space.s }}>
              {thread ? (
                <Button
                  icon={SquareArrowOutUpRight}
                  title={say('Open thread')}
                  onPress={() => openTask(thread.taskId)}
                />
              ) : open && canWrite ? (
                <Button
                  icon={MessagesSquare}
                  title={busy === 'work' ? say('Starting…') : say('Open in thread')}
                  disabled={!!busy || (pr.fork && !mine)}
                  onPress={() => void openThread('work')}
                />
              ) : null}
              {open && !mine && !thread && canWrite ? (
                <Button
                  kind="secondary"
                  icon={Bot}
                  title={busy === 'review' ? say('Starting…') : say('Review with agent')}
                  disabled={!!busy}
                  onPress={() => void openThread('review')}
                />
              ) : null}
              {open && thread && mine && openThreads.length && canWrite ? (
                <Button
                  kind="secondary"
                  icon={MessageSquare}
                  title={busy === 'reviews' ? say('Starting…') : say('Address review comments')}
                  disabled={!!busy}
                  onPress={() => void sendThreadsToAgent(thread.taskId)}
                />
              ) : null}
              {open && canWrite ? (
                <>
                  {pr.draft ? (
                    <Button
                      kind="secondary"
                      title={busy === 'ready' ? say('Working…') : say('Ready for review')}
                      disabled={!!busy}
                      onPress={() => void act({ kind: 'ready' })}
                    />
                  ) : null}
                  {pr.mergeable === 'behind' || pr.mergeable === 'conflicts' ? (
                    <Button
                      kind="secondary"
                      icon={RotateCcw}
                      title={
                        busy === 'update-branch'
                          ? say('Updating…')
                          : pr.mergeable === 'conflicts'
                            ? say('Resolve conflicts')
                            : say('Update branch')
                      }
                      disabled={!!busy}
                      onPress={() => void updateBranch()}
                    />
                  ) : null}
                  {pr.checks === 'failure' && supportsPullRequest(service, 'rerun-checks') ? (
                    <Button
                      kind="secondary"
                      title={busy === 'rerun' ? say('Working…') : say('Re-run failed checks')}
                      disabled={!!busy}
                      onPress={() => void write('rerun', { kind: 'rerun-checks' })}
                    />
                  ) : null}
                  {/* Merge stays one tap away; the rarer changes and Close wait behind More actions. */}
                  <View style={{ flexDirection: 'row', gap: space.s }}>
                    <Button
                      kind="secondary"
                      icon={GitMerge}
                      title={say('Merge…')}
                      disabled={!!busy || pr.draft}
                      onPress={() => setMerging(true)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      kind="secondary"
                      icon={Ellipsis}
                      title={say('More actions')}
                      disabled={!!busy}
                      onPress={() => setMore(true)}
                      style={{ flex: 1 }}
                    />
                  </View>
                </>
              ) : pr.state === 'closed' && canWrite ? (
                <Button
                  kind="secondary"
                  title={busy === 'reopen' ? say('Working…') : say('Reopen')}
                  disabled={!!busy}
                  onPress={() => void act({ kind: 'reopen' })}
                />
              ) : null}
              {open && pr.mergeable === 'conflicts' && canWrite ? (
                <T size={font.caption} tone="muted">
                  {say('Merges the base branch in the thread working on it, so you can resolve the conflicts there')}
                </T>
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
              {pr.fork && !mine && open ? (
                <T size={font.caption} tone="muted">
                  {say(
                    'This pull request comes from a fork. An agent can review it here, but only its author can push to it.',
                  )}
                </T>
              ) : null}
            </View>

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
                {pr && pr.state === 'open' ? (
                  <Card style={{ padding: space.m, gap: space.s }}>
                    {[
                      {
                        tone:
                          pr.checks === 'success'
                            ? 'ok'
                            : pr.checks === 'failure'
                              ? 'bad'
                              : pr.checks === 'pending'
                                ? 'warn'
                                : 'muted',
                        text:
                          pr.checks === 'success'
                            ? say('All checks passed')
                            : pr.checks === 'failure'
                              ? say('Checks failing')
                              : pr.checks === 'pending'
                                ? say('Checks running')
                                : say('No checks'),
                      },
                      {
                        tone:
                          pr.reviewDecision === 'approved'
                            ? 'ok'
                            : pr.reviewDecision === 'changes-requested'
                              ? 'warn'
                              : 'muted',
                        text:
                          pr.reviewDecision === 'approved'
                            ? say('Approved')
                            : pr.reviewDecision === 'changes-requested'
                              ? say('Changes requested')
                              : say('Waiting on review'),
                      },
                      {
                        tone:
                          pr.mergeable === 'clean'
                            ? 'ok'
                            : pr.mergeable === 'conflicts'
                              ? 'bad'
                              : pr.mergeable === 'unknown'
                                ? 'muted'
                                : 'warn',
                        text:
                          pr.mergeable === 'conflicts'
                            ? say('Has conflicts with its base branch')
                            : pr.mergeable === 'behind'
                              ? say('Behind its base branch')
                              : pr.mergeable === 'blocked'
                                ? say('Blocked by the branch rules')
                                : pr.mergeable === 'clean'
                                  ? say('No conflicts with its base branch')
                                  : say('Mergeability not known yet'),
                      },
                      {
                        tone: openThreads.length ? 'warn' : 'ok',
                        text: openThreads.length
                          ? say('{0} unresolved conversations', { 0: openThreads.length })
                          : say('All conversations resolved'),
                      },
                    ].map((row) => (
                      <View key={row.text} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                        <View
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: 4,
                            backgroundColor:
                              row.tone === 'ok'
                                ? c.ok
                                : row.tone === 'bad'
                                  ? c.bad
                                  : row.tone === 'warn'
                                    ? c.warn
                                    : c.lineStrong,
                          }}
                        />
                        <T size={font.control} tone="soft" style={{ flex: 1 }}>
                          {row.text}
                        </T>
                      </View>
                    ))}
                    {NEXT_ACTION[step] && canWrite ? (
                      <Button title={say(NEXT_ACTION[step]!)} disabled={!!busy} onPress={takeStep} />
                    ) : NEXT_WAITING[step] ? (
                      <T size={font.caption} tone="muted">
                        {say(NEXT_WAITING[step]!)}
                      </T>
                    ) : null}
                  </Card>
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
                    <PullRequestMarkdown text={description} />
                  </View>
                ) : null}

                {timeline?.length ? (
                  <View style={{ gap: space.xs }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: timelineOpen }}
                      onPress={() => setTimelineOpen((value) => !value)}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 }}
                    >
                      <Disclosure open={timelineOpen} size={14} color={c.muted} />
                      <T size={font.control} weight="600" tone="muted">
                        {say('Timeline')}{' '}
                        <T size={font.control} tone="placeholder">
                          {`${timeline.length} · ${ago(timeline.at(-1)!.at)}`}
                        </T>
                      </T>
                    </Pressable>
                    {timelineOpen
                      ? timeline.map((event, index) => (
                          <View key={`${event.kind}:${event.at}:${index}`} style={{ gap: 1 }}>
                            <T size={font.caption}>
                              {`${event.actor ?? say('Someone')} `}
                              <T
                                size={font.caption}
                                tone={
                                  event.verdict === 'approved'
                                    ? 'ok'
                                    : event.verdict === 'changes-requested'
                                      ? 'warn'
                                      : 'muted'
                                }
                              >
                                {event.kind === 'review' && event.verdict
                                  ? say(TIMELINE_VERDICT[event.verdict])
                                  : say(TIMELINE_SAID[event.kind], { 0: event.text ?? '' })}
                              </T>
                              <T size={font.caption} tone="placeholder">{` · ${ago(event.at)}`}</T>
                            </T>
                            {event.text && event.kind !== 'review-requested' ? (
                              <T size={font.caption} tone="soft" numberOfLines={2}>
                                {event.text}
                              </T>
                            ) : null}
                          </View>
                        ))
                      : null}
                  </View>
                ) : null}

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
                      {threadFilter === 'open' ? say('No open review threads.') : say('No review threads here.')}
                    </T>
                  ) : (
                    shownThreads.map((entry) => (
                      <Card key={entry.id} style={{ padding: space.m, gap: space.s }}>
                        <T size={font.caption} tone="muted" mono numberOfLines={2}>
                          {(entry.path ? `${entry.path}${entry.line ? `:${entry.line}` : ''}` : say('Conversation')) +
                            (entry.outdated ? ` · ${say('Outdated')}` : '') +
                            (entry.resolved ? ` · ${say('Resolved')}` : '')}
                        </T>
                        {entry.comments.map((comment, index) => (
                          <View key={comment.id} style={{ gap: space.xs }}>
                            {index ? <Divider /> : null}
                            <View
                              style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}
                            >
                              <T size={font.control} weight="600">
                                {comment.author ?? say('Someone')}
                              </T>
                              {comment.bot ? (
                                <T size={font.caption} tone="muted">
                                  {say('bot')}
                                </T>
                              ) : null}
                              {!comment.trusted ? (
                                <T size={font.caption} tone="warn">
                                  {say('From outside the project')}
                                </T>
                              ) : null}
                            </View>
                            <PullRequestMarkdown text={comment.body} />
                            {canWrite ? (
                              <ReactionRow
                                service={service}
                                disabled={!!busy}
                                onReact={(reaction) =>
                                  void write('react', { kind: 'react', commentId: comment.id, reaction, remove: false })
                                }
                              />
                            ) : null}
                          </View>
                        ))}
                        {canWrite && open && entry.resolvable ? (
                          <Button
                            kind="secondary"
                            title={entry.resolved ? say('Reopen thread') : say('Resolve thread')}
                            disabled={!!busy}
                            onPress={() =>
                              void write('thread', {
                                kind: 'thread-status',
                                threadId: entry.id,
                                status: entry.resolved ? 'active' : 'resolved',
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
              <PullRequestFilesList files={files.files} more={files.more} threads={threads ?? []} />
            ) : (
              <T tone="muted">{files ? say('No changed files to show.') : say('Loading files…')}</T>
            )}
          </>
        ) : null}
      </ScrollView>
      {merging && pr ? (
        <MergeSheet
          computerId={computerId}
          taskId={taskId}
          repoId={repoId}
          url={url}
          service={service}
          threadTaskId={thread?.taskId ?? null}
          onClose={(merged) => {
            setMerging(false)
            if (merged) void read(true)
          }}
        />
      ) : null}
      {pr ? (
        <Sheet open={more} onClose={() => setMore(false)} title={say('Pull request actions')}>
          {(['reviewers', 'labels', 'assignees'] as const).some((kind) => supportsPullRequest(service, kind)) ? (
            <SheetGroup>
              {(['reviewers', 'labels', 'assignees'] as const)
                .filter((kind) => supportsPullRequest(service, kind))
                .map((kind) => (
                  <SheetOption
                    key={kind}
                    title={say(kind === 'reviewers' ? 'Reviewers…' : kind === 'labels' ? 'Labels…' : 'Assignees…')}
                    onPress={() => {
                      setMore(false)
                      setError(null)
                      // iOS presents the next sheet only once this one has gone.
                      setTimeout(() => setPeople(kind), 300)
                    }}
                  />
                ))}
            </SheetGroup>
          ) : null}
          <SheetGroup>
            {!pr.draft && supportsPullRequest(service, 'draft') ? (
              <SheetOption
                title={say('Back to draft')}
                onPress={() => {
                  setMore(false)
                  void act({ kind: 'draft' })
                }}
              />
            ) : null}
            <SheetOption
              icon={X}
              title={say('Close pull request')}
              danger
              onPress={() => {
                setMore(false)
                setTimeout(() => confirmClose(pr.number), 300)
              }}
            />
          </SheetGroup>
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
  threadTaskId,
  onClose,
}: {
  computerId: string
  taskId: string
  repoId: string
  url: string
  service: ForgeService
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
  const [whenChecksPass, setWhenChecksPass] = useState(false)
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
      {!options && !error ? <ActivityIndicator color={c.muted} style={{ paddingVertical: space.l }} /> : null}
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
