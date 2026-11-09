import { useCallback, useEffect, useRef, useState } from 'react'
import { Disclosure } from '../../../components/Motion'
import { Markdown } from '../../../components/Markdown'
import { Alert, Linking, Pressable, RefreshControl, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import {
  Bot,
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
  type PullRequestList,
  type PullRequestSummary,
  type PullRequestThread,
} from '@ramu/shared/types'
import { pullRequestStage } from '@ramu/shared/pullRequests'
import { font, space, useTheme } from '../../../theme'
import { useChat, useStore } from '../../../runtime/store'
import { canWriteHost } from '../../../runtime/viewerAccess'
import { openPullRequestThread } from '../../../runtime/pullRequestThread'
import { useSay } from '../../../i18n'
import { Header, Screen, PageScrollView as ScrollView } from '../../../components/Screen'
import { SheetGroup, SheetOption } from '../../../components/SheetOptions'
import { Button, Card, Divider, Sheet, T, Toggle } from '../../../components/ui'
import { ChecksLine, PullRequestGlyph, StageText } from '../../../components/PullRequestParts'
import { ReviewDrafts } from '../../../components/ReviewDrafts'

const METHOD_LABEL: Record<MergeMethod, string> = {
  squash: 'Squash and merge',
  merge: 'Create a merge commit',
  rebase: 'Rebase and merge',
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
  const [list, setList] = useState<PullRequestList | null>(null)
  const [pr, setPr] = useState<PullRequestSummary | null>(null)
  const [batch, setBatch] = useState<PullRequestDraftBatch | null>(null)
  const [threads, setThreads] = useState<PullRequestThread[] | null>(null)
  const [threadsError, setThreadsError] = useState<string | null>(null)
  const [description, setDescription] = useState<string | null>(null)
  const [files, setFiles] = useState<{ files: PullRequestFile[]; more: boolean } | null>(null)
  const [filesOpen, setFilesOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const read = useCallback(
    async (force: boolean) => {
      if (!computerId || !taskId) return
      if (force) await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, false, true).catch(() => {})
      try {
        let next = await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, false, false)
        let found = next.pullRequests.find((entry) => entry.url === url)
        // Merged and closed ones are only in the longer list.
        if (!found) {
          next = await store.invoke(computerId, 'forge.pullRequests', taskId, repoId, true, force)
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
                  return value
                },
                (e: unknown) => {
                  setThreadsError(message(e))
                  return null
                },
              )
            : Promise.resolve(null),
        ])
        setBatch(drafts)
        setThreads(open)
        // The description is extra: a host that cannot read it still shows everything else.
        if (found)
          void store
            .invoke(computerId, 'forge.pullRequestDescription', taskId, repoId, url)
            .then(setDescription, () => setDescription(null))
        if (found)
          void store
            .invoke(computerId, 'forge.pullRequestFiles', taskId, repoId, url)
            .then(setFiles, () => setFiles(null))
      } catch (e) {
        setError(message(e))
      } finally {
        setLoaded(true)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
    [computerId, taskId, repoId, url],
  )
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    void read(false)
    if (!computerId) return
    // Drafts arrive while the agent works; the host announces them with the thread lists.
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (channel !== 'workspace:changed') return
      clearTimeout(timer)
      timer = setTimeout(() => void readRef.current(false), 400)
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

  const run = async (label: string, work: () => Promise<unknown>) => {
    if (!canWrite) return
    setBusy(label)
    setError(null)
    try {
      await work()
      await read(true)
    } catch (e) {
      setError(message(e))
    } finally {
      setBusy(null)
    }
  }
  const act = (action: PullRequestAction) =>
    run(action.kind, () => store.invoke(computerId, 'forge.pullRequestAction', taskId, repoId, url, action))

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
  const sendThreadsToAgent = (threadTaskId: string) =>
    run('reviews', async () => {
      const sessionId = await store.invoke(computerId, 'forge.sendFeedback', threadTaskId, repoId, 'reviews')
      if (!sessionId) {
        const prompt = await store.invoke(computerId, 'forge.pullRequestFeedback', threadTaskId, repoId, 'reviews')
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
  const thread = linked.at(-1)
  const draftsReady =
    batch?.kind === 'review'
      ? !!batch.body || !!batch.comments.length
      : !!batch?.drafts.some((draft) => draft.outcome !== 'skipped' && !draft.postedId)
  const stage = pr ? pullRequestStage(pr, { draftsReady }) : null
  const open = pr?.state === 'open'
  const mine = pr?.group === 'mine'
  const openThreads = (threads ?? []).filter((entry) => !entry.resolved)

  return (
    <Screen bg="canvas">
      <Header title={pr ? `#${pr.number}` : say('Pull request')} subtitle={pr?.title} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ padding: space.l, paddingTop: space.s, gap: space.l, paddingBottom: space.xl }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void pullToRefresh()} tintColor={c.muted} />
        }
      >
        {!loaded ? <T tone="muted">{say('Loading…')}</T> : null}
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
                  {pr.title} <T size={font.heading} tone="muted" weight="400">{`#${pr.number}`}</T>
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
              <Button
                kind="ghost"
                icon={ExternalLink}
                title={say('Open on the hosting service')}
                onPress={() => void Linking.openURL(pr.url).catch(() => {})}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }}
              />
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
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
                  {pr.draft ? (
                    <Button
                      kind="secondary"
                      title={busy === 'ready' ? say('Working…') : say('Ready for review')}
                      disabled={!!busy}
                      onPress={() => void act({ kind: 'ready' })}
                      style={{ flexGrow: 1 }}
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
                      style={{ flexGrow: 1 }}
                    />
                  ) : null}
                  <Button
                    kind="secondary"
                    icon={GitMerge}
                    title={say('Merge…')}
                    disabled={!!busy || pr.draft}
                    onPress={() => setMerging(true)}
                    style={{ flexGrow: 1 }}
                  />
                  <Button
                    kind="danger"
                    icon={X}
                    title={busy === 'close' ? say('Working…') : say('Close')}
                    disabled={!!busy}
                    onPress={() => confirmClose(pr.number)}
                    style={{ flexGrow: 1 }}
                  />
                </View>
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
                <T size={font.control} tone="bad" accessibilityLiveRegion="polite">
                  {error}
                </T>
              ) : null}
              {pr.fork && !mine && open ? (
                <T size={font.caption} tone="muted">
                  {say(
                    'This pull request comes from a fork: an agent can review it here, but pushing to it needs its author.',
                  )}
                </T>
              ) : null}
            </View>

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
                <Markdown text={description} />
              </View>
            ) : null}

            {files?.files.length ? (
              <View style={{ gap: space.xs }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: filesOpen }}
                  onPress={() => setFilesOpen((value) => !value)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 32 }}
                >
                  <Disclosure open={filesOpen} size={14} color={c.muted} />
                  <T size={font.control} weight="600" tone="muted">
                    {say('Changed files')}{' '}
                    <T size={font.control} tone="placeholder">
                      {`${files.files.length}${files.more ? '+' : ''} · +${files.files.reduce((sum, file) => sum + file.additions, 0)} −${files.files.reduce((sum, file) => sum + file.deletions, 0)}`}
                    </T>
                  </T>
                </Pressable>
                {filesOpen
                  ? files.files.map((file) => (
                      <View key={file.path} style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
                        <T size={font.caption} mono numberOfLines={1} style={{ flex: 1 }}>
                          {file.path}
                        </T>
                        <T size={font.caption} tone="ok">{`+${file.additions}`}</T>
                        <T size={font.caption} tone="bad">{`−${file.deletions}`}</T>
                      </View>
                    ))
                  : null}
              </View>
            ) : null}

            <View style={{ gap: space.s }}>
              <T size={font.control} weight="600" tone="muted">
                {say('Open review threads')}
                {openThreads.length ? <T size={font.control} tone="placeholder">{` ${openThreads.length}`}</T> : null}
              </T>
              {threadsError ? (
                <T size={font.caption} tone="bad">
                  {threadsError}
                </T>
              ) : threads === null ? (
                <T tone="muted">{say('Loading…')}</T>
              ) : !openThreads.length ? (
                <T tone="muted">{say('No open review threads.')}</T>
              ) : (
                openThreads.map((entry) => (
                  <Card key={entry.id} style={{ padding: space.m, gap: space.s }}>
                    <T size={font.caption} tone="muted" mono numberOfLines={2}>
                      {(entry.path ? `${entry.path}${entry.line ? `:${entry.line}` : ''}` : say('Conversation')) +
                        (entry.outdated ? ` · ${say('Outdated')}` : '')}
                    </T>
                    {entry.comments.map((comment, index) => (
                      <View key={comment.id} style={{ gap: 2 }}>
                        {index ? <Divider /> : null}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.s }}>
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
                        <T size={font.control} tone="soft" copyable={comment.body}>
                          {comment.body}
                        </T>
                      </View>
                    ))}
                  </Card>
                ))
              )}
            </View>
          </>
        ) : null}
      </ScrollView>
      {merging && pr ? (
        <MergeSheet
          computerId={computerId}
          taskId={taskId}
          repoId={repoId}
          url={url}
          threadTaskId={thread?.taskId ?? null}
          onClose={(merged) => {
            setMerging(false)
            if (merged) void read(true)
          }}
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
  threadTaskId,
  onClose,
}: {
  computerId: string
  taskId: string
  repoId: string
  url: string
  threadTaskId: string | null
  onClose: (merged: boolean) => void
}) {
  const say = useSay()
  const store = useStore()
  const [options, setOptions] = useState<MergeOptions | null>(null)
  const [method, setMethod] = useState<MergeMethod | null>(null)
  const [deleteBranch, setDeleteBranch] = useState(true)
  const [markDone, setMarkDone] = useState(true)
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
        kind: 'merge',
        method: chosen,
        deleteBranch: deleteBranch && !!options?.canDeleteBranch,
      })
      if (markDone && threadTaskId) await store.invoke(computerId, 'tasks.done', threadTaskId, true).catch(() => {})
      onClose(true)
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }

  return (
    <Sheet open onClose={() => !busy && onClose(false)} title={say('Merge pull request')}>
      {!options && !error ? (
        <T tone="muted" style={{ paddingHorizontal: space.l }}>
          {say('Loading…')}
        </T>
      ) : null}
      {blockers.length ? (
        <View style={{ paddingHorizontal: space.l, gap: 4 }}>
          {blockers.map((blocker) => (
            <T key={blocker} size={font.control} tone="warn">
              {say(blocker)}
            </T>
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
      {options?.canDeleteBranch || threadTaskId ? (
        <SheetGroup>
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
          {threadTaskId ? (
            <SheetOption
              title={say('Mark its thread done')}
              trailing={
                <Toggle value={markDone} onValueChange={setMarkDone} accessibilityLabel={say('Mark its thread done')} />
              }
            />
          ) : null}
        </SheetGroup>
      ) : null}
      <View style={{ paddingHorizontal: space.l, gap: space.s }}>
        {error ? (
          <T size={font.control} tone="bad" accessibilityLiveRegion="polite">
            {error}
          </T>
        ) : null}
        <Button
          icon={GitMerge}
          title={busy ? say('Merging…') : say('Merge')}
          disabled={busy || !chosen || !!blockers.length}
          onPress={() => void merge()}
        />
      </View>
    </Sheet>
  )
}
