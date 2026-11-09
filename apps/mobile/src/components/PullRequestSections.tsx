import { useCallback, useEffect, useState } from 'react'
import { Linking, Pressable, View } from 'react-native'
import { useRouter } from 'expo-router'
import {
  Eye,
  ChevronDown,
  ChevronRight,
  GitPullRequest,
  Globe,
  MessageSquare,
  PanelRight,
  Wrench,
} from 'lucide-react-native'
import { previewLine } from '@ramu/shared/deployText'
import type { Deployment } from '@ramu/shared/types/deploy'
import type {
  ForgeStatus,
  PullRequestFeedbackKind,
  PullRequestInfo,
  PullRequestSummary,
  PullRequestWatchStatus,
} from '@ramu/shared/types'
import { pullRequestStage } from '@ramu/shared/pullRequests'
import { font, radius, space, useTheme } from '../theme'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { Button, Card, Sheet, T, tap } from './ui'
import { SheetGroup, SheetOption } from './SheetOptions'
import { CreatePullRequest } from './CreatePullRequest'
import { ChecksLine, PullRequestGlyph, StageText } from './PullRequestParts'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The hosting service's own sign-in problems, said as the next step on the host. */
export function unavailableText(availability: ForgeStatus['availability']) {
  return availability === 'no-cli' || availability === 'signed-out' || availability === 'choose-account'
    ? 'Sign in to the hosting service on the host to see pull requests.'
    : null
}

/** The branch's checks rolled up into the list's one state. */
function rolledChecks(checks: PullRequestInfo['checks']): PullRequestSummary['checks'] {
  if (checks.some((check) => check.state === 'failure')) return 'failure'
  if (checks.some((check) => check.state === 'pending')) return 'pending'
  return checks.some((check) => check.state === 'success') ? 'success' : null
}

function openPullRequest(router: ReturnType<typeof useRouter>, chatId: string, repoId: string, url: string) {
  tap()
  router.push({ pathname: '/chat/[id]/pull-request', params: { id: chatId, repoId, url } })
}

/** The preview deployment the platform made for the pull request's branch: its address once ready, its state before. */
function PreviewRow({ line }: { line: ReturnType<typeof previewLine> }) {
  const { c } = useTheme()
  if (!line) return null
  const color = line.tone === 'bad' ? c.bad : line.tone === 'pending' ? c.warn : c.ok
  const url = line.url
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: url ? 44 : undefined }}>
      <Globe size={14} color={color} />
      <T size={font.caption} tone={url ? 'accent' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
        {line.text}
      </T>
    </View>
  )
  if (!url) return <View accessibilityLiveRegion="polite">{body}</View>
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={line.text}
      onPress={() => {
        tap()
        void Linking.openURL(url).catch(() => {})
      }}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      {body}
    </Pressable>
  )
}

/**
 * The checked-out branch's pull request: where it stands, and handing failing checks or review comments to the agent,
 * as the desktop's Source Control does. Nothing shows when the branch has none or the repository has no hosting service.
 */
