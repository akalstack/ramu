import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowUpRight } from 'lucide-react-native'
import {
  broughtBack,
  cloneForContinuation,
  continueOnHost,
  latestReply,
  type ContinuationMatch,
  type ContinuationPackage,
  type ContinuedEvent,
} from '@ramu/shared/continuation'
import type { AgentEvent, AgentSessionInfo, AgentSettings } from '@ramu/shared/types'
import { correlationId } from '../runtime/correlationId'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { TextField } from './ScheduleFields'
import { Button, Sheet, T } from './ui'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

interface Prepared {
  pack: ContinuationPackage
  match: ContinuationMatch | null
  settings: AgentSettings
  parent: string
}

/** The phone's Continue on another host: the same rows and one confirmation as the desktop. */
export function ContinueOnHostSheet({
  chat,
  targetId,
  onClose,
}: {
  chat: Chat
  targetId: string | null
  onClose: () => void
}) {
  const say = useSay()
  const store = useStore()
  const invoke = store.invoke as unknown as Invoke
  const target = store.computers.find((pc) => pc.id === targetId)
  const here = store.computers.find((pc) => pc.id === chat.computerId)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [useNamed, setUseNamed] = useState(false)
  const [key] = useState(correlationId)
  useEffect(() => {
    if (!targetId) return
    let live = true
    setPrepared(null)
    setError('')
    void (async () => {
      const pack = (await invoke(chat.computerId, 'threads.continuationPackage', chat.taskId)) as ContinuationPackage
      const remote = pack.repo
        ? ((await invoke(targetId, 'threads.prepareContinuation', pack.repo, pack.settings)) as Omit<Prepared, 'pack'>)
        : { match: null, settings: pack.settings, parent: '' }
      if (live) setPrepared({ pack, ...remote })
    })().catch((cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)))
    return () => {
      live = false
    }
  }, [targetId, chat.computerId, chat.taskId]) // eslint-disable-line react-hooks/exhaustive-deps -- `invoke` is stable per store
  const pack = prepared?.pack
  const repo = pack?.repo
  const match = prepared?.match
  const start = async () => {
    if (!prepared || !repo || !target || !here) return
    setBusy(true)
    setError('')
    try {
      const existing = match && (match.by === 'remote' || useNamed) ? match.projectId : null
      const projectId =
        existing ?? (await cloneForContinuation(invoke, target.id, repo, prepared.parent, correlationId())).id
      await continueOnHost(
        invoke,
        { id: target.id, name: target.name },
        {
          key,
          from: { hostId: here.id, hostName: here.name, taskId: chat.taskId, title: prepared.pack.title },
          projectId,
          branch: repo.pushed ? repo.branch : '',
          prompt: prepared.pack.prompt,
          ...(note.trim() ? { note: note.trim() } : {}),
          settings: prepared.settings,
        },
      )
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const line = (text: string, tone?: 'bad' | 'warn') => (
    <T key={text} size={font.control} tone={tone}>
      {text}
    </T>
  )
  return (
    <Sheet
      open={!!targetId}
      onClose={() => !busy && onClose()}
      title={say('Continue on {0}', { 0: target?.name ?? '' })}
    >
      <View style={{ padding: space.l, gap: space.s }}>
        <T size={font.caption} tone="muted">
          {say(
            'The conversation travels with secrets removed, and can quote code and uncommitted content. Files stay here, and that host may use a different provider account.',
          )}
        </T>
        {!prepared && !error ? line(say('Loading…')) : null}
        {pack?.problem === 'no-remote'
          ? line(
              say(
                'This project has no Git remote, so another host has nothing to start from. Add a remote and push first.',
              ),
              'bad',
            )
          : null}
        {pack?.problem === 'several-repositories'
          ? line(
              say('A multi-repository workspace must already exist on that host, and this one cannot be matched yet.'),
              'bad',
            )
          : null}
        {pack?.problem === 'no-agent' ? line(say('This thread has no conversation to continue yet.'), 'bad') : null}
        {pack?.running ? line(say('Stop this thread first. A running agent never moves.'), 'bad') : null}
        {repo
          ? line(
              repo.pushed
                ? say('Starts from {0} at {1}', { 0: repo.branch, 1: repo.commit.slice(0, 7) })
                : say('{0} is not pushed, so that host starts from its default branch', { 0: repo.branch }),
            )
          : null}
        {repo && (repo.dirtyFiles || repo.unpushed)
          ? line(
              say('Left behind: {0} changed files and {1} unpushed commits. Commit and push first to bring them.', {
                0: repo.dirtyFiles,
                1: repo.unpushed,
              }),
              'warn',
            )
          : null}
        {pack?.queued ? line(say('{0} queued messages stay here', { 0: pack.queued })) : null}
        {repo && match && (match.by === 'remote' || useNamed) ? line(say('Project: {0}', { 0: match.name })) : null}
        {repo && match?.by === 'name' && !useNamed ? (
          <>
            {line(say('{0} has the same name but a different remote.', { 0: match.name }))}
            <Button kind="secondary" title={say('Use {0}', { 0: match.name })} onPress={() => setUseNamed(true)} />
          </>
        ) : null}
        {repo && !match
          ? line(
              say('Set up on {0}: clones {1} into {2}', {
                0: target?.name ?? '',
                1: repo.repoName,
                2: prepared?.parent ?? '',
              }),
            )
          : null}
        {prepared
          ? line(say('Runs {0} with Allow edits', { 0: prepared.settings.model || prepared.settings.provider }))
          : null}
        <TextField placeholder={say('Add a note')} value={note} onChangeText={setNote} />
        {error ? line(error, 'bad') : null}
        <Button
          title={busy ? say('Starting…') : say('Continue on {0}', { 0: target?.name ?? '' })}
          disabled={!pack || !!pack.problem || pack.running || busy || (match?.by === 'name' && !useNamed)}
          onPress={() => void start()}
        />
        <Button kind="ghost" title={say('Cancel')} disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  )
}

/** Links the original to its continuation; nothing comes back or gets archived unless the person asks. */
export function ContinuedCard({ event, chat }: { event: ContinuedEvent; chat: Chat }) {
  const { c } = useTheme()
  const say = useSay()
  const router = useRouter()
  const store = useStore()
  const invoke = store.invoke as unknown as Invoke
  const [error, setError] = useState('')
  const bringBack = async () => {
    setError('')
    try {
      const sessions = (await invoke(event.hostId, 'agent.list', event.taskId)) as AgentSessionInfo[]
      const session = sessions.at(-1)
      if (!session) throw new Error(say('That thread has no agent.'))
      if (['starting', 'running', 'needs-input'].includes(session.state))
        throw new Error(say('That thread is still working.'))
      const tail = (await invoke(event.hostId, 'agent.tail', session.id)) as { events: { event: AgentEvent }[] }
      const reply = latestReply(tail.events)
      if (!reply) throw new Error(say('That thread has no reply yet.'))
      await invoke(chat.computerId, 'agent.submit', chat.sessionId, broughtBack(event.host, reply), 'queue')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <View style={{ gap: space.xs, paddingVertical: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        <ArrowUpRight size={14} color={c.muted} />
        <T size={font.caption} tone="muted" style={{ flex: 1 }}>
          {say('Continued on {0}', { 0: event.host })}
        </T>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        <Button
          kind="ghost"
          title={say('Open')}
          onPress={() =>
            router.push({ pathname: '/chat/[id]', params: { id: store.resolveChat(event.hostId, event.taskId) } })
          }
        />
        <Button kind="ghost" title={say('Bring back result')} onPress={() => void bringBack()} />
      </View>
      {error ? (
        <T size={font.caption} tone="bad">
          {error}
        </T>
      ) : null}
    </View>
  )
}
