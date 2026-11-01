import { useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import {
  operatorActionLabel,
  operatorSnapshot,
  runOperatorActions,
  type OperatorPlan,
  type OperatorResult,
  type OperatorSnapshot,
} from '@ramu/shared/operator'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { Input } from '@/components/desktop-input'
import { errorText } from '../lib/errors'
import { t, useLanguage } from '../i18n'
import { invokeOn } from '../ipc'
import { useComputers } from '../workspace/computers'
import { useHost } from '../workspace/HostProvider'
import { useWorkspacesOf } from '../workspace/workspace'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const anyHost = invokeOn as unknown as Invoke

/** One sentence becomes a list of proposed actions across connected hosts. Nothing runs until the person confirms. */
export function OperatorBox() {
  useLanguage()
  const host = useHost()
  const computers = useComputers()
  const hosts = useMemo(
    () => (computers?.computers ?? []).filter((computer) => computer.status === 'connected'),
    [computers],
  )
  const stores = useWorkspacesOf(hosts.map((computer) => computer.id))
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [plan, setPlan] = useState<(OperatorPlan & { snapshot: OperatorSnapshot }) | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [results, setResults] = useState<OperatorResult[] | null>(null)

  const ask = async () => {
    if (!request.trim() || busy) return
    setBusy(true)
    setError(null)
    setPlan(null)
    setResults(null)
    setSkipped(new Set())
    try {
      const inputs = await Promise.all(
        hosts.map(async (computer, index) => ({
          hostId: computer.id,
          host: computer.name,
          tasks: stores[index]?.tasks ?? [],
          projectName: (id: string) => stores[index]?.projects.find((project) => project.id === id)?.name ?? '',
          schedules: await invokeOn(computer.id, 'schedules.list').catch(() => []),
        })),
      )
      const snapshot = operatorSnapshot(inputs)
      const answer = await invokeOn(host.id, 'operator.plan', request.trim(), snapshot)
      if (answer) setPlan({ ...answer, snapshot })
      else setError(t('The Operator could not work that out. Try saying it another way.'))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  const label = (ref: string) => {
    if (!plan) return ref
    const thread = plan.snapshot.threads.find((entry) => entry.ref === ref)
    const schedule = plan.snapshot.schedules.find((entry) => entry.ref === ref)
    const name = thread?.title ?? schedule?.name ?? ref
    const place = thread?.host ?? schedule?.host
    return [name, thread?.project, hosts.length > 1 ? place : ''].filter(Boolean).join(' · ')
  }
  const chosen = plan?.actions.filter((action) => !skipped.has(action.ref + action.type)) ?? []
  const run = async () => {
    if (!plan || busy) return
    setBusy(true)
    try {
      setResults(await runOperatorActions(chosen, plan.snapshot, anyHost))
      setRequest('')
    } finally {
      setBusy(false)
    }
  }
  const clear = () => {
    setPlan(null)
    setResults(null)
    setError(null)
  }
  const failed = results?.filter((result) => result.error) ?? []

  return (
    <section className="flex flex-col gap-2" aria-label={t('Operator')}>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void ask()
        }}
      >
        <Sparkles size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
        <Input
          aria-label={t('Tell the Operator what to do')}
          placeholder={t('Stop everything on vps, retry what failed…')}
          maxLength={2000}
          value={request}
          disabled={busy}
          onChange={(event) => setRequest(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy || !request.trim()}>
          {busy && !plan ? t('Thinking…') : t('Ask')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      {plan && !results && (
        <div className="flex flex-col gap-2 rounded-(--radius-m) bg-fill p-3">
          {(plan.question || plan.summary) && <p className="m-0 text-control">{plan.question ?? plan.summary}</p>}
          {plan.actions.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {plan.actions.map((action) => {
                const key = action.ref + action.type
                return (
                  <li key={key}>
                    <label className="flex min-w-0 items-center gap-2 text-control" title={action.reason || undefined}>
                      <Checkbox
                        checked={!skipped.has(key)}
                        disabled={busy}
                        onCheckedChange={(checked) =>
                          setSkipped((current) => {
                            const next = new Set(current)
                            if (checked) next.delete(key)
                            else next.add(key)
                            return next
                          })
                        }
                      />
                      <span className="flex-none text-muted-foreground">{t(operatorActionLabel(action.type))}</span>
                      <span className="min-w-0 flex-1 truncate">{label(action.ref)}</span>
                    </label>
                    {action.text && (
                      <p className="m-[2px_0_0_26px] text-caption text-muted-foreground">{action.text}</p>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          <div className="flex gap-1.5">
            {plan.actions.length > 0 && (
              <Button size="xs" disabled={busy || !chosen.length} onClick={() => void run()}>
                {chosen.length === 1 ? t('Do this') : t('Do these {0}', { '0': chosen.length })}
              </Button>
            )}
            <Button variant="ghost" size="xs" disabled={busy} onClick={clear}>
              {plan.actions.length ? t('Cancel') : t('Close')}
            </Button>
          </div>
        </div>
      )}
      {results && (
        <div className="flex flex-col gap-1 rounded-(--radius-m) bg-fill p-3" role="status">
          <p className="m-0 text-control">
            {t('{0} of {1} done.', { '0': results.length - failed.length, '1': results.length })}
          </p>
          {failed.map(({ action, error: reason }) => (
            <p key={action.ref + action.type} className="m-0 text-caption text-bad">
              {label(action.ref)}: {reason}
            </p>
          ))}
          <Button variant="ghost" size="xs" className="self-start" onClick={clear}>
            {t('Close')}
          </Button>
        </div>
      )}
    </section>
  )
}
