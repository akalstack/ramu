import { useState } from 'react'
import { Square, Users } from 'lucide-react'
import type { AgentSettings, AgentTask, TeammateMode } from '@ramu/shared/types'
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
import { AgentControls } from '../../../chat/AgentControls'
import { notifyError } from '../../../chat/Notifications'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'

/** Picks a second model and how it works beside the lead: Review reads and reports, Take over edits while the lead waits. */
export function AddTeammateDialog({
  sessionId,
  initial,
  onClose,
}: {
  sessionId: string
  initial: AgentSettings
  onClose: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [settings, setSettings] = useState(initial)
  const [mode, setMode] = useState<TeammateMode>('review')
  const [request, setRequest] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async () => {
    setBusy(true)
    setError(null)
    try {
      await invoke('agent.addTeammate', sessionId, settings, mode, request)
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
          <DialogTitle>{t('Add teammate')}</DialogTitle>
          <DialogDescription>
            {t('A second model joins this thread with the conversation so far, and keeps its own session.')}
          </DialogDescription>
        </DialogHeader>
        <AgentControls settings={settings} onChange={setSettings} disabled={busy} />
        <div className="flex gap-1.5" role="radiogroup" aria-label={t('How it works')}>
          {(['review', 'take-over'] as const).map((value) => (
            <Button
              key={value}
              role="radio"
              aria-checked={mode === value}
              size="sm"
              variant={mode === value ? 'secondary' : 'ghost'}
              onClick={() => setMode(value)}
            >
              {value === 'review' ? t('Review') : t('Take over')}
            </Button>
          ))}
        </div>
        <p className="m-0 text-caption text-muted-foreground">
          {mode === 'review'
            ? t('Reads the latest changes and replies with findings. It never edits, whatever this thread allows.')
            : t('Edits while the lead waits, then hands back with a summary.')}
        </p>
        <Textarea
          rows={2}
          maxLength={20_000}
          aria-label={t('What should it do?')}
          placeholder={t('What should it do?')}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
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
          <Button disabled={busy} onClick={() => void add()}>
            {t('Add teammate')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Above the composer while a teammate is here: who it is, how to address it, and Stop. */
export function TeammateBar({ sessionId, teammate }: { sessionId: string; teammate: AgentTask }) {
  useLanguage()
  const { invoke } = useHost()
  const handle = teammate.name.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="flex items-center gap-2 px-3 py-1 text-caption text-muted-foreground" role="status">
      <Users size={13} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {t('Teammate {0} · {1} · start a message with @{2} to talk to it', {
          0: teammate.name,
          1: teammate.teammate === 'review' ? t('Review') : t('Take over'),
          2: handle,
        })}
      </span>
      {teammate.status === 'running' && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('Stop {0}', { 0: teammate.name })}
          onClick={() =>
            void invoke('agent.stopTask', sessionId, teammate.agentId).catch((error) => notifyError(errorText(error)))
          }
        >
          <Square size={11} />
        </Button>
      )}
    </div>
  )
}
