import { useEffect, useState } from 'react'
import { combinedImpact, doneStopsWork, type ThreadDoneImpact } from '@ramu/shared/chat/threadDone'
import type { ramu } from '../ipc'
import { Dialog } from '../Menu'
import { t, useLanguage } from '../i18n'

const NOTHING_RUNNING: ThreadDoneImpact = { commands: 0, helpers: 0, computer: false, browserTabs: 0 }
type Request = { impact: ThreadDoneImpact; resolve: (approved: boolean) => void }
let active: Request | null = null
let listener: ((request: Request | null) => void) | null = null

function confirmFinish(impact: ThreadDoneImpact): Promise<boolean> {
  // Without the dialog mounted (a window that never shows one), marking done goes ahead as it always did.
  if (!listener) return Promise.resolve(true)
  active?.resolve(false)
  return new Promise((resolve) => {
    active = { impact, resolve }
    listener!(active)
  })
}

/**
 * Marks threads done. Done stops what a thread is still running and gives back what it holds, so when that would end
 * running work the person confirms first, as closing a terminal with a running command does. Resolves false when they
 * keep the work running instead.
 */
export async function finishThreads(invoke: typeof ramu.invoke, taskIds: string[]): Promise<boolean> {
  const impacts = await Promise.all(
    taskIds.map((taskId) =>
      // A host that cannot answer is marked done without asking.
      invoke('tasks.doneImpact', taskId).catch(() => NOTHING_RUNNING),
    ),
  )
  const impact = combinedImpact(impacts)
  if (doneStopsWork(impact) && !(await confirmFinish(impact))) return false
  for (const taskId of taskIds) await invoke('tasks.done', taskId, true)
  return true
}

export function FinishThreadDialog() {
  useLanguage()
  const [request, setRequest] = useState<Request | null>(null)
  useEffect(() => {
    listener = setRequest
    return () => {
      listener = null
      active?.resolve(false)
      active = null
    }
  }, [])
  const finish = (approved: boolean) => {
    const current = active
    active = null
    setRequest(null)
    current?.resolve(approved)
  }
  if (!request) return null
  const { impact } = request
  return (
    <Dialog
      title={t('Stop running work and mark done?')}
      confirmLabel={t('Stop and mark done')}
      danger
      onConfirm={() => finish(true)}
      onCancel={() => finish(false)}
    >
      <p>{t('Marking this done stops:')}</p>
      <ul className="m-0 pl-4 list-disc">
        {impact.commands > 0 && (
          <li>{t('{0} background commands, with any servers they run', { '0': impact.commands })}</li>
        )}
        {impact.helpers > 0 && <li>{t('{0} helper agents still working', { '0': impact.helpers })}</li>}
        {impact.computer && <li>{t('Using the computer')}</li>}
        {impact.browserTabs > 0 && <li>{t('{0} browser tabs', { '0': impact.browserTabs })}</li>}
      </ul>
      <p className="text-muted-foreground">{t('Reopening the thread later starts the work again as it needs.')}</p>
    </Dialog>
  )
}
