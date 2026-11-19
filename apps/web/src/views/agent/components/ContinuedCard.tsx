import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { broughtBack, latestReply } from '@ramu/shared/continuation'
import type { AgentEvent } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { offerThreadUndo } from '../../../sidebar/projects/threadUndo'
import { notifyError } from '../../../chat/Notifications'
import { t, useLanguage } from '../../../i18n'
import { invokeOn } from '../../../ipc'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'
import { useHostSelection } from '../../../workspace/HostSelection'

/** Links the original to its continuation. Nothing comes back or gets archived unless the person asks. */
export function ContinuedCard({
  event,
  sessionId,
  taskId,
}: {
  event: Extract<AgentEvent, { kind: 'continued' }>
  sessionId: string
  taskId?: string
}) {
  useLanguage()
  const { invoke } = useHost()
  const { select } = useHostSelection()
  const [busy, setBusy] = useState(false)
  const bringBack = async () => {
    setBusy(true)
    try {
      const sessions = await invokeOn(event.hostId, 'agent.list', event.taskId)
      const session = sessions.at(-1)
      if (!session) throw new Error(t('That thread has no agent.'))
      if (['starting', 'running', 'needs-input'].includes(session.state))
        throw new Error(t('That thread is still working.'))
      const { events } = await invokeOn(event.hostId, 'agent.tail', session.id)
      const reply = latestReply(events)
      if (!reply) throw new Error(t('That thread has no reply yet.'))
      await invoke('agent.submit', sessionId, broughtBack(event.host, reply), 'queue')
    } catch (error) {
      notifyError(errorText(error))
    } finally {
      setBusy(false)
    }
  }
  const archive = () => {
    if (!taskId) return
    const change = (archived: boolean) => invoke('tasks.archive', taskId, archived)
    void change(true).then(
      () => offerThreadUndo('archived', 1, () => change(false)),
      (error) => notifyError(errorText(error)),
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground" role="status">
      <ArrowUpRight size={14} aria-hidden="true" />
      <span className="min-w-0 flex-1">{t('Continued on {0}', { 0: event.host })}</span>
      <Button variant="ghost" size="xs" onClick={() => select(event.hostId, { kind: 'task', taskId: event.taskId })}>
        {t('Open')}
      </Button>
      <Button variant="ghost" size="xs" disabled={busy} onClick={() => void bringBack()}>
        {t('Bring back result')}
      </Button>
      {taskId && (
        <Button variant="ghost" size="xs" onClick={archive}>
          {t('Archive')}
        </Button>
      )}
    </div>
  )
}