export function CurrentPullRequest({
  chat,
  repoId,
  branch,
  readOnly,
  onError,
}: {
  chat: Chat
  repoId: string
  branch: string
  readOnly: boolean
  onError: (text: string) => void
}) {
  const say = useSay()
  const store = useStore()
  const router = useRouter()
  const { c } = useTheme()
  const [status, setStatus] = useState<ForgeStatus | null>(null)
  const [draftsReady, setDraftsReady] = useState(false)
  const [starting, setStarting] = useState<PullRequestFeedbackKind | null>(null)
  const [summary, setSummary] = useState<PullRequestSummary | null>(null)
  const [watch, setWatch] = useState<PullRequestWatchStatus | null>(null)
  const [picking, setPicking] = useState(false)
  const [watching, setWatching] = useState(false)
  const [preview, setPreview] = useState<Deployment | null>(null)
  const [creating, setCreating] = useState(false)
  const { computerId, taskId } = chat
  const read = useCallback(async () => {
    const next = await store.invoke(computerId, 'forge.pullRequest', taskId, repoId)
    setStatus(next)
    const pr = next.pullRequest
    if (pr?.state === 'open') {
      // The branch's own read has no mergeability; the repository's list does, so conflicts show here too.
      const [batch, list, watched, deployed] = await Promise.all([
        store.invoke(computerId, 'forge.drafts', pr.url).catch(() => null),
        store.invoke(computerId, 'forge.pullRequests', taskId, repoId, false, false).catch(() => null),
        store.invoke(computerId, 'forge.watchStatus', taskId, repoId, pr.url).catch(() => null),
        // A project with no platform, or a viewer pairing, simply shows no preview.
        store.invoke(computerId, 'deploy.preview', taskId, repoId, pr.headBranch).catch(() => null),
      ])
      setDraftsReady(!!batch)
      setSummary(list?.pullRequests.find((entry) => entry.url === pr.url) ?? null)
      setWatch(watched)
      setPreview(deployed)
    } else {
      setDraftsReady(false)
      setSummary(null)
      setWatch(null)
      setPreview(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
  }, [computerId, taskId, repoId])
  const openUrl = status?.pullRequest?.state === 'open' ? status.pullRequest.url : null
  useEffect(() => {
    // Read again when the branch changes, since that changes which pull request it has.
    void read().catch(() => setStatus(null))
  }, [read, branch])
  useEffect(() => {
    // Drafts and the watch change while the agent works, and an agent may open the pull request; the host announces
    // them with the thread lists. An open pull request reads only its drafts and watch again: every workspace change
    // re-reading it would spend the service's rate limit.
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = store.subscribe(computerId, (...[channel]) => {
      if (channel !== 'workspace:changed') return
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (!openUrl) return void read().catch(() => {})
        void store.invoke(computerId, 'forge.drafts', openUrl).then(
          (batch) => setDraftsReady(!!batch),
          () => {},
        )
        void store.invoke(computerId, 'forge.watchStatus', taskId, repoId, openUrl).then(setWatch, () => {})
      }, 400)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the store's invoke is stable for a host
  }, [read, computerId, taskId, repoId, openUrl])

  const pr = status?.pullRequest ?? null
  const note = status ? unavailableText(status.availability) : null
  if (note)
    return (
      <T size={font.caption} tone="muted">
        {say(note)}
      </T>
    )
  // As on the desktop: a branch without a pull request can open one, drafted from its commits.
  if (!pr)
    return readOnly || !status ? null : (
      <>
        <Button
          kind="secondary"
          icon={GitPullRequest}
          title={say('Create pull request')}
          onPress={() => setCreating(true)}
        />
        <CreatePullRequest
          computerId={computerId}
          taskId={taskId}
          repoId={repoId}
          open={creating}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void read().catch(() => {})
          }}
        />
      </>
    )
  const stage = pullRequestStage(
    summary?.url === pr.url
      ? summary
      : {
          state: pr.state,
          draft: pr.draft,
          checks: rolledChecks(pr.checks),
          reviewDecision: pr.reviewDecision,
          mergeable: 'unknown',
          openThreads: null,
        },
    { draftsReady },
  )
  const watchedThread = watch?.sessionId ? watch.threads.find((thread) => thread.id === watch.sessionId) : null
  const canPick = !readOnly && !watching && !!watch && (!!watch.threads.length || !!watch.sessionId)
  const chooseWatch = async (sessionId: string | null) => {
    setPicking(false)
    setWatching(true)
    try {
      await store.invoke(computerId, 'forge.watch', taskId, repoId, pr.url, sessionId)
      setWatch(await store.invoke(computerId, 'forge.watchStatus', taskId, repoId, pr.url))
    } catch (error) {
      onError(message(error))
    } finally {
      setWatching(false)
    }
  }
  const failing = pr.checks.some((check) => check.state === 'failure')
  const count = (state: string) => pr.checks.filter((check) => check.state === state).length
  const checks = [
    count('failure') && say('{0} failing', { 0: count('failure') }),
    count('pending') && say('{0} pending', { 0: count('pending') }),
    count('success') && say('{0} passed', { 0: count('success') }),
  ]
    .filter(Boolean)
    .join(' · ')

  const handOff = async (kind: PullRequestFeedbackKind) => {
    setStarting(kind)
    try {
      const sessionId = await store.invoke(computerId, 'forge.sendFeedback', taskId, repoId, kind)
      if (sessionId) {
        const session = await store.invoke(computerId, 'agent.get', sessionId)
        await store.refresh(computerId).catch(() => {})
        router.dismissTo({ pathname: '/chat/[id]', params: { id: store.resolveChat(computerId, session.taskId) } })
        return
      }
      // No thread watches this pull request: this thread takes the round.
      const prompt = await store.invoke(computerId, 'forge.pullRequestFeedback', taskId, repoId, kind)
      await store.send(chat.id, prompt, 'queue')
      router.dismissTo({ pathname: '/chat/[id]', params: { id: chat.id } })
    } catch (error) {
      onError(message(error))
    } finally {
      setStarting(null)
    }
  }

  return (
    <Card style={{ padding: space.l, gap: space.m }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${say('Pull request #{0}: {1}', { 0: pr.number, 1: pr.title })}, ${say('Open pull request')}`}
        onPress={() => openPullRequest(router, chat.id, repoId, pr.url)}
        style={({ pressed }) => ({ gap: 4, opacity: pressed ? 0.7 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <PullRequestGlyph pr={pr} stage={stage} size={15} />
          <T weight="600" numberOfLines={2} style={{ flex: 1 }}>
            {pr.title} <T tone="muted" weight="400">{`#${pr.number}`}</T>
          </T>
          <ChevronRight size={16} color={c.muted} />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space.m, rowGap: 2 }}>
          <StageText stage={stage} />
          {pr.checks.length ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <ChecksLine checks={rolledChecks(pr.checks)} compact />
              <T size={font.caption} tone="muted">
                {checks}
              </T>
            </View>
          ) : (
            <T size={font.caption} tone="muted">
              {say('No checks')}
            </T>
          )}
          {pr.reviewDecision === 'approved' ? (
            <T size={font.caption} tone="ok">
              {say('Approved')}
            </T>
          ) : pr.reviewDecision === 'changes-requested' ? (
            <T size={font.caption} tone="warn">
              {say('Changes requested')}
            </T>
          ) : null}
        </View>
      </Pressable>
      <PreviewRow line={previewLine(preview, say)} />
      {/* The card's title opens the pull request; a button only calls out replies waiting there. */}
      {draftsReady ? (
        <Button
          kind="secondary"
          icon={PanelRight}
          title={say('Replies ready · open pull request')}
          onPress={() => openPullRequest(router, chat.id, repoId, pr.url)}
        />
      ) : null}
      {pr.state === 'open' && !readOnly ? (
        <View style={{ flexDirection: 'row', gap: space.s }}>
          {failing ? (
            <Button
              kind="secondary"
              icon={Wrench}
              title={starting === 'checks' ? say('Starting…') : say('Fix failing checks')}
              disabled={!!starting}
              onPress={() => void handOff('checks')}
              style={{ flex: 1 }}
            />
          ) : null}
          <Button
            kind="secondary"
            icon={MessageSquare}
            title={starting === 'reviews' ? say('Starting…') : say('Address review comments')}
            disabled={!!starting}
            onPress={() => void handOff('reviews')}
            style={{ flex: 1 }}
          />
        </View>
      ) : null}
      {pr.state === 'open' && watch ? (
        <View style={{ gap: space.xs }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${say('Watch in thread')}: ${watchedThread?.title ?? say('Watch off')}`}
            accessibilityState={{ disabled: !canPick }}
            disabled={!canPick}
            onPress={() => {
              tap()
              setPicking(true)
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.s,
              minHeight: 44,
              paddingHorizontal: space.m,
              borderRadius: radius.m,
              backgroundColor: pressed ? c.raised : c.raised2,
              opacity: canPick ? 1 : 0.6,
            })}
          >
            <Eye size={15} color={watchedThread ? c.accent : c.soft} />
            <T size={font.control} weight="500" style={{ flexShrink: 0 }}>
              {say('Watch in thread')}
            </T>
            <T size={font.control} tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
              {watchedThread?.title ?? say('Watch off')}
            </T>
            <ChevronDown size={15} color={c.muted} />
          </Pressable>
          <T size={font.caption} tone="muted">
            {watch.sessionId
              ? say(
                  'New failing checks and review comments return to this thread, even with the window closed. Its replies wait for you to send.',
                )
              : say('Choose a thread to handle new failing checks and review comments automatically.')}
          </T>
        </View>
      ) : null}
      <Sheet open={picking} onClose={() => setPicking(false)} title={say('Watch in thread')}>
        <SheetGroup>
          <SheetOption title={say('Watch off')} selected={!watch?.sessionId} onPress={() => void chooseWatch(null)} />
          {(watch?.threads ?? []).map((thread) => (
            <SheetOption
              key={thread.id}
              title={thread.title}
              selected={thread.id === watch?.sessionId}
              onPress={() => void chooseWatch(thread.id)}
            />
          ))}
        </SheetGroup>
      </Sheet>
    </Card>
  )
}
