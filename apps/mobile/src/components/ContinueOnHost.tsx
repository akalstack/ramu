import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { useRouter } from 'expo-router'
import { ArrowUpRight } from 'lucide-react-native'
import {
  broughtBack,
  CONTINUE_HOSTS,
  latestReply,
  prepareTargets,
  startTargets,
  type ContinuationPackage,
  type ContinuedEvent,
  type TargetPlan,
} from '@ramu/shared/continuation'
import type { AgentEvent, AgentSessionInfo } from '@ramu/shared/types'
import { correlationId } from '../runtime/correlationId'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import type { Chat } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { TextField } from './ScheduleFields'
import { Button, Sheet, T } from './ui'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

/** The phone's Continue on another host: the same rows, hosts and one confirmation as the desktop. */
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
  const here = store.computers.find((pc) => pc.id === chat.computerId)
  const available = store.computers.filter((pc) => pc.id !== chat.computerId && pc.status === 'online')
  const [targets, setTargets] = useState<string[]>([])
  const [pack, setPack] = useState<ContinuationPackage | null>(null)
  const [plans, setPlans] = useState<Record<string, TargetPlan | { error: string }>>({})
  const [named, setNamed] = useState<Record<string, boolean>>({})
  const [outcomes, setOutcomes] = useState<Record<string, string | null>>({})
  const [keys] = useState(() => new Map<string, { key: string; cloneId: string }>())
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  if (targetId && !targets.length) setTargets([targetId])
  const key = targets.join(',')
  useEffect(() => {
    if (!key) return
    let live = true
    setError('')
    void prepareTargets(invoke, { hostId: chat.computerId, taskId: chat.taskId }, key.split(',')).then(
      (result) => {
        if (!live) return
        setPack(result.pack)
        setPlans(result.plans)
      },
      (cause: unknown) => live && setError(cause instanceof Error ? cause.message : String(cause)),
    )
    return () => {
      live = false
    }
  }, [key, chat.computerId, chat.taskId]) // eslint-disable-line react-hooks/exhaustive-deps -- `invoke` is stable per store
  const close = () => {
    setTargets([])
    setPack(null)
    setPlans({})
    setOutcomes({})
    onClose()
  }
  const name = (id: string) => available.find((pc) => pc.id === id)?.name ?? ''
  const repo = pack?.repo
  const pending = targets.filter((id) => outcomes[id] !== null)
  const ready = pending.every((id) => {
    const plan = plans[id]
    return plan && !('error' in plan) && (plan.match?.by !== 'name' || named[id])
  })
  const start = async () => {
    if (!pack || !here) return
    setBusy(true)
    setError('')
    try {
      const result = await startTargets(invoke, {
        pack,
        from: { hostId: here.id, hostName: here.name, taskId: chat.taskId, title: pack.title },
        note,
        targets: pending.map((id) => {
          if (!keys.has(id)) keys.set(id, { key: correlationId(), cloneId: correlationId() })
          return { id, name: name(id), plan: plans[id] as TargetPlan, useNamed: !!named[id], ...keys.get(id)! }
        }),
      })
      const next = { ...outcomes, ...result }
      setOutcomes(next)
      if (targets.every((id) => next[id] === null)) close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const line = (text: string, tone?: 'bad' | 'warn' | 'muted') => (
    <T key={text} size={font.control} tone={tone}>
      {text}
    </T>
  )
  const title =
    targets.length > 1
      ? say('Continue on {0} hosts', { 0: targets.length })
      : say('Continue on {0}', { 0: name(targets[0] ?? '') })
  return (
    <Sheet open={!!targetId} onClose={() => !busy && close()} title={title}>
      <View style={{ padding: space.l, gap: space.s }}>
        <T size={font.caption} tone="muted">
          {say(
            'The conversation travels with secrets removed, and can quote code and uncommitted content. Files stay here, and that host may use a different provider account.',
          )}
        </T>
        {!pack && !error ? line(say('Loading…')) : null}
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
              say('A multi-repository workspace must already exist on that host. This one has no match there yet.'),
              'bad',
            )
          : null}
        {pack?.problem === 'no-agent' ? line(say('This thread has no conversation to continue yet.'), 'bad') : null}
        {pack?.running ? line(say('Stop this thread first. A running agent cannot move.'), 'bad') : null}
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
        {repo
          ? targets.map((id) => {
              const plan = plans[id]
              const outcome = outcomes[id]
              return (
                <View key={id} style={{ gap: space.xs, paddingTop: space.s }}>
                  <T weight="600">{name(id)}</T>
                  {outcome === null ? (
                    line(say('Started'), 'muted')
                  ) : !plan ? (
                    line(say('Loading…'), 'muted')
                  ) : 'error' in plan ? (
                    line(plan.error, 'bad')
                  ) : (
                    <>
                      {plan.match?.by === 'name' && !named[id] ? (
                        <>
                          {line(say('{0} has the same name but a different remote.', { 0: plan.match.name }))}
                          <Button
                            kind="secondary"
                            title={say('Use {0}', { 0: plan.match.name })}
                            onPress={() => setNamed({ ...named, [id]: true })}
                          />
                        </>
                      ) : plan.match ? (
                        line(say('Project: {0}', { 0: plan.match.name }))
                      ) : (
                        line(
                          say('Set up on {0}: clones {1} into {2}', { 0: name(id), 1: repo.repoName, 2: plan.parent }),
                        )
                      )}
                      {line(
                        say('Runs {0} with Allow edits', { 0: plan.settings.model || plan.settings.provider }),
                        'muted',
                      )}
                      {outcome ? line(outcome, 'bad') : null}
                    </>
                  )}
                </View>
              )
            })
          : null}
        {available.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, alignItems: 'center' }}>
            <T size={font.caption} tone="muted">
              {say('Also on')}
            </T>
            {available
              .filter((pc) => pc.id !== targetId)
              .map((pc) => {
                const on = targets.includes(pc.id)
                return (
                  <Button
                    key={pc.id}
                    kind={on ? 'secondary' : 'ghost'}
                    title={pc.name}
                    disabled={busy || (!on && targets.length >= CONTINUE_HOSTS)}
                    onPress={() => setTargets(on ? targets.filter((other) => other !== pc.id) : [...targets, pc.id])}
                  />
                )
              })}
          </View>
        ) : null}
        <TextField placeholder={say('Add a note')} value={note} onChangeText={setNote} />
        {error ? line(error, 'bad') : null}
        <Button
          title={busy ? say('Starting…') : title}
          disabled={!pack || !!pack.problem || pack.running || !ready || !pending.length || busy}
          onPress={() => void start()}
        />
        <Button kind="ghost" title={say('Cancel')} disabled={busy} onPress={close} />
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
