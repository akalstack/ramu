import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { Check, Circle } from 'lucide-react-native'
import {
  operatorActionLabel,
  operatorSnapshot,
  runOperatorActions,
  type OperatorPlan,
  type OperatorResult,
  type OperatorSnapshot,
} from '@ramu/shared/operator'
import { useSay } from '../i18n'
import { useStore } from '../runtime/store'
import { STANDALONE } from '../runtime/types'
import { font, space, useTheme } from '../theme'
import { TextField } from './ScheduleFields'
import { Button, Card, Sheet, T, tap } from './ui'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>

/** One sentence becomes a list of proposed actions across online hosts. Nothing runs until the person confirms. */
export function OperatorSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const say = useSay()
  const { c } = useTheme()
  const store = useStore()
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [plan, setPlan] = useState<(OperatorPlan & { snapshot: OperatorSnapshot }) | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<OperatorResult[] | null>(null)
  const invoke = store.invoke as unknown as Invoke
  const hosts = store.computers.filter((computer) => computer.status === 'online')

  const ask = async () => {
    setBusy(true)
    setError('')
    setPlan(null)
    setResults(null)
    setSkipped(new Set())
    try {
      const inputs = await Promise.all(
        hosts.map(async (computer) => ({
          hostId: computer.id,
          host: computer.name,
          tasks: store.chats.filter((chat) => chat.computerId === computer.id && !chat.pending),
          projectName: (id: string) =>
            id === STANDALONE ? '' : (store.projects.find((project) => project.id === id)?.name ?? ''),
          schedules: await store.invoke(computer.id, 'schedules.list').catch(() => []),
        })),
      )
      const snapshot = operatorSnapshot(inputs)
      const answer = await store.invoke(store.selected, 'operator.plan', request.trim(), snapshot)
      if (answer) setPlan({ ...answer, snapshot })
      else setError(say('The Operator could not work that out. Try saying it another way.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const name = (ref: string) => {
    const thread = plan?.snapshot.threads.find((entry) => entry.ref === ref)
    const schedule = plan?.snapshot.schedules.find((entry) => entry.ref === ref)
    const place = thread?.host ?? schedule?.host
    const title = thread?.title ?? schedule?.name ?? ref
    return [title, thread?.project, hosts.length > 1 ? place : ''].filter(Boolean).join(' · ')
  }
  const chosen = plan?.actions.filter((action) => !skipped.has(action.ref + action.type)) ?? []
  const run = async () => {
    if (!plan) return
    setBusy(true)
    try {
      setResults(await runOperatorActions(chosen, plan.snapshot, invoke))
      setRequest('')
      for (const computer of hosts) void store.refresh(computer.id, true)
    } finally {
      setBusy(false)
    }
  }
  const reset = () => {
    setPlan(null)
    setResults(null)
    setError('')
  }
  const failed = results?.filter((result) => result.error) ?? []

  return (
    <Sheet open={open} onClose={onClose} title={say('Operator')}>
      <View style={{ gap: space.m, paddingHorizontal: space.l, paddingBottom: space.xl }}>
        {!plan && !results ? (
          <>
            <TextField
              multiline
              maxLength={2000}
              value={request}
              placeholder={say('Stop everything on vps, retry what failed…')}
              onChangeText={setRequest}
            />
            <Button
              title={busy ? say('Thinking…') : say('Ask')}
              disabled={busy || !request.trim()}
              onPress={() => void ask()}
            />
          </>
        ) : null}
        {error ? <T tone="bad">{error}</T> : null}
        {plan && !results ? (
          <>
            {plan.question || plan.summary ? <T>{plan.question ?? plan.summary}</T> : null}
            {plan.actions.length ? (
              <Card style={{ padding: space.m, gap: space.s }}>
                {plan.actions.map((action) => {
                  const key = action.ref + action.type
                  const on = !skipped.has(key)
                  return (
                    <Pressable
                      key={key}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      disabled={busy}
                      onPress={() => {
                        tap()
                        setSkipped((current) => {
                          const next = new Set(current)
                          if (on) next.add(key)
                          else next.delete(key)
                          return next
                        })
                      }}
                      style={{ flexDirection: 'row', alignItems: 'center', gap: space.s, minHeight: 36 }}
                    >
                      {on ? <Check size={18} color={c.accent} /> : <Circle size={18} color={c.muted} />}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <T size={font.caption} tone="muted">
                          {say(operatorActionLabel(action.type))}
                        </T>
                        <T numberOfLines={2}>{name(action.ref)}</T>
                        {action.text ? (
                          <T size={font.caption} tone="muted">
                            {action.text}
                          </T>
                        ) : null}
                      </View>
                    </Pressable>
                  )
                })}
              </Card>
            ) : null}
            {plan.actions.length ? (
              <Button
                title={chosen.length === 1 ? say('Do this') : say('Do these {0}', { '0': chosen.length })}
                disabled={busy || !chosen.length}
                onPress={() => void run()}
              />
            ) : null}
            <Button kind="ghost" title={say(plan.actions.length ? 'Cancel' : 'Close')} onPress={reset} />
          </>
        ) : null}
        {results ? (
          <>
            <T>{say('{0} of {1} done.', { '0': results.length - failed.length, '1': results.length })}</T>
            {failed.map(({ action, error: reason }) => (
              <T key={action.ref + action.type} tone="bad">
                {`${name(action.ref)}: ${reason}`}
              </T>
            ))}
            <Button kind="ghost" title={say('Close')} onPress={onClose} />
          </>
        ) : null}
      </View>
    </Sheet>
  )
}
