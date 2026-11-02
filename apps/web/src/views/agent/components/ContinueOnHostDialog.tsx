import { useEffect, useState } from 'react'
import {
  cloneForContinuation,
  continueOnHost,
  type ContinuationMatch,
  type ContinuationPackage,
} from '@ramu/shared/continuation'
import type { AgentSettings } from '@ramu/shared/types'
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

interface Prepared {
  pack: ContinuationPackage
  match: ContinuationMatch | null
  settings: AgentSettings
  parent: string
}

const problemText = (problem: ContinuationPackage['problem']) =>
  problem === 'no-remote'
    ? t('This project has no Git remote, so another host has nothing to start from. Add a remote and push first.')
    : problem === 'several-repositories'
      ? t('A multi-repository workspace must already exist on that host, and this one cannot be matched yet.')
      : t('This thread has no conversation to continue yet.')

/** Shows what will travel and what stays, sets the project up when it is missing, and starts after one confirmation. */
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
  const target = computers?.computers.find((computer) => computer.id === targetId)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [useNamed, setUseNamed] = useState(false)
  const [key] = useState(() => crypto.randomUUID())
  const [cloneId] = useState(() => crypto.randomUUID())

  useEffect(() => {
    let live = true
    void (async () => {
      const pack = await invokeOn(host.id, 'threads.continuationPackage', taskId)
      const remote = pack.repo
        ? await invokeOn(targetId, 'threads.prepareContinuation', pack.repo, pack.settings)
        : { match: null, settings: pack.settings, parent: '' }
      if (live) setPrepared({ pack, ...remote })
    })().catch((cause) => live && setError(errorText(cause)))
    return () => {
      live = false
    }
  }, [host.id, taskId, targetId])

  const pack = prepared?.pack
  const repo = pack?.repo
  const match = prepared?.match
  const blocked = !pack || !!pack.problem || pack.running
  const needsChoice = match?.by === 'name' && !useNamed
  const start = async () => {
    if (!prepared || !repo || !target || !here) return
    setBusy(true)
    setError(null)
    try {
      const existing = match && (match.by === 'remote' || useNamed) ? match.projectId : null
      const projectId = existing ?? (await cloneForContinuation(anyHost, targetId, repo, prepared.parent, cloneId)).id
      await continueOnHost(
        anyHost,
        { id: target.id, name: target.name },
        {
          key,
          from: { hostId: host.id, hostName: here.name, taskId, title: prepared.pack.title },
          projectId,
          branch: repo.pushed ? repo.branch : '',
          prompt: prepared.pack.prompt,
          ...(note.trim() ? { note: note.trim() } : {}),
          settings: prepared.settings,
        },
      )
      onClose()
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Continue on {0}', { 0: target?.name ?? '' })}</DialogTitle>
          <DialogDescription>
            {t(
              'The conversation travels with secrets removed, and can quote code and uncommitted content. Files stay here, and that host may use a different provider account.',
            )}
          </DialogDescription>
        </DialogHeader>
        {!prepared && !error && <p className="text-caption text-muted-foreground">{t('Loading…')}</p>}
        {pack && (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-control">
            {pack.problem && <li className="text-bad">{problemText(pack.problem)}</li>}
            {pack.running && <li className="text-bad">{t('Stop this thread first. A running agent never moves.')}</li>}
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
            {repo &&
              (match?.by === 'remote' ? (
                <li>{t('Project: {0}', { 0: match.name })}</li>
              ) : match?.by === 'name' && !useNamed ? (
                <li className="flex flex-wrap items-center gap-2">
                  {t('{0} has the same name but a different remote.', { 0: match.name })}
                  <Button variant="secondary" size="xs" onClick={() => setUseNamed(true)}>
                    {t('Use {0}', { 0: match.name })}
                  </Button>
                </li>
              ) : useNamed && match ? (
                <li>{t('Project: {0}', { 0: match.name })}</li>
              ) : (
                <li>
                  {t('Set up on {0}: clones {1} into {2}', {
                    0: target?.name ?? '',
                    1: repo.repoName,
                    2: prepared.parent,
                  })}
                </li>
              ))}
            {prepared.settings && (
              <li>{t('Runs {0} with Allow edits', { 0: prepared.settings.model || prepared.settings.provider })}</li>
            )}
          </ul>
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
            {t('Cancel')}
          </Button>
          <Button disabled={blocked || needsChoice || busy} onClick={() => void start()}>
            {busy ? t('Starting…') : t('Continue on {0}', { 0: target?.name ?? '' })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
