import { useState } from 'react'
import { customAgentHandle, teammateRecipeName } from '@ramu/shared/customAgents'
import type { AgentTask } from '@ramu/shared/types'
import { Input } from '@/components/desktop-input'
import { t as translate, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { Dialog } from '../../../Menu'
import { useHost } from '../../../workspace/HostProvider'

/**
 * Saves a teammate that worked well as a custom agent: its model, its brief and its mode come along, so only the name
 * is asked. Once saved, `@name` brings it into any thread.
 */
export function SaveTeammateDialog({
  sessionId,
  task,
  onClose,
}: {
  sessionId: string
  task: AgentTask
  onClose: () => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const [name, setName] = useState(() => teammateRecipeName(task))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  if (saved)
    return (
      <Dialog
        title={translate('Saved as a teammate')}
        confirmLabel={translate('Done')}
        onConfirm={onClose}
        onCancel={onClose}
      >
        <p>
          {translate('Start a message with @{0} in any thread to bring it in. Edit it in Settings → Custom agents.', {
            0: saved,
          })}
        </p>
      </Dialog>
    )
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const agent = await invoke('customAgents.saveTeammate', sessionId, task.agentId, name.trim())
      setSaved(customAgentHandle(agent.name))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={translate('Save {0} as a teammate', { 0: task.name })}
      confirmLabel={translate('Save')}
      confirmDisabled={!name.trim()}
      busy={busy}
      error={error}
      onConfirm={() => void save()}
      onCancel={onClose}
    >
      <p>{translate('Its model, its brief and what it may do are saved, so you can bring it into another thread.')}</p>
      <Input
        className="mt-2"
        aria-label={translate('Name')}
        value={name}
        maxLength={60}
        autoFocus
        disabled={busy}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && name.trim() && !busy) void save()
        }}
      />
    </Dialog>
  )
}
