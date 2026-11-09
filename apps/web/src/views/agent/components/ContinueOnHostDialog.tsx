import { useEffect, useState } from 'react'
import {
  CONTINUE_HOSTS,
  prepareTargets,
  startTargets,
  type ContinuationPackage,
  type TargetPlan,
} from '@ramu/shared/continuation'
import { Button } from '@/components/desktop-button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { t, useLanguage } from '../../../i18n'
import { invokeOn } from '../../../ipc'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'
import { useComputers } from '../../../workspace/computers'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
const anyHost = invokeOn as unknown as Invoke

const problemText = (problem: ContinuationPackage['problem']) =>
  problem === 'no-remote'
    ? t('This project has no Git remote, so another host has nothing to start from. Add a remote and push first.')
    : problem === 'several-repositories'
      ? t('A multi-repository workspace must already exist on that host. This one has no match there yet.')
      : t('This thread has no conversation to continue yet.')

const ids = () => ({ key: crypto.randomUUID(), cloneId: crypto.randomUUID() })

/** Shows what will travel and what stays, sets the project up where it is missing, and starts after one confirmation. */
export function ContinueOnHostDialog({
  taskId,
  targetId,
  onClose,
}: {
  taskId: string
  targetId: string
  onClose: () => void
}) {
  useLanguage()
  const host = useHost()
  const computers = useComputers()
  const here = computers?.computers.find((computer) => computer.id === host.id)
  const available = (computers?.computers ?? []).filter(
    (computer) => computer.id !== host.id && computer.status === 'connected',
  )
  const [targets, setTargets] = useState([targetId])
  const [pack, setPack] = useState<ContinuationPackage | null>(null)
  const [plans, setPlans] = useState<Record<string, TargetPlan | { error: string }>>({})
  const [named, setNamed] = useState<Record<string, boolean>>({})
  // A host that would commit as another email is chosen only after Continue anyway.
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({})
  const [outcomes, setOutcomes] = useState<Record<string, string | null>>({})
  const [keys] = useState(() => new Map<string, ReturnType<typeof ids>>())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const key = targets.join(',')

  useEffect(() => {
    let live = true
    void prepareTargets(anyHost, { hostId: host.id, taskId }, key.split(',')).then(
      (result) => {
        if (!live) return
        setPack(result.pack)
        setPlans(result.plans)
      },
      (cause) => live && setError(errorText(cause)),
    )
    return () => {
      live = false
    }
  }, [host.id, taskId, key])

  const name = (id: string) => available.find((computer) => computer.id === id)?.name ?? ''
  const repo = pack?.repo
  const pending = targets.filter((id) => outcomes[id] !== null)
  /** Hosts are compared by Git author email: the warning names both before anything crosses. */
  const warning = (id: string) => {
    const plan = plans[id]
    return plan &&
      !('error' in plan) &&
      pack?.gitEmail &&
      plan.gitEmail &&
      pack.gitEmail.toLowerCase() !== plan.gitEmail.toLowerCase()
      ? t('This thread is {0}. On {1} it would run as {2}.', { 0: pack.gitEmail, 1: name(id), 2: plan.gitEmail })
      : null
  }
  const ready = pending.every((id) => {
    const plan = plans[id]
    return plan && !('error' in plan) && (plan.match?.by !== 'name' || named[id]) && (!warning(id) || acknowledged[id])
  })
  const start = async () => {
    if (!pack || !here) return
    setBusy(true)
    setError(null)
    try {
      const result = await startTargets(anyHost, {
        pack,
        from: { hostId: host.id, hostName: here.name, taskId, title: pack.title },
        note,
        targets: pending.map((id) => {
          if (!keys.has(id)) keys.set(id, ids())
          return { id, name: name(id), plan: plans[id] as TargetPlan, useNamed: !!named[id], ...keys.get(id)! }
        }),
      })
      const next = { ...outcomes, ...result }
      setOutcomes(next)
      if (targets.every((id) => next[id] === null)) onClose()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  const title =
    targets.length === 1
      ? t('Continue on {0}', { 0: name(targets[0]!) })
      : t('Continue on {0} hosts', { 0: targets.length })

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {t(
              'The conversation travels with secrets removed, and can quote code and uncommitted content. Files stay here, and that host may use a different provider account.',
            )}
          </DialogDescription>
        </DialogHeader>
        {!pack && !error && <p className="text-caption text-muted-foreground">{t('Loading…')}</p>}
        {pack && (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-control">
            {pack.problem && <li className="text-bad">{problemText(pack.problem)}</li>}
            {pack.running && <li className="text-bad">{t('Stop this thread first. A running agent cannot move.')}</li>}
            {repo && (
              <li>
                {repo.pushed
                  ? t('Starts from {0} at {1}', { 0: repo.branch, 1: repo.commit.slice(0, 7) })
                  : t('{0} is not pushed, so that host starts from its default branch', { 0: repo.branch })}
              </li>
            )}
            {repo && (repo.dirtyFiles > 0 || repo.unpushed > 0) && (
              <li className="text-warn">
                {t('Left behind: {0} changed files and {1} unpushed commits. Commit and push first to bring them.', {
                  0: repo.dirtyFiles,
                  1: repo.unpushed,
                })}
              </li>
            )}
            {pack.queued > 0 && <li>{t('{0} queued messages stay here', { 0: pack.queued })}</li>}
          </ul>
        )}
        {pack?.repo &&
          targets.map((id) => {
            const plan = plans[id]
            const outcome = outcomes[id]
            return (
              <section key={id} className="flex flex-col gap-1 rounded-(--radius-m) bg-fill p-3 text-control">
                <p className="m-0 font-medium">{name(id)}</p>
                {outcome === null ? (
                  <p className="m-0 text-muted-foreground">{t('Started')}</p>
                ) : !plan ? (
                  <p className="m-0 text-muted-foreground">{t('Loading…')}</p>
                ) : 'error' in plan ? (
                  <p className="m-0 text-bad">{plan.error}</p>
                ) : (
                  <>
                    {plan.match?.by === 'name' && !named[id] ? (
                      <p className="m-0 flex flex-wrap items-center gap-2">
                        {t('{0} has the same name but a different remote.', { 0: plan.match.name })}
                        <Button variant="secondary" size="xs" onClick={() => setNamed({ ...named, [id]: true })}>
                          {t('Use {0}', { 0: plan.match.name })}
                        </Button>
                      </p>
                    ) : plan.match ? (
                      <p className="m-0">{t('Project: {0}', { 0: plan.match.name })}</p>
                    ) : (
                      <p className="m-0">
                        {t('Set up on {0}: clones {1} into {2}', {
                          0: name(id),
                          1: pack.repo!.repoName,
                          2: plan.parent,
                        })}
                      </p>
                    )}
                    <p className="m-0 text-muted-foreground">
                      {t('Runs {0} with Allow edits', { 0: plan.settings.model || plan.settings.provider })}
                    </p>
                    {warning(id) && (
                      <p className="m-0 text-warn">
                        {warning(id)}{' '}
                        {!acknowledged[id] && (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => setAcknowledged({ ...acknowledged, [id]: true })}
                          >
                            {t('Continue anyway')}
                          </Button>
                        )}
                      </p>
                    )}
                    {outcome && <p className="m-0 text-bad">{outcome}</p>}
                  </>
                )}
              </section>
            )
          })}
        {available.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5 text-caption text-muted-foreground">
            {t('Also on')}
            {available
              .filter((computer) => computer.id !== targetId)
              .map((computer) => {
                const on = targets.includes(computer.id)
                return (
                  <Button
                    key={computer.id}
                    size="xs"
                    variant={on ? 'secondary' : 'ghost'}
                    aria-pressed={on}
                    disabled={busy || (!on && targets.length >= CONTINUE_HOSTS)}
                    onClick={() =>
                      setTargets(on ? targets.filter((id) => id !== computer.id) : [...targets, computer.id])
                    }
                  >
                    {computer.name}
                  </Button>
                )
              })}
          </div>
        )}
        <Textarea
          rows={2}
          maxLength={4000}
          aria-label={t('Add a note')}
          placeholder={t('Add a note')}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error && (
          <p role="alert" className="m-0 text-caption text-bad">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {Object.values(outcomes).includes(null) ? t('Close') : t('Cancel')}
          </Button>
          <Button
            disabled={!pack || !!pack.problem || pack.running || !ready || !pending.length || busy}
            onClick={() => void start()}
          >
            {busy ? t('Starting…') : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
